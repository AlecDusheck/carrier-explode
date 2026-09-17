/**
 * Decoder for Apple/Qualcomm baseband override files: `overrides_<MODELS>.der.pri`
 * and `global_setting_<X>.der.gri`.
 *
 * Container: DER. Outer SET (0x31) of context-primitive [0] (0x80) elements, each
 * wrapping a SEQUENCE (0x30) of Apple-private high-tag-number fields. Fields are
 * positional pairs — a name/path tag is immediately followed by its value tag — so
 * we flatten to a leaf stream and zip adjacent pairs rather than assuming nesting.
 *
 * Everything below was derived by parsing the live bundle corpus and correlating
 * against the plaintext `.pri` plists that a handful of bundles still ship.
 */

import { inflateSync, unzlibSync } from "fflate";
import { bytesToHex } from "./plist.ts";

const td = new TextDecoder();

export interface PriLeaf { tag: string; value: Uint8Array }

/* ------------------------------------------------------------------- DER */

function readTag(b: Uint8Array, i: number): [string, number] {
  const start = i;
  const t = b[i++];
  if ((t & 0x1f) === 0x1f) {
    // high-tag-number form: continue while the high bit is set
    while (i < b.length && b[i] & 0x80) i++;
    i++;
  }
  return [bytesToHex(b.subarray(start, i)), i];
}

function readLen(b: Uint8Array, i: number): [number, number] {
  if (i >= b.length) throw new Error("DER length byte past end of buffer");
  let l = b[i++];
  if (l & 0x80) {
    const n = l & 0x7f;
    if (n === 0 || n > 4) throw new Error("unsupported DER length form");
    l = 0;
    for (let k = 0; k < n; k++) l = l * 256 + b[i++];
  }
  return [l, i];
}

/** Flatten the DER tree into its leaf (tag, value) stream, in file order. */
export function flattenDer(buf: Uint8Array, depth = 0): PriLeaf[] {
  const out: PriLeaf[] = [];
  let i = 0;
  while (i < buf.length) {
    let tag: string, len: number;
    try {
      [tag, i] = readTag(buf, i);
      [len, i] = readLen(buf, i);
    } catch {
      break;
    }
    if (i + len > buf.length) break;
    const value = buf.subarray(i, i + len);
    i += len;
    const first = parseInt(tag.slice(0, 2), 16);
    const constructed = (first & 0x20) !== 0;
    const ctx0 = first === 0x80;
    if ((constructed || ctx0) && len > 0 && depth < 6) {
      const sub = flattenDer(value, depth + 1);
      if (sub.length) {
        out.push(...sub);
        continue;
      }
    }
    out.push({ tag, value });
  }
  return out;
}

/* -------------------------------------------------------------- tag table */

/** Name/value pair families: [nameTag, valueTag]. */
const NAME_PAIRS: Array<[string, string]> = [
  ["9fa711", "9fa712"], // classic header + named settings
  ["9fae70", "9fae71"], // newer ("Maverick"/CPS) header + named settings
  ["9fa70e", "9fa70f"], // CDMA NAM / Data Parameters named settings
];

/** Path/value pair families: [pathTag, valueTag]. */
const PATH_PAIRS: Array<[string, string]> = [
  ["9fa70c", "9fa70d"], // Qualcomm EFS / NV path -> value
  ["9f98808080808080a70c", "9fa70d"], // same, long-form tag
  ["9fae72", "9fae73"], // "%u:dyn_cps.*" dynamic CPS config -> value
];

/** 25-byte Carrier Configuration Management feature-group bitfields. */
const FEATURE_GROUPS: Record<string, string> = {
  "9f83e439": "CDMA 1X Feature Group",
  "9f83e43a": "EVDO Feature Group",
  "9f83e43b": "System Determination Feature Group",
  "9f83e43c": "Call Manager Feature Group",
  "9f83e43d": "Wireless Messaging Feature Group",
  "9f83e43e": "Data Service Feature Group",
  "9f83e43f": "UIM Service Feature Group",
  "9f83e442": "OMA Feature Group",
  "9f83e453": "Feature Group (unnamed, tag 9f83e453)",
};

const SCHEMA_TAG = "9fa709"; // MAVZ or raw NUL-separated NV path index
const NV_LIST_TAG = "9fa708"; // uint16-LE legacy NV item numbers
const BLOB_TAG = "9fa710"; // small opaque blob that precedes the NV item list

/** Tags seen in the corpus whose meaning is not established. */
export const UNIDENTIFIED_TAGS: Record<string, string> = {
  "9f8732": "WCDMA Band Class Pref b16-b31 (matched against the plaintext .pri plists)",
  "9f8733": "scalar (1 byte)",
  "9f8e68": "scalar (1 byte)",
  "9f83e435": "scalar (4 bytes), appears once per file",
  "9f83e449": "scalar (1 byte)",
  "9f83e451": "scalar (4 bytes)",
  "8a": "scalar (2 bytes), trails the feature-group block",
  "9f8f00": "scalar (4 bytes)",
  "9fa45f": "blob (128 bytes) — observed holding a SUPL H-SLP hostname",
  "9f83e432": "ASCII pattern blob",
};

/* ------------------------------------------------------------ value decode */

export type PriValueKind = "int" | "string" | "xml" | "bytes" | "empty";

export interface PriValue {
  kind: PriValueKind;
  /** Human-readable rendering. */
  text: string;
  /** Little-endian integer for values of 8 bytes or fewer. */
  int?: number;
  /** Exact decimal, present only when the value exceeds the safe integer range. */
  exact?: string;
  hex: string;
  len: number;
  /** Set when the value is an entire XML document. */
  xml?: string;
}

function looksPrintable(b: Uint8Array): { text: string; padded: boolean } | null {
  if (b.length === 0) return null;
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--; // NUL padding
  if (end === 0) return null;
  for (let i = 0; i < end; i++) {
    const c = b[i];
    if (!(c === 9 || c === 10 || c === 13 || (c >= 0x20 && c < 0x7f))) return null;
  }
  return { text: td.decode(b.subarray(0, end)), padded: end < b.length };
}

export function decodeValue(b: Uint8Array, preferText = false): PriValue {
  const hex = bytesToHex(b);
  if (b.length === 0) return { kind: "empty", text: "(empty)", hex, len: 0 };

  const printable = looksPrintable(b);
  const asText = printable?.text;
  if (asText && /^\s*<\?xml/.test(asText)) {
    return { kind: "xml", text: asText, xml: asText, hex, len: b.length };
  }

  const meaningful =
    !!asText && (/[A-Za-z/:;=_@#-]/.test(asText) || /^\d+(\.\d+)+$/.test(asText));

  if (b.length <= 8) {
    // Short fields are ambiguous. A value that was NUL-padded to a fixed width is
    // a scalar (0x78 0x00 0x00 0x00 is 120, not "x"); anything else that reads as
    // a word or a dotted version is text. `preferText` overrides this where the
    // field itself declares a string type.
    const isScalar = !asText || printable!.padded || asText.length < 2 || !meaningful;
    if (isScalar && !(preferText && asText)) {
      // Accumulate in BigInt: 7- and 8-byte values exceed the exact range of a
      // double, so a running `n * 256 + byte` would silently round.
      let big = 0n;
      for (let i = b.length - 1; i >= 0; i--) big = (big << 8n) | BigInt(b[i]);
      const n = Number(big);
      return {
        kind: "int",
        text: big.toString(),
        int: n,
        exact: Number.isSafeInteger(n) ? undefined : big.toString(),
        hex,
        len: b.length,
      };
    }
    return { kind: "string", text: asText!, hex, len: b.length };
  }

  if (asText) return { kind: "string", text: asText, hex, len: b.length };
  return { kind: "bytes", text: `${b.length} bytes`, hex, len: b.length };
}

/* ------------------------------------------------------------------ output */

export interface PriPair { name: string; value: PriValue }
export interface PriPathEntry { path: string; tag: string; value: PriValue }
export interface PriFeatureGroup {
  tag: string;
  name: string;
  bits: number[];
  total: number;
  hex: string;
}
export interface PriUnknown {
  tag: string;
  len: number;
  hex: string;
  int?: number;
  ascii?: string;
  note?: string;
  count: number;
}

export interface PriDecoded {
  kind: "der.pri" | "der.gri";
  header: Record<string, string>;
  named: PriPair[];
  efs: PriPathEntry[];
  featureGroups: PriFeatureGroup[];
  /** Legacy NV item list (tag 9fa708) — uint16-LE item numbers. */
  nvItems: number[];
  /** Schema index of NV paths the PRI format knows about. NOT assigned overrides. */
  schema: { source: "MAVZ" | "raw" | "none"; count: number; paths: string[] };
  unknown: PriUnknown[];
  leafCount: number;
  error?: string;
}

export function decodePri(buf: Uint8Array, kind: "der.pri" | "der.gri" = "der.pri"): PriDecoded {
  const out: PriDecoded = {
    kind,
    header: {},
    named: [],
    efs: [],
    featureGroups: [],
    nvItems: [],
    schema: { source: "none", count: 0, paths: [] },
    unknown: [],
    leafCount: 0,
  };

  let leaves: PriLeaf[];
  try {
    leaves = flattenDer(buf);
  } catch (e) {
    out.error = `DER parse failed: ${(e as Error).message}`;
    return out;
  }
  out.leafCount = leaves.length;

  const nameTags = new Map(NAME_PAIRS);
  const pathTags = new Map(PATH_PAIRS);
  const unknownAgg = new Map<string, PriUnknown>();
  const HEADER_KEYS = new Set(["Carrier ID", "PRI Revision", "PRI Name", "GRI Revision"]);

  for (let i = 0; i < leaves.length; i++) {
    const { tag, value } = leaves[i];
    const next = leaves[i + 1];

    if (nameTags.has(tag)) {
      const want = nameTags.get(tag)!;
      const name = td.decode(value);
      const v = next && next.tag === want ? decodeValue(next.value, true) : decodeValue(new Uint8Array());
      if (next && next.tag === want) i++;
      if (HEADER_KEYS.has(name)) out.header[name] = v.kind === "empty" ? "" : v.text;
      else out.named.push({ name, value: v });
      continue;
    }

    if (pathTags.has(tag)) {
      const want = pathTags.get(tag)!;
      const path = td.decode(value);
      // A `%qu[N]:` path declares an N-byte NUL-padded ASCII string; without this
      // hint an 8-byte one would be read as a little-endian integer.
      const quoted = path.startsWith("%qu[");
      const v = next && next.tag === want
        ? decodeValue(next.value, quoted)
        : decodeValue(new Uint8Array());
      if (next && next.tag === want) i++;
      out.efs.push({ path, tag, value: v });
      continue;
    }

    if (FEATURE_GROUPS[tag] && value.length === 25) {
      const bits: number[] = [];
      for (let k = 0; k < 25; k++) if (value[k]) bits.push(k);
      out.featureGroups.push({
        tag,
        name: FEATURE_GROUPS[tag],
        bits,
        total: 25,
        hex: bytesToHex(value),
      });
      continue;
    }

    if (tag === NV_LIST_TAG) {
      for (let k = 0; k + 1 < value.length; k += 2) out.nvItems.push(value[k] | (value[k + 1] << 8));
      continue;
    }

    if (tag === SCHEMA_TAG) {
      let raw: Uint8Array | null = null;
      let source: "MAVZ" | "raw" | "none" = "raw";
      if (value.length > 8 && value[0] === 0x4d && value[1] === 0x41 && value[2] === 0x56 && value[3] === 0x5a) {
        // "MAVZ" + uint32-LE uncompressed length, then a zlib stream.
        source = "MAVZ";
        const body = value.subarray(8);
        try {
          raw = unzlibSync(body);
        } catch {
          try {
            raw = inflateSync(body); // tolerate a bare DEFLATE payload
          } catch {
            raw = null;
          }
        }
      } else if (value[0] === 0x2f /* '/' */) {
        raw = value;
      } else {
        source = "none";
      }
      if (raw) {
        const paths = td.decode(raw).split("\0").filter((s) => s.length > 0);
        out.schema = { source, count: paths.length, paths };
      } else {
        out.schema = { source, count: 0, paths: [] };
      }
      continue;
    }

    // Anything else: aggregate by tag so the UI shows it without drowning.
    const prev = unknownAgg.get(tag);
    if (prev) {
      prev.count++;
    } else {
      const dv = decodeValue(value);
      unknownAgg.set(tag, {
        tag,
        len: value.length,
        hex: bytesToHex(value).slice(0, 256),
        int: dv.int,
        ascii: dv.kind === "string" ? dv.text : undefined,
        note: tag === BLOB_TAG ? "small binary blob that precedes the NV item list" : UNIDENTIFIED_TAGS[tag],
        count: 1,
      });
    }
  }

  out.unknown = [...unknownAgg.values()].sort((a, b) => b.count - a.count);
  return out;
}
