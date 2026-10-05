/**
 * Decoder for Apple/Qualcomm baseband override files: `overrides_<MODELS>.der.pri`,
 * `global_setting_<X>.der.gri`, and the Apple-modem form of `overrides_<MODELS>.der.tri`.
 */
// Layout: SET(0x31) of [0](0x80) records, one setting each: a SEQUENCE holding a name/path tag and its value tag, or a bare NV-value tag.
// Pairs never cross a record, so flattening to leaves and zipping adjacent pairs is exact.
// iOS never parses these: CommCenter sends the blob to the modem whole, so meanings come from the modem side.

import { asciiAt, bytesToHex, errorMessage, hexToBytes, leBigInt, maybeText, u16le } from "@carrier-explode/binary";
import { inflateMavz } from "./bbcfg.ts";
import { readTlv, type Tlv } from "./der.ts";
import { annotateNv, CCM_FLAG_BYTES, CCM_ITEMS, type Confidence, type ConfidenceOrUnknown, describeNv } from "@carrier-explode/decode-qualcomm";
import { describeIntelKey, intelTree, type IntelTree } from "./intel.ts";

const td = new TextDecoder();

export interface PriLeaf { tag: string; value: Uint8Array }

export interface DerLeaves {
  readonly leaves: PriLeaf[];
  /** Where a malformed top-level element ended the read, and why; the leaves before it are kept. */
  readonly stopped?: { readonly at: number; readonly reason: string };
}

/**
 * Flatten the DER tree into its leaf (tag, value) stream, in file order. Tags
 * stay as identifier hex (`9fa70c`), which is how the tables below name them.
 */
export function flattenDer(buf: Uint8Array): DerLeaves {
  const leaves: PriLeaf[] = [];
  const stop = collectLeaves(buf, 0, leaves);
  return stop === undefined ? { leaves } : { leaves, stopped: stop };
}

function collectLeaves(buf: Uint8Array, depth: number, out: PriLeaf[]): DerLeaves["stopped"] {
  for (let i = 0; i < buf.length; ) {
    let t: Tlv;
    try {
      t = readTlv(buf, i);
    } catch (e) {
      return { at: i, reason: errorMessage(e) };
    }
    i = t.end;
    const value = buf.subarray(t.contentStart, t.contentEnd);
    // Records are primitive [0] (0x80) whose content is usually DER; content that is not stays one leaf.
    if ((t.constructed || t.tag === 0x80) && value.length && depth < 6) {
      const sub: PriLeaf[] = [];
      collectLeaves(value, depth + 1, sub);
      if (sub.length) { out.push(...sub); continue; }
    }
    out.push({ tag: bytesToHex(buf.subarray(t.start, t.tagEnd)), value });
  }
  return undefined;
}

/** `{ note }` to spread, or nothing. */
const noteOf = (note: string | undefined): { note?: string } => (note === undefined ? {} : { note });

/** DER tag number of a hex identifier (low or high form); undefined past 2^53. */
export function tagNumber(tag: string): number | undefined {
  const [first, ...rest] = hexToBytes(tag);
  if (first === undefined) return undefined;
  if ((first & 0x1f) !== 0x1f) return rest.length === 0 ? first & 0x1f : undefined;
  let n = 0;
  for (const c of rest) n = n * 128 + (c & 0x7f);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Hex identifier of the context-specific primitive tag that carries NV item `n`. */
export function nvTag(n: number): string {
  if (n < 31) return (0x80 | n).toString(16);
  const groups: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 128)) groups.unshift(v % 128);
  return ["9f", ...groups.map((g, k) => (k < groups.length - 1 ? g | 0x80 : g).toString(16).padStart(2, "0"))].join("");
}

export type PriTagKind = "name" | "path" | "value" | "ccm" | "nv-list" | "schema" | "meta" | "nv";

export interface PriTagInfo {
  name: string;
  kind: PriTagKind;
  /** Value tag that follows a name/path tag. */
  pairsWith?: string;
  /** Legacy NV item this tag carries. */
  nv?: number;
  note?: string;
  confidence: Confidence;
}

/**
 * Who sets each CCM flag, and what the modem does with it where its code shows.
 * Bundles: 365 Qualcomm overrides in 94 current bundles (October 2026); every other flag is never set.
 * Modem: Mav25 qdsp6sw.mbn, mav_ccm.c. A flag is feature (group base + index), read with
 * mav_ccm_is_feature_enabled_for_subs(feature, sub); EVDO, UIM and OMA are marked obsolete there and never loaded.
 */
export const CCM_FLAG_NOTES: Record<number, Record<number, string>> = {
  62009: { 4: "Set only by Appalachian Wireless and C Spire, both former CDMA carriers" },
  62011: {
    6: "Set only by former CDMA regional carriers in the US (US Cellular, C Spire, Appalachian, Cellcom, Carolina West, AppWire)",
    17: "Set only by Optus and Telstra. The modem's out-of-service system scan then keeps its default band mask instead of the stored band set (medium confidence)",
  },
  62012: {
    0: "Set only by SoftBank, Y!mobile and Iusacell, on older iPhones",
    1: "Set only by former CDMA regional carriers in the US, on older iPhones",
    6: "Set only by KDDI's LTE-only bundles, always with flag 15",
    12: "Set only on AT&T's network (AT&T, its brands and Dish), always with flag 3 of the unnamed group",
    14: "Set for iPhone 12 and 13; a file sets this or flag 20, rarely both",
    15: "Set only by KDDI's LTE-only bundles, always with flag 6",
    20: "Set for every iPhone from iPhone 14, and on older iPhones only by carriers that have shut down 3G; likely the newer form of flag 14",
  },
  62013: { 2: "Set only by C Spire" },
  62014: {
    3: "Set only on Verizon's network: Verizon, its MVNOs and the LTE in Rural America partners on its core",
    5: "Set only by former CDMA carriers not on Verizon's core (US Cellular, C Spire, Carolina West)",
  },
  62015: { 6: "Set only on Verizon's network; the UIM group is obsolete in the iPhone 17 modem, so it does nothing there" },
  62035: {
    2: "Set only by T-Mobile US",
    3: "Set only on AT&T's network, always with Call Manager flag 12. The modem checks it in its geo-MCC attach logic, alongside a home-network check (medium confidence)",
  },
};

// NV items seen as value tags.
const NV_VALUE_ITEMS = [
  10, 401, 426, 442, 553, 855, 909, 946, 947, 1896, 1920, 3461, 3758, 4118, 4210, 4265, 4432, 4703,
  4960, 5895, 6792, 6850, 50014, 50034, 58001, 58002, 58003, 58004, 58005, 58013, 58014, 58021,
  62002, 62005, 62023, 62025, 62026, 62033,
];

export const PRI_TAGS: Record<string, PriTagInfo> = {
  // plaintext .pri in CW_pa: the "Maverick" dict (Carrier ID, PRI Revision) round-trips through this pair
  "9fa711": { kind: "name", pairsWith: "9fa712", name: "Setting name (classic)", confidence: "high" },
  "9fa712": { kind: "value", name: "Setting value (classic)", confidence: "high" },
  // tags 6000..6003: the Intel modem dialect, kept by Apple C1
  "9fae70": { kind: "name", pairsWith: "9fae71", name: "Setting name (Intel / Apple C1)", confidence: "high" },
  "9fae71": { kind: "value", name: "Setting value (Intel / Apple C1)", confidence: "high" },
  // role inferred from its place next to 9fa70c
  "9fa70e": { kind: "name", pairsWith: "9fa70f", name: "Setting name (CDMA NAM / data parameters)", confidence: "low" },
  "9fa70f": { kind: "value", name: "Setting value (CDMA NAM / data parameters)", confidence: "low" },
  "9fa70c": { kind: "path", pairsWith: "9fa70d", name: "EFS path", confidence: "high" },
  // same role as 9fa70c in older files, long high-tag-number encoding
  "9f98808080808080a70c": { kind: "path", pairsWith: "9fa70d", name: "EFS path (long-form tag)", confidence: "high" },
  "9fa70d": { kind: "value", name: "EFS value", confidence: "high" },
  "9fae72": { kind: "path", pairsWith: "9fae73", name: "Intel / Apple C1 setting key (%u: / %qu[N]: + NVM path)", confidence: "high" },
  "9fae73": { kind: "value", name: "Intel / Apple C1 setting value", confidence: "high" },
  "9fa708": { kind: "nv-list", name: "Legacy NV item list (uint16 LE)", confidence: "high" },
  "9fa709": { kind: "schema", name: "NV path schema index (MAVZ or NUL-separated)", confidence: "high" },
  "9fa710": { kind: "meta", name: "Blob before the NV item list", note: "small binary blob that precedes the NV item list", confidence: "low" },
  .../* @__PURE__ */ Object.fromEntries(
    Object.entries(CCM_ITEMS).map(([n, { name, confidence }]) => [
      nvTag(+n),
      { kind: "ccm", nv: +n, name, confidence } satisfies PriTagInfo,
    ]),
  ),
  .../* @__PURE__ */ Object.fromEntries(
    NV_VALUE_ITEMS.map((n) => {
      const d = describeNv(n);
      const name = d?.name ?? `NV ${n}`;
      return [nvTag(n), { kind: "nv", nv: n, name, note: `NV ${n}: ${name}`, confidence: d?.confidence ?? "low" } satisfies PriTagInfo];
    }),
  ),
};

export type PriValueKind = "int" | "string" | "xml" | "bytes" | "empty";

interface PriValueBase {
  /** Human-readable rendering; for "xml" the whole document. */
  readonly text: string;
  readonly hex: string;
  readonly len: number;
}

export type PriValue =
  | (PriValueBase & {
    readonly kind: "int";
    /** Little-endian integer of a value of 8 bytes or fewer. */
    readonly int: number;
    /** Exact decimal, present only when the value exceeds the safe integer range. */
    readonly exact?: string;
  })
  | (PriValueBase & { readonly kind: Exclude<PriValueKind, "int"> });

/** The value as text at any length, and whether NUL padding followed it. */
function looksPrintable(b: Uint8Array): { text: string; padded: boolean } | undefined {
  const text = maybeText(b, Infinity);
  return text === undefined ? undefined : { text, padded: b[b.length - 1] === 0 };
}

export function decodeValue(b: Uint8Array, preferText = false): PriValue {
  const hex = bytesToHex(b);
  if (b.length === 0) return { kind: "empty", text: "(empty)", hex, len: 0 };

  const printable = looksPrintable(b);
  const asText = printable?.text;
  // A whole document, with or without the prolog (data_3gpp_dynamic_config.xml has none).
  if (asText && /^\s*<(\?xml|[A-Za-z_][\w.-]*[\s/>])[\s\S]*>\s*$/.test(asText)) {
    return { kind: "xml", text: asText, hex, len: b.length };
  }

  const meaningful =
    !!asText && (/[A-Za-z/:;=_@#-]/.test(asText) || /^\d+(\.\d+)+$/.test(asText));

  if (b.length <= 8) {
    // A NUL-padded fixed-width value is a scalar (0x78 0 0 0 is 120, not "x"); a word
    // or dotted version is text. `preferText` wins where the field declares a string.
    const isScalar = !printable || printable.padded || printable.text.length < 2 || !meaningful;
    if (printable && (preferText || !isScalar)) return { kind: "string", text: printable.text, hex, len: b.length };
    // BigInt: 7- and 8-byte values exceed the exact range of a double.
    const big = leBigInt(b);
    const n = Number(big);
    return {
      kind: "int",
      text: big.toString(),
      int: n,
      ...(Number.isSafeInteger(n) ? {} : { exact: big.toString() }),
      hex,
      len: b.length,
    };
  }

  if (asText) return { kind: "string", text: asText, hex, len: b.length };
  return { kind: "bytes", text: `${b.length} bytes`, hex, len: b.length };
}

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
  confidence?: Confidence;
}

export interface PriCcmFlag {
  index: number;
  /** Raw byte; every byte in the corpus is 0 or 1. */
  value: number;
  set: boolean;
  /** Per-flag meaning; no public or on-device source names any of them. */
  name?: string;
  /** Which carriers set it, from the bundles. */
  note?: string;
  confidence: ConfidenceOrUnknown;
}

export interface PriFeatureGroup {
  tag: string;
  name: string;
  /** Byte indices of the non-zero flags. */
  bits: number[];
  total: number;
  hex: string;
  nv: number;
  confidence: Confidence;
  flags: PriCcmFlag[];
  /** False if any byte is outside {0, 1}. */
  boolean: boolean;
}

export interface PriNvEntry {
  item: number;
  tag: string;
  /** Absent when no NV table names the item. */
  name?: string;
  value: PriValue;
  meaning?: string;
  label?: string;
  confidence: Confidence;
}

export interface PriNvListed { item: number; name?: string; set: boolean }

export interface PriUnknown {
  tag: string;
  len: number;
  hex: string;
  int?: number;
  ascii?: string;
  note?: string;
  count: number;
}

/** Which modem family a PRI is written for: Qualcomm (9fa7xx tags), or Intel and its successor Apple C1 (9fae70..73). */
export type PriDialect = "qualcomm" | "intel" | "mixed" | "unknown";

/** The member extensions a DER PRI comes under. */
const PRI_FORMATS = ["der.pri", "der.gri", "der.tri"] as const;
export type PriFormat = (typeof PRI_FORMATS)[number];

export interface PriDecoded {
  kind: PriFormat;
  dialect: PriDialect;
  header: Record<string, string>;
  named: PriPair[];
  efs: PriPathEntry[];
  featureGroups: PriFeatureGroup[];
  /** Legacy NV item list (tag 9fa708): uint16-LE item numbers. */
  nvItems: number[];
  /** `nvItems` with names, and whether this file carries a value for each. */
  nvListed: PriNvListed[];
  /** Legacy NV item values, one per NV-value tag, in file order. */
  nv: PriNvEntry[];
  /** Schema index of the NV paths the PRI format knows; not overrides this file assigns. */
  schema: { source: "MAVZ" | "raw" | "none"; count: number; paths: string[] };
  /** Every leaf not consumed as a pair, CCM group, list, schema or NV value, aggregated by tag. */
  unknown: PriUnknown[];
  leafCount: number;
  /** Intel-dialect keys (tag 9fae72) as groups, record tables and lists with decoded values; `efs` keeps them flat. */
  intel?: IntelTree;
  /** What could not be read: DER that stops early (everything before it is decoded), a corrupt schema index. */
  errors: string[];
}

const HEADER_KEYS = new Set(["Carrier ID", "PRI Revision", "PRI Name", "GRI Revision"]);

/** A decoded value's integer, when it is one that fits a double exactly. */
const scalar = (v: PriValue): number | undefined => (v.kind === "int" && v.exact === undefined ? v.int : undefined);

function annotate(path: string, v: PriValue, raw: Uint8Array): Omit<PriPathEntry, "path" | "tag" | "value"> {
  const intel = describeIntelKey(path);
  const a = intel ? { name: intel.name, meaning: intel.meaning, confidence: intel.confidence } : annotateNv(path, scalar(v), raw);
  return a ? { ...a, meaning: a.meaning ?? a.name } : {};
}

const NO_SCHEMA: PriDecoded["schema"] = { source: "none", count: 0, paths: [] };

/** The schema index, or why it could not be read. */
function decodeSchema(value: Uint8Array): PriDecoded["schema"] | { error: string } {
  let raw: Uint8Array;
  let source: "MAVZ" | "raw";
  // "MAVZ" + uint32-LE uncompressed length + zlib stream.
  if (value.length > 8 && asciiAt(value, 0, "MAVZ")) {
    source = "MAVZ";
    try {
      raw = inflateMavz(value);
    } catch (e) {
      return { error: `MAVZ schema index: ${errorMessage(e)}` };
    }
  } else if (value[0] === 0x2f /* '/' */) {
    source = "raw";
    raw = value;
  } else {
    return NO_SCHEMA;
  }
  const paths = td.decode(raw).split("\0").filter((s) => s.length > 0);
  return { source, count: paths.length, paths };
}

function ccmGroup(tag: string, info: PriTagInfo, nv: number, value: Uint8Array): PriFeatureGroup {
  const notes = CCM_FLAG_NOTES[nv] ?? {};
  const flags: PriCcmFlag[] = Array.from(value, (b, index) => ({
    index, value: b, set: b !== 0, confidence: "unknown" as const, ...(notes[index] && { note: notes[index] }),
  }));
  return {
    tag,
    name: info.name,
    bits: flags.filter((x) => x.set).map((x) => x.index),
    total: CCM_FLAG_BYTES,
    hex: bytesToHex(value),
    nv,
    confidence: info.confidence,
    flags,
    boolean: flags.every((x) => x.value <= 1),
  };
}

export function decodePri(buf: Uint8Array, kind: PriFormat = "der.pri"): PriDecoded {
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
    schema: NO_SCHEMA,
    unknown: [],
    leafCount: 0,
    errors: [],
  };

  const { leaves, stopped } = flattenDer(buf);
  if (stopped) out.errors.push(`DER stops at byte ${stopped.at}: ${stopped.reason}`);
  out.leafCount = leaves.length;
  const intel = leaves.some((l) => /^9fae7[0-3]$/.test(l.tag)), qc = leaves.some((l) => l.tag.startsWith("9fa7"));
  out.dialect = intel && qc ? "mixed" : intel ? "intel" : qc ? "qualcomm" : "unknown";

  // The item list can follow the values it names, so read it first.
  const listed = new Set<number>();
  for (const l of leaves) {
    if (l.tag !== "9fa708") continue;
    for (let k = 0; k + 1 < l.value.length; k += 2) listed.add(u16le(l.value, k));
  }

  const unknownAgg = new Map<string, PriUnknown>();
  const seenNv = new Set<number>();

  for (let i = 0, leaf = leaves[0]; leaf !== undefined; leaf = leaves[++i]) {
    const { tag, value } = leaf;
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
      out.efs.push({ path, tag, value: v, ...annotate(path, v, paired ?? new Uint8Array()) });
      continue;
    }

    if (info?.kind === "ccm" && info.nv !== undefined && value.length === CCM_FLAG_BYTES) {
      out.featureGroups.push(ccmGroup(tag, info, info.nv, value));
      seenNv.add(info.nv);
      continue;
    }

    if (info?.kind === "nv-list") {
      for (let k = 0; k + 1 < value.length; k += 2) out.nvItems.push(u16le(value, k));
      continue;
    }

    if (info?.kind === "schema") {
      const schema = decodeSchema(value);
      if ("error" in schema) out.errors.push(schema.error);
      else out.schema = schema;
      continue;
    }

    // NV value: a known NV tag, or any tag whose number this file lists in 9fa708.
    const num = info ? info.nv : tagNumber(tag);
    const item = info?.kind === "nv" || (!info && num !== undefined && listed.has(num)) ? num : undefined;
    if (item !== undefined) {
      const v = decodeValue(value, describeNv(item)?.type === "string");
      const a = annotateNv(item, scalar(v));
      out.nv.push({ item, tag, value: v, ...a, confidence: a?.confidence ?? "low" });
      seenNv.add(item);
      continue;
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
        ...(dv.kind === "int" ? { int: dv.int } : {}),
        ...(dv.kind === "string" ? { ascii: dv.text } : {}),
        ...noteOf(info?.note),
        count: 1,
      });
    }
  }

  const cps = out.efs.filter((e) => e.tag === "9fae72");
  if (cps.length) out.intel = intelTree(cps.map((e) => ({ key: e.path, value: e.value })));
  out.nvListed = out.nvItems.map((n) => {
    const name = describeNv(n)?.name;
    return { item: n, ...(name !== undefined ? { name } : {}), set: seenNv.has(n) };
  });
  out.unknown = [...unknownAgg.values()].sort((a, b) => b.count - a.count);
  return out;
}
