/**
 * Property-list parser. Handles Apple binary plists (bplist00) and XML plists.
 * Written from scratch so it runs unmodified on the Workers runtime.
 */

import { asciiAt, b64ToBytes, bytesToHex, maybeText } from "./bytes";

/** A bplist UID (NSKeyedArchiver object reference), kept apart from integers. */
export class PlistUid {
  constructor(readonly uid: number) {}
}

/**
 * Integers are numbers while exactly representable and bigints beyond 2^53
 * (64-bit and 128-bit bplist ints, long XML <integer> values).
 */
export type PlistValue =
  | string
  | number
  | bigint
  | PlistUid
  | boolean
  | null
  | Date
  | Uint8Array
  | PlistValue[]
  | PlistDict;

export type PlistDict = { [k: string]: PlistValue };

const td = new TextDecoder();
const tdUtf16 = new TextDecoder("utf-16be");

export function parsePlist(buf: Uint8Array): PlistValue {
  if (buf.length > 8 && asciiAt(buf, 0, "bplist")) return parseBinaryPlist(buf);
  return parseXmlPlist(td.decode(buf));
}

/* ------------------------------------------------------------------ binary */

/** A bigint as a number when that is exact. */
const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
function exact(v: bigint): number | bigint {
  return v >= SAFE_MIN && v <= SAFE_MAX ? Number(v) : v;
}

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
          out = exact(dv.getBigInt64(off)); // signed; 1, 2 and 4 byte ints are unsigned
        } else if (size === 16) {
          // CF writes UInt64 values above INT64_MAX this way; read as signed 128-bit
          out = exact(BigInt.asIntN(128, (dv.getBigUint64(off) << 64n) | dv.getBigUint64(off + 8)));
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
        out = new PlistUid(readUInt(dv, off, len + 1));
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
        return xmlInteger(text);
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

/** Decimal or 0x-hex <integer> text, exact; 0 for anything unparseable. */ // CFPropertyList.c parseIntegerTag
function xmlInteger(text: string): number | bigint {
  const m = /^([+-]?)(0[xX][0-9a-fA-F]+|[0-9]+)/.exec(text.trim());
  if (!m) return 0;
  const v = BigInt(m[2]);
  return exact(m[1] === "-" ? -v : v);
}

/** A dict: an object that is not an array, bytes, a date or a UID. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array) && !(v instanceof Date) && !(v instanceof PlistUid);
}

export const isPlistDict = (v: PlistValue | undefined): v is PlistDict => isRecord(v);

/* Tagged scalars in toJsonSafe output. */
export interface JsonBlob { __data: string; __len: number; __text?: string }
export interface JsonDate { __date: string }
export interface JsonBigInt { __int: string }
export interface JsonUid { __uid: number }

export const isBlob = (v: unknown): v is JsonBlob => isRecord(v) && typeof v.__data === "string" && typeof v.__len === "number";
export const isDate = (v: unknown): v is JsonDate => isRecord(v) && typeof v.__date === "string";
export const isBigInt = (v: unknown): v is JsonBigInt => isRecord(v) && typeof v.__int === "string";
export const isUid = (v: unknown): v is JsonUid => isRecord(v) && typeof v.__uid === "number";

export const isTagged = (v: unknown): v is JsonBlob | JsonDate | JsonBigInt | JsonUid => isBlob(v) || isDate(v) || isBigInt(v) || isUid(v);

/** A dict in toJsonSafe output: a record that is not a tagged scalar. */
export const isJsonDict = (v: unknown): v is Record<string, unknown> => isRecord(v) && !isTagged(v);

/**
 * Serialise a parsed plist to JSON-safe values, tagging binary and dates.
 * Integers beyond 2^53 become `{ __int: "<decimal>" }` and UIDs `{ __uid: n }`.
 */
export function toJsonSafe(v: PlistValue): unknown {
  if (typeof v === "bigint") return { __int: v.toString() };
  if (v instanceof PlistUid) return { __uid: v.uid };
  if (v instanceof Uint8Array) {
    return { __data: bytesToHex(v), __len: v.length, __text: maybeText(v) };
  }
  if (v instanceof Date) {
    return { __date: Number.isNaN(v.getTime()) ? "invalid date" : v.toISOString() };
  }
  if (Array.isArray(v)) return v.map(toJsonSafe);
  if (isPlistDict(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = toJsonSafe(val);
    return out;
  }
  return v;
}
