/**
 * Property-list parser. Handles Apple binary plists (bplist00) and XML plists.
 * Written from scratch so it runs unmodified on the Workers runtime.
 */

export type PlistValue =
  | string
  | number
  | boolean
  | null
  | Date
  | Uint8Array
  | PlistValue[]
  | { [k: string]: PlistValue };

const td = new TextDecoder();
const tdUtf16 = new TextDecoder("utf-16be");

function isBinary(buf: Uint8Array): boolean {
  return (
    buf.length > 8 &&
    buf[0] === 0x62 && buf[1] === 0x70 && buf[2] === 0x6c && buf[3] === 0x69 &&
    buf[4] === 0x73 && buf[5] === 0x74
  );
}

export function parsePlist(buf: Uint8Array): PlistValue {
  if (isBinary(buf)) return parseBinaryPlist(buf);
  return parseXmlPlist(td.decode(buf));
}

/* ------------------------------------------------------------------ binary */

function readUInt(dv: DataView, off: number, size: number): number {
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + dv.getUint8(off + i);
  return v;
}

export function parseBinaryPlist(buf: Uint8Array): PlistValue {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const trailer = buf.byteLength - 32;
  if (trailer < 8) throw new Error("bplist too short");
  const offsetIntSize = dv.getUint8(trailer + 6);
  const objectRefSize = dv.getUint8(trailer + 7);
  const numObjects = readUInt(dv, trailer + 8, 8);
  const topObject = readUInt(dv, trailer + 16, 8);
  const offsetTableOffset = readUInt(dv, trailer + 24, 8);

  const offsets = new Array<number>(numObjects);
  for (let i = 0; i < numObjects; i++) {
    offsets[i] = readUInt(dv, offsetTableOffset + i * offsetIntSize, offsetIntSize);
  }

  const cache = new Map<number, PlistValue>();

  function objAt(index: number, depth: number): PlistValue {
    if (index >= numObjects) throw new Error("bplist object index out of range");
    if (depth > 64) throw new Error("bplist nested too deep");
    const hit = cache.get(index);
    if (hit !== undefined) return hit;

    let off = offsets[index];
    const marker = dv.getUint8(off);
    const type = marker >> 4;
    let len = marker & 0x0f;
    off += 1;

    const readCount = () => {
      // 0b0001nnnn int follows giving the real length
      const m = dv.getUint8(off);
      const sz = 1 << (m & 0x0f);
      off += 1;
      const n = readUInt(dv, off, sz);
      off += sz;
      return n;
    };

    let out: PlistValue;
    switch (type) {
      case 0x0:
        out = len === 0 ? null : len === 8 ? false : len === 9 ? true : null;
        break;
      case 0x1: {
        const size = 1 << len;
        if (size === 8) {
          const big = dv.getBigInt64(off);
          out = Number(big);
        } else if (size === 16) {
          // 128-bit ints appear as huge values; keep the low 64 bits.
          out = Number(dv.getBigUint64(off + 8));
        } else {
          out = readUInt(dv, off, size);
        }
        break;
      }
      case 0x2:
        out = (1 << len) === 4 ? dv.getFloat32(off) : dv.getFloat64(off);
        break;
      case 0x3:
        out = new Date(Date.UTC(2001, 0, 1) + dv.getFloat64(off) * 1000);
        break;
      case 0x4: {
        if (len === 0x0f) len = readCount();
        out = buf.subarray(off, off + len);
        break;
      }
      case 0x5: {
        if (len === 0x0f) len = readCount();
        out = td.decode(buf.subarray(off, off + len));
        break;
      }
      case 0x6: {
        if (len === 0x0f) len = readCount();
        out = tdUtf16.decode(buf.subarray(off, off + len * 2));
        break;
      }
      case 0x7: {
        if (len === 0x0f) len = readCount();
        out = td.decode(buf.subarray(off, off + len));
        break;
      }
      case 0x8:
        out = readUInt(dv, off, len + 1); // UID
        break;
      case 0xa:
      case 0xc: {
        if (len === 0x0f) len = readCount();
        const arr: PlistValue[] = [];
        for (let i = 0; i < len; i++) {
          arr.push(objAt(readUInt(dv, off + i * objectRefSize, objectRefSize), depth + 1));
        }
        out = arr;
        break;
      }
      case 0xd: {
        if (len === 0x0f) len = readCount();
        const dict: Record<string, PlistValue> = {};
        for (let i = 0; i < len; i++) {
          const k = objAt(readUInt(dv, off + i * objectRefSize, objectRefSize), depth + 1);
          const v = objAt(
            readUInt(dv, off + (len + i) * objectRefSize, objectRefSize),
            depth + 1,
          );
          dict[typeof k === "string" ? k : String(k)] = v;
        }
        out = dict;
        break;
      }
      default:
        throw new Error(`bplist unknown marker 0x${marker.toString(16)}`);
    }
    cache.set(index, out);
    return out;
  }

  return objAt(topObject, 0);
}

/* --------------------------------------------------------------------- XML */

interface Tok {
  name: string;
  /** "open" | "close" | "self" */
  kind: "open" | "close" | "self";
  /** Character text that follows this token, before the next one. */
  text: string;
}

function decodeEntities(s: string): string {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, e: string) => {
    switch (e) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: {
        const hex = e[1] === "x" || e[1] === "X";
        const code = parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10);
        // Out of range or unparseable: leave the reference literal rather than
        // throwing away the whole document.
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
        try {
          return String.fromCodePoint(code);
        } catch {
          return m;
        }
      }
    }
  });
}

function b64ToBytes(s: string): Uint8Array {
  // Whitespace and line breaks inside <data> are normal; anything else is junk.
  let clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  // atob rejects a length that is not a multiple of 4, and a lone trailing
  // character carries no whole byte. Both are recoverable: decode what is there.
  const rem = clean.length % 4;
  if (rem === 1) clean = clean.slice(0, -1);
  else if (rem) clean += "=".repeat(4 - rem);
  let bin: string;
  try {
    bin = atob(clean);
  } catch {
    return new Uint8Array();
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function tokenize(xml: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = xml.length;
  const addText = (t: string) => { if (toks.length) toks[toks.length - 1].text += t; };
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) break;
    if (lt > i) addText(xml.slice(i, lt));
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt);
      addText(xml.slice(lt + 9, end === -1 ? n : end));
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const gt = xml.indexOf(">", lt);
    if (gt === -1) break;
    const raw = xml.slice(lt + 1, gt);
    const close = raw.startsWith("/");
    const self = !close && raw.endsWith("/");
    const name = raw.replace(/^\//, "").replace(/\/$/, "").trim().split(/[\s>]/)[0].toLowerCase();
    toks.push({ name, kind: close ? "close" : self ? "self" : "open", text: "" });
    i = gt + 1;
  }
  return toks;
}

/**
 * Parses XML plists by walking the token stream with an explicit cursor. Every
 * element consumes its own closing tag, so a malformed or unexpected tag can
 * never make a parent element swallow its sibling's terminator.
 */
export function parseXmlPlist(xml: string): PlistValue {
  const toks = tokenize(xml);
  let p = 0;

  /** Consume one element starting at `p` and return its value. */
  function element(depth: number): PlistValue {
    if (depth > 200) throw new Error("plist XML nested too deep");
    const t = toks[p];
    if (!t) return null;
    if (t.kind === "close") { p++; return null; } // stray close: skip it
    const { name, kind, text } = t;
    p++;

    if (kind === "self") {
      switch (name) {
        case "true": return true;
        case "false": return false;
        case "dict": return {};
        case "array": return [];
        case "string": return "";
        case "data": return new Uint8Array();
        default: return null;
      }
    }

    switch (name) {
      case "plist": {
        const v = p < toks.length && toks[p].kind !== "close" ? element(depth + 1) : null;
        skipTo("plist");
        return v;
      }
      case "dict": {
        const out: Record<string, PlistValue> = {};
        while (p < toks.length) {
          const cur = toks[p];
          if (cur.kind === "close") { p++; if (cur.name === "dict") break; continue; }
          if (cur.name !== "key") { element(depth + 1); continue; } // unexpected: consume and move on
          const key = decodeEntities(cur.text);
          p++;
          if (toks[p]?.kind === "close" && toks[p].name === "key") p++;
          out[key] = p < toks.length && toks[p].kind !== "close" ? element(depth + 1) : null;
        }
        return out;
      }
      case "array": {
        const out: PlistValue[] = [];
        while (p < toks.length) {
          const cur = toks[p];
          if (cur.kind === "close") { p++; if (cur.name === "array") break; continue; }
          out.push(element(depth + 1));
        }
        return out;
      }
      case "key":
      case "string": {
        const v = decodeEntities(text);
        skipTo(name);
        return v;
      }
      case "integer": {
        skipTo(name);
        const v = parseInt(text.trim(), 10);
        return Number.isNaN(v) ? 0 : v;
      }
      case "real": {
        skipTo(name);
        const v = parseFloat(text.trim());
        return Number.isNaN(v) ? 0 : v;
      }
      case "true": skipTo(name); return true;
      case "false": skipTo(name); return false;
      case "data": { const v = b64ToBytes(text); skipTo(name); return v; }
      case "date": {
        skipTo(name);
        const raw = text.trim();
        const v = new Date(raw);
        // An unparseable date would otherwise become an Invalid Date, which
        // cannot be serialised; keep the original text instead.
        return Number.isNaN(v.getTime()) ? raw : v;
      }
      default: skipTo(name); return null;
    }
  }

  /** Consume the matching close tag for `name` if it is the next token. */
  function skipTo(name: string) {
    if (toks[p]?.kind === "close" && toks[p].name === name) p++;
  }

  while (p < toks.length && toks[p].name !== "plist" && toks[p].kind === "close") p++;
  return element(0);
}

/** Serialise a parsed plist to JSON-safe values, tagging binary + dates. */
export function toJsonSafe(v: PlistValue): unknown {
  if (v instanceof Uint8Array) {
    return { __data: bytesToHex(v), __len: v.length, __text: maybeText(v) };
  }
  if (v instanceof Date) {
    return { __date: Number.isNaN(v.getTime()) ? "invalid date" : v.toISOString() };
  }
  if (Array.isArray(v)) return v.map(toJsonSafe);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = toJsonSafe(val as PlistValue);
    return out;
  }
  return v;
}

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

export function maybeText(b: Uint8Array): string | undefined {
  if (b.length === 0 || b.length > 4096) return undefined;
  // Fixed-width fields are NUL-padded, often by more than one byte; the text is
  // whatever precedes the padding.
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  if (end === 0) return undefined;
  for (let i = 0; i < end; i++) {
    const c = b[i];
    if (!(c === 9 || c === 10 || c === 13 || (c >= 0x20 && c < 0x7f))) return undefined;
  }
  return td.decode(b.subarray(0, end));
}
