/**
 * Decoder for Apple/Qualcomm baseband override files: `overrides_<MODELS>.der.pri`
 * and `global_setting_<X>.der.gri`.
 */
// iOS never parses these: the whole blob goes to the modem as a signed bsp QMI FileTransfer (msg 0xa000) + PDC activate (libCommCenterMCommandDrivers.dylib: QMIBasebandSettingsDriver).
// Layout: SET(0x31) of [0](0x80) records, one setting each: a SEQUENCE(0x30) holding a name/path tag and its value tag, or a bare NV-value tag (corpus: iOS 27.0 overrides).
// Pairs never cross a record, so flattening to leaves and zipping adjacent pairs is exact (corpus: iOS 27.0 overrides).
// An NV-value tag's number IS the legacy NV item number, e.g. 9f8732 = NV 946; every one is listed in 9fa708 (corpus: iOS 27.0 overrides + test fixtures).

import { inflateSync, unzlibSync } from "fflate";
import { bytesToHex } from "./plist";
import { readTlv, type Tlv } from "./der";
import { CCM_ITEMS, annotateNv, describeNv, type NvConfidence } from "./nv";
import { intelTree, type IntelTree } from "./intel";

const td = new TextDecoder();

export interface PriLeaf { tag: string; value: Uint8Array }

/* ------------------------------------------------------------------- DER */

/**
 * Flatten the DER tree into its leaf (tag, value) stream, in file order. Tags
 * stay as identifier hex (`9fa70c`), which is how the tables below name them.
 * Stops quietly at the first malformed element, keeping what came before.
 */
export function flattenDer(buf: Uint8Array, depth = 0): PriLeaf[] {
  const out: PriLeaf[] = [];
  for (let i = 0; i < buf.length; ) {
    let t: Tlv;
    try {
      t = readTlv(buf, i);
    } catch {
      break;
    }
    i = t.end;
    const value = buf.subarray(t.contentStart, t.contentEnd);
    // Records are primitive [0] (0x80) whose content is itself DER.
    if ((t.constructed || t.tag === 0x80) && value.length && depth < 6) {
      const sub = flattenDer(value, depth + 1);
      if (sub.length) { out.push(...sub); continue; }
    }
    out.push({ tag: bytesToHex(buf.subarray(t.start, t.tagEnd)), value });
  }
  return out;
}

/** DER tag number of a hex identifier (low or high form); undefined past 2^53. */
export function tagNumber(tag: string): number | undefined {
  const b = tag.match(/../g)?.map((x) => parseInt(x, 16));
  if (!b?.length) return undefined;
  if ((b[0] & 0x1f) !== 0x1f) return b.length === 1 ? b[0] & 0x1f : undefined;
  let n = 0;
  for (const c of b.slice(1)) n = n * 128 + (c & 0x7f);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Hex identifier of the context-specific primitive tag that carries NV item `n`. */
export function nvTag(n: number): string {
  if (n < 31) return (0x80 | n).toString(16);
  const groups: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 128)) groups.unshift(v % 128);
  return ["9f", ...groups.map((g, k) => (k < groups.length - 1 ? g | 0x80 : g).toString(16).padStart(2, "0"))].join("");
}

/* -------------------------------------------------------------- tag table */

export type PriTagKind = "name" | "path" | "value" | "ccm" | "nv-list" | "schema" | "meta" | "nv";

export interface PriTagInfo {
  name: string;
  kind: PriTagKind;
  /** Value tag that follows a name/path tag. */
  pairsWith?: string;
  /** Legacy NV item this tag carries. */
  nv?: number;
  note?: string;
  confidence: NvConfidence;
}

// NV items seen as value tags (corpus: iOS 27.0 overrides + test fixtures).
const NV_VALUE_ITEMS = [
  10, 401, 426, 442, 553, 855, 909, 946, 947, 1896, 1920, 3461, 3758, 4118, 4210, 4265, 4432, 4703,
  4960, 5895, 6792, 6850, 50014, 50034, 58001, 58002, 58003, 58004, 58005, 58013, 58014, 58021,
  62002, 62005, 62023, 62025, 62026, 62033,
];

export const PRI_TAGS: Record<string, PriTagInfo> = {
  // plaintext .pri in CW_pa: the "Maverick" dict (Carrier ID, PRI Revision) round-trips through this pair
  "9fa711": { kind: "name", pairsWith: "9fa712", name: "Setting name (classic)", confidence: "high" },
  "9fa712": { kind: "value", name: "Setting value (classic)", confidence: "high" },
  // tags 6000..6003: the Intel modem dialect, kept by Apple C1 (fixture ATT_US D321/D331/N841 = iPhone XS/XR, Intel; C1 ftab rkos; Default.bundle global_setting B, G, L)
  "9fae70": { kind: "name", pairsWith: "9fae71", name: "Setting name (Intel / Apple C1)", confidence: "high" },
  "9fae71": { kind: "value", name: "Setting value (Intel / Apple C1)", confidence: "high" },
  // never seen in the corpus or the test fixtures; role inferred from its place next to 9fa70c
  "9fa70e": { kind: "name", pairsWith: "9fa70f", name: "Setting name (CDMA NAM / data parameters)", confidence: "low" },
  "9fa70f": { kind: "value", name: "Setting value (CDMA NAM / data parameters)", confidence: "low" },
  "9fa70c": { kind: "path", pairsWith: "9fa70d", name: "EFS path", confidence: "high" },
  // same role as 9fa70c in older files, long high-tag-number encoding (test fixtures CW_pa, BhartiAirtel_in)
  "9f98808080808080a70c": { kind: "path", pairsWith: "9fa70d", name: "EFS path (long-form tag)", confidence: "high" },
  "9fa70d": { kind: "value", name: "EFS value", confidence: "high" },
  "9fae72": { kind: "path", pairsWith: "9fae73", name: "Intel / Apple C1 setting key (%u: / %qu[N]: + NVM path)", confidence: "high" },
  "9fae73": { kind: "value", name: "Intel / Apple C1 setting value", confidence: "high" },
  "9fa708": { kind: "nv-list", name: "Legacy NV item list (uint16 LE)", confidence: "high" },
  "9fa709": { kind: "schema", name: "NV path schema index (MAVZ or NUL-separated)", confidence: "high" },
  // corpus: always 2 bytes, 0x00b2 in all 333 files that carry it
  "9fa710": { kind: "meta", name: "Blob before the NV item list", note: "small binary blob that precedes the NV item list", confidence: "low" },
  ...Object.fromEntries(
    Object.entries(CCM_ITEMS).map(([n, name]) => [
      nvTag(+n),
      { kind: "ccm", nv: +n, name, confidence: +n === 62035 ? "low" : "high" } satisfies PriTagInfo,
    ]),
  ),
  ...Object.fromEntries(
    NV_VALUE_ITEMS.map((n) => {
      const d = describeNv(n);
      const name = d?.name ?? `NV ${n}`;
      return [nvTag(n), { kind: "nv", nv: n, name, note: `NV ${n}: ${name}`, confidence: d?.confidence ?? "low" } satisfies PriTagInfo];
    }),
  ),
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
    // A NUL-padded fixed-width value is a scalar (0x78 0 0 0 is 120, not "x"); a word
    // or dotted version is text. `preferText` wins where the field declares a string.
    const isScalar = !asText || printable!.padded || asText.length < 2 || !meaningful;
    if (isScalar && !(preferText && asText)) {
      // BigInt: 7- and 8-byte values exceed the exact range of a double.
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

export interface PriPathEntry {
  path: string;
  tag: string;
  value: PriValue;
  /** From the NV lookup (exact path or path family). */
  name?: string;
  meaning?: string;
  /** Enum / bit label for an integer value, when known. */
  label?: string;
  confidence?: NvConfidence;
}

export interface PriCcmFlag {
  index: number;
  /** Raw byte; every byte in the corpus is 0 or 1. */
  value: number;
  set: boolean;
  /** Per-flag meaning; no public or on-device source names any of them. */
  name?: string;
  confidence: NvConfidence | "unknown";
}

export interface PriFeatureGroup {
  tag: string;
  name: string;
  /** Byte indices of the non-zero flags. */
  bits: number[];
  total: number;
  hex: string;
  nv: number;
  confidence: NvConfidence;
  flags: PriCcmFlag[];
  /** False if any byte is outside {0, 1}. */
  boolean: boolean;
}

export interface PriNvEntry {
  item: number;
  tag: string;
  name: string;
  value: PriValue;
  meaning?: string;
  label?: string;
  confidence: NvConfidence;
}

export interface PriNvListed { item: number; name?: string; set: boolean }

export interface PriUnknown {
  tag: string;
  len: number;
  hex: string;
  int?: number;
  ascii?: string;
  note?: string;
  /** Legacy NV item the tag carries (the value is also in `nv`). */
  nv?: number;
  count: number;
}

export interface PriDecoded {
  kind: "der.pri" | "der.gri";
  /** Which modem family the file is written for: Qualcomm (9fa7xx tags), or Intel and its successor Apple C1 (9fae70..73). */
  dialect: "qualcomm" | "intel" | "mixed" | "unknown";
  header: Record<string, string>;
  named: PriPair[];
  efs: PriPathEntry[];
  featureGroups: PriFeatureGroup[];
  /** Legacy NV item list (tag 9fa708) — uint16-LE item numbers. */
  nvItems: number[];
  /** `nvItems` with names, and whether this file carries a value for each. */
  nvListed: PriNvListed[];
  /** Legacy NV item values, one per NV-value tag, in file order. */
  nv: PriNvEntry[];
  /** Schema index of NV paths the PRI format knows about. NOT assigned overrides. */
  schema: { source: "MAVZ" | "raw" | "none"; count: number; paths: string[] };
  /** Every leaf not consumed as a pair, CCM group, list or schema, aggregated by tag. NV values stay here (with `nv`) for older consumers. */
  unknown: PriUnknown[];
  leafCount: number;
  /** Intel-dialect keys (tag 9fae72) as groups, record tables and lists with decoded values; `efs` keeps them flat. */
  intel?: IntelTree;
  error?: string;
}

const HEADER_KEYS = new Set(["Carrier ID", "PRI Revision", "PRI Name", "GRI Revision"]);

/** A decoded value's integer, when it is one that fits a double exactly. */
const scalar = (v: PriValue) => (v.kind === "int" && v.exact === undefined ? v.int : undefined);

function annotate(path: string, v: PriValue): Omit<PriPathEntry, "path" | "tag" | "value"> {
  const a = annotateNv(path, scalar(v));
  return a ? { ...a, meaning: a.meaning ?? a.name } : {};
}

function decodeSchema(value: Uint8Array): PriDecoded["schema"] {
  let raw: Uint8Array | null = null;
  let source: "MAVZ" | "raw" | "none" = "raw";
  if (value.length > 8 && td.decode(value.subarray(0, 4)) === "MAVZ") {
    // "MAVZ" + uint32-LE uncompressed length + zlib (78 9c) stream (corpus: iOS 27.0 overrides)
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
  const paths = raw ? td.decode(raw).split("\0").filter((s) => s.length > 0) : [];
  return { source, count: paths.length, paths };
}

function ccmGroup(tag: string, info: PriTagInfo, value: Uint8Array): PriFeatureGroup {
  const flags: PriCcmFlag[] = Array.from(value, (b, index) => ({ index, value: b, set: b !== 0, confidence: "unknown" as const }));
  return {
    tag,
    name: info.name,
    bits: flags.filter((x) => x.set).map((x) => x.index),
    total: 25,
    hex: bytesToHex(value),
    nv: info.nv!,
    confidence: info.confidence,
    flags,
    boolean: flags.every((x) => x.value <= 1),
  };
}

export function decodePri(buf: Uint8Array, kind: "der.pri" | "der.gri" = "der.pri"): PriDecoded {
  const out: PriDecoded = {
    kind,
    dialect: "unknown",
    header: {},
    named: [],
    efs: [],
    featureGroups: [],
    nvItems: [],
    nvListed: [],
    nv: [],
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
  const intel = leaves.some((l) => /^9fae7[0-3]$/.test(l.tag)), qc = leaves.some((l) => l.tag.startsWith("9fa7"));
  out.dialect = intel && qc ? "mixed" : intel ? "intel" : qc ? "qualcomm" : "unknown";

  // The item list can follow the values it names, so read it first.
  const listed = new Set<number>();
  for (const l of leaves) {
    if (l.tag !== "9fa708") continue;
    for (let k = 0; k + 1 < l.value.length; k += 2) listed.add(l.value[k] | (l.value[k + 1] << 8));
  }

  const unknownAgg = new Map<string, PriUnknown>();
  const seenNv = new Set<number>();

  for (let i = 0; i < leaves.length; i++) {
    const { tag, value } = leaves[i];
    const info = PRI_TAGS[tag];
    const next = leaves[i + 1];
    const paired = info?.pairsWith && next?.tag === info.pairsWith ? next.value : undefined;

    if (info?.kind === "name") {
      const name = td.decode(value);
      const v = decodeValue(paired ?? new Uint8Array(), true);
      if (paired) i++;
      if (HEADER_KEYS.has(name)) out.header[name] = v.kind === "empty" ? "" : v.text;
      else out.named.push({ name, value: v });
      continue;
    }

    if (info?.kind === "path") {
      const path = td.decode(value);
      // "%qu[N]:" / "%s[N]:" declare an N-byte NUL-padded string; without the hint an 8-byte one reads as an integer
      const v = decodeValue(paired ?? new Uint8Array(), path.startsWith("%qu[") || path.startsWith("%s["));
      if (paired) i++;
      out.efs.push({ path, tag, value: v, ...annotate(path, v) });
      continue;
    }

    if (info?.kind === "ccm" && value.length === 25) {
      out.featureGroups.push(ccmGroup(tag, info, value));
      seenNv.add(info.nv!);
      continue;
    }

    if (info?.kind === "nv-list") {
      for (let k = 0; k + 1 < value.length; k += 2) out.nvItems.push(value[k] | (value[k + 1] << 8));
      continue;
    }

    if (info?.kind === "schema") {
      out.schema = decodeSchema(value);
      continue;
    }

    // NV value: a known NV tag, or any tag whose number this file lists in 9fa708.
    const num = info ? info.nv : tagNumber(tag);
    const item = info?.kind === "nv" || (!info && num !== undefined && listed.has(num)) ? num : undefined;
    if (item !== undefined) {
      const v = decodeValue(value, describeNv(item)?.type === "string");
      const a = annotateNv(item, scalar(v));
      out.nv.push({ item, tag, value: v, ...a, name: a?.name ?? `NV ${item}`, confidence: a?.confidence ?? "low" });
      seenNv.add(item);
    }

    // Everything else: aggregate by tag so the UI shows it without drowning.
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
        note: info?.note ?? (item !== undefined ? `NV ${item}: ${out.nv[out.nv.length - 1].name}` : undefined),
        ...(item !== undefined && { nv: item }),
        count: 1,
      });
    }
  }

  const cps = out.efs.filter((e) => e.tag === "9fae72");
  if (cps.length) out.intel = intelTree(cps.map((e) => ({ key: e.path, value: e.value })));
  out.nvListed = out.nvItems.map((n) => ({ item: n, name: describeNv(n)?.name, set: seenNv.has(n) }));
  out.unknown = [...unknownAgg.values()].sort((a, b) => b.count - a.count);
  return out;
}
