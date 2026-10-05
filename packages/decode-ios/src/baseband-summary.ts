/**
 * The stored summary of an Apple Qualcomm baseband package (`Mav*.bbfw`):
 * its containers, MCFG images, text files, NV records, band combos, modem
 * databases and fake base station settings, as one JSON-safe record.
 */

import { asciiAt, byteAt, bytesToHex, errorMessage, inflateCapped, leUint, sha1Hex } from "@carrier-explode/binary";
import { BBCFG_FILE_TYPES, decodeBbcfgBlob, fileTypeName, isBbcfg, readBbcfg, type BbcfgBlob, type BbcfgMeta } from "./bbcfg.ts";
import {
  type AmprGroup, annotateNv, type ComboStats, comboStats, type Confidence, decodeModemEfs, isZlibStart, itemPaths, type MccScanEntry,
  mcfgItemData, type McfgTrailer, type McfgTrailerSummary, type MdbHeader, parseAmprNs, parseBandCombos, parseMcc2Arfcn,
  parsePlmnFeatures, parseSsgccs, type PlmnFeatures, readMdb, scanModemConfigs, type SsgccsConfig, summarizeTrailer, type XmlRefs,
  xmlRefs,
} from "@carrier-explode/decode-qualcomm";
import type { MccMncEntry, MccMncTable, MvnoRule } from "./manifest.ts";
import { MODEM_SUMMARY_SCHEMA, modemGeneration } from "./modem.ts";
import { isPlistDict, parsePlist } from "./plist.ts";

const td = new TextDecoder();

export const CONTENT_FORMATS = ["xml", "text", "mdb", "bin"] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

const isSpace = (c: number): boolean => c === 0x20 || (c >= 9 && c <= 13);

/** XML by its prologue or first tag, text when printable. */
export function contentFormat(d: Uint8Array, path = ""): ContentFormat {
  let i = 0;
  while (i < d.length && i < 64 && isSpace(byteAt(d, i))) i++;
  if (d[i] === 0x3c && (asciiAt(d, i, "<?xml") || /[A-Za-z_]/.test(String.fromCharCode(d[i + 1] ?? 0)))) return "xml";
  if (path.endsWith(".mdb")) return "mdb";
  if (path.endsWith(".txt")) return "text";
  if (d.length >= 8) {
    if (d.every((x) => (x >= 32 && x < 127) || x === 9 || x === 10 || x === 13)) return "text";
  }
  return "bin";
}

/** Zlib NV value (pt.mbn RFNV), inflated; undefined when it is not one. */
function inflateNv(v: Uint8Array): Uint8Array | undefined {
  if (!(v[0] === 0x78 && (v[1] === 0x9c || v[1] === 0xda))) return undefined;
  try {
    return inflateCapped(v, 16 << 20);
  } catch {
    // A value that only starts like a zlib header is a plain value.
    return undefined;
  }
}

export interface Variant { platform: number; sku: number; hwRev: number }

export interface BasebandFile {
  member: string;
  path: string;
  format: ContentFormat;
  length: number;
  sha1: string;
  /** xml/text content. */
  text?: string;
  /** Other content, as hex. */
  hex?: string;
  /** Container blobs (bbcfg.mbn / pt.mbn) carrying this content. */
  blobs?: number[];
  variants?: Variant[];
  /** Modem built-in configs (qdsp6sw.mbn) carrying it, by label. */
  configs?: string[];
  refs?: XmlRefs;
}

export interface BasebandNvRecord {
  nv?: number;
  efs?: string;
  hex: string;
  f11?: number;
  f14?: number;
  f77?: number;
  f78?: number;
  /** From the NV/EFS tables, when known (nv.ts). */
  name?: string;
  meaning?: string;
  /** What the value means, for scalar values the tables describe. */
  label?: string;
  confidence?: Confidence;
}

export interface BasebandNvBlob {
  member: string;
  blob: number;
  fileType: number;
  fileTypeName: string;
  digest: string;
  variants: Variant[];
  records: BasebandNvRecord[];
}

export interface BasebandImage {
  member: string;
  blob: number;
  fileType: number;
  fileTypeName: string;
  variants: Variant[];
  cfgType: string;
  version: string;
  trailer?: McfgTrailerSummary;
  files: string[];
}

export interface BasebandContainer {
  member: string;
  magic: string;
  headerVersion: number;
  meta: BbcfgMeta;
  records: number;
  blobs: number;
  /** Per file type: its name and, for known types, how sure the name is and what the type holds. */
  fileTypes: Array<{ type: number; name: string; confidence?: Confidence; note?: string; blobs: number; records: number }>;
  /** Blobs that failed to decode. */
  errors?: Array<{ blob: number; error: string }>;
}

export interface CarrierMapping {
  plmns: string[];
  /** Each PLMN's default bundle: its top-level BundleName, or an MVNO row whose GID1+GID2 is all F. */
  bundles: string[];
  /** Every other bundle Apple routes from those PLMNs by GID/ICCID. */
  mvnoBundles: string[];
}

export interface BandComboSet {
  /** sha1 of the band_combos_per_plmn.xml variant (see `files`). */
  sha1: string;
  variants: Variant[];
  carriers: Array<{ tag: string; plmns: string[] } & ComboStats>;
}

export interface ModemConfigSummary {
  offset: number;
  container: "zlib" | "plain";
  length: number;
  label?: string;
  cfgType: string;
  format: number;
  version: string;
  trailer?: McfgTrailerSummary;
  files: string[];
}

export interface BasebandMdb {
  member: string;
  path: string;
  sha1: string;
  variants?: Variant[];
  configs?: string[];
  header?: MdbHeader;
  /** mcc2arfcn: NR frequency ranges per country. */
  scan?: MccScanEntry[];
  /** plmn2features: feature id/value pairs per network. */
  features?: PlmnFeatures[];
  error?: string;
}

export interface BasebandModemEfs {
  member: string;
  path: string;
  sha1: string;
  variants?: Variant[];
  configs?: string[];
  hex: string;
  name: string;
  value: string;
  confidence: Confidence;
}

export interface BasebandSsgccs {
  variants?: Variant[];
  configs?: string[];
  /** The files it was read from, with their text. */
  files: Array<{ path: string; sha1: string; text: string }>;
  config: SsgccsConfig;
}

export interface BasebandSummary {
  schema: typeof MODEM_SUMMARY_SCHEMA;
  kind: "bbfw";
  package: {
    name?: string;
    /** "Mav25", from the name (modem.ts). */
    family?: string;
    version?: string;
    chipId?: string;
    sblVersion?: string;
    restoreSblVersion?: string;
  };
  members: Array<{ name: string; size: number }>;
  containers: BasebandContainer[];
  files: BasebandFile[];
  nv: BasebandNvBlob[];
  images: BasebandImage[];
  bandCombos: BandComboSet[];
  /** band_combos_per_plmn.xml tag -> carrier bundles, from the OTA manifest's MobileDeviceCarriersByMccMnc. */
  carrierMap?: Record<string, CarrierMapping>;
  /** pt.mbn NV 64628: A-MPR network-signalling values per MCC group and LTE band. */
  amprNs: Array<{ sha1: string; variants: Variant[]; groups: AmprGroup[] }>;
  /** Built-in configs of the modem image; undefined when qdsp6sw.mbn was not given. */
  modemConfigs?: ModemConfigSummary[];
  /** /mdb/*.mdb databases and small EFS settings, decoded; undefined when there are none. */
  mdb?: {
    databases: BasebandMdb[];
    settings: BasebandModemEfs[];
    /** plmn2features PLMN -> default carrier bundles, from the OTA manifest. */
    plmnBundles?: Record<string, string[]>;
  };
  /** Fake base station detection (SSGCCS), one entry per distinct pair of config files. */
  ssgccs?: BasebandSsgccs[];
}

export interface BasebandSummaryOptions {
  /** Package file name, e.g. "Mav25-2.10.01.Release.bbfw". */
  name?: string;
  /** Every zip member with its size, when only some are passed in `members`. */
  listing?: Array<{ name: string; size: number }>;
  /** The OTA manifest's PLMN table, which maps band-combo tags and PLMNs to carrier bundles. */
  mccMnc?: MccMncTable;
}

// ft 15/17/20 hold the protocol/carrier settings worth listing record by record
const NV_TYPES = new Set([15, 17, 20]);

/** A PLMN's default bundles (its own, and MVNO rows whose GID1+GID2 is all F) and the bundles its other MVNO rows route to. */
function plmnBundles(e: MccMncEntry): { bundles: string[]; mvnos: string[] } {
  const isDefault = (m: MvnoRule): boolean => /^F+$/.test(`${m.gid1 ?? ""}${m.gid2 ?? ""}`.toUpperCase());
  const named = e.mvnos.filter((m) => m.bundle !== "");
  const bundles = [...(e.bundle !== undefined ? [e.bundle] : []), ...named.filter(isDefault).map((m) => m.bundle)];
  return { bundles, mvnos: named.map((m) => m.bundle).filter((b) => !bundles.includes(b)) };
}

/** Bundles for each band-combo tag, derived from its PLMN list. */
export function mapComboCarriers(carriers: Array<{ tag: string; plmns: string[] }>, table: MccMncTable): Record<string, CarrierMapping> {
  const byPlmn = new Map(table.entries.map((e) => [e.plmn, e]));
  const out: Record<string, CarrierMapping> = {};
  for (const { tag, plmns } of carriers) {
    const m = (out[tag] ??= { plmns: [], bundles: [], mvnoBundles: [] });
    const prim = new Set(m.bundles), mv = new Set(m.mvnoBundles), ps = new Set(m.plmns);
    for (const p of plmns) {
      ps.add(p);
      const e = byPlmn.get(p.replace("-", ""));
      if (!e) continue;
      const { bundles, mvnos } = plmnBundles(e);
      for (const n of bundles) prim.add(n);
      for (const n of mvnos) mv.add(n);
    }
    m.plmns = [...ps];
    m.bundles = [...prim].sort();
    m.mvnoBundles = [...mv].filter((n) => !prim.has(n)).sort();
  }
  return out;
}

/** "platform/sku/hwRev". */
export const variantKey = (v: Variant): string => `${v.platform}/${v.sku}/${v.hwRev}`;
export const byVariant = (a: Variant, b: Variant): number => a.platform - b.platform || a.sku - b.sku || a.hwRev - b.hwRev;

export function addVariants(into: Variant[], add: Variant[]): void {
  const seen = new Set(into.map(variantKey));
  for (const v of add) if (!seen.has(variantKey(v))) { seen.add(variantKey(v)); into.push(v); }
  into.sort(byVariant);
}

/** An image's trailer summary, as `{ trailer }` to spread; nothing without one. */
const trailerOf = (t: McfgTrailer | undefined): { trailer?: McfgTrailerSummary } => (t ? { trailer: summarizeTrailer(t) } : {});

/** Version, chip and SBL versions from the package's Info.plist. */
function packageInfo(info: Uint8Array): Pick<BasebandSummary["package"], "version" | "chipId" | "sblVersion" | "restoreSblVersion"> {
  const p = parsePlist(info);
  if (!isPlistDict(p)) throw new Error("bbfw Info.plist is not a dictionary");
  const k = (s: string): string | undefined => {
    const v = p[`com.apple.EmbeddedSoftwareRestore.Baseband.${s}`];
    return typeof v === "string" && v ? v : undefined;
  };
  const version = k("Version"), chipId = k("ChipId"), sblVersion = k("SBLVersion"), restoreSblVersion = k("RestoreSBLVersion");
  return {
    ...(version ? { version } : {}), ...(chipId ? { chipId } : {}),
    ...(sblVersion ? { sblVersion } : {}), ...(restoreSblVersion ? { restoreSblVersion } : {}),
  };
}

type Where = { blob?: number; variants?: Variant[]; config?: string };

/** The package's files, one entry per (member, path, content), with where each is carried. */
class FileList {
  readonly files: BasebandFile[] = [];
  /** Bytes of the entries decoded further (databases and small EFS settings). */
  readonly raw = new Map<BasebandFile, Uint8Array>();
  readonly #byKey = new Map<string, BasebandFile>();

  add(member: string, path: string, data: Uint8Array, where: Where): void {
    const sha1 = sha1Hex(data);
    const key = `${member}\0${path}\0${sha1}`;
    let f = this.#byKey.get(key);
    if (!f) {
      const format = contentFormat(data, path);
      f = { member, path, format, length: data.length, sha1 };
      if (format === "xml" || format === "text") {
        const text = td.decode(data);
        f.text = text;
        const refs = format === "xml" ? xmlRefs(text) : {};
        if (Object.keys(refs).length) f.refs = refs;
      } else {
        f.hex = bytesToHex(data);
      }
      this.#byKey.set(key, f);
      this.files.push(f);
      if (format === "mdb" || decodeModemEfs(path, data)) this.raw.set(f, data);
    }
    if (where.blob !== undefined && !(f.blobs ??= []).includes(where.blob)) f.blobs.push(where.blob);
    if (where.variants) addVariants((f.variants ??= []), where.variants);
    if (where.config && !(f.configs ??= []).includes(where.config)) f.configs.push(where.config);
  }
}

interface ContainerParts {
  container: BasebandContainer;
  images: BasebandImage[];
  nv: BasebandNvBlob[];
}

/** One BBCFGMBN container: its summary, its MCFG images and its NV/EFS record lists; text files go to `list`. */
function containerParts(member: string, b: Uint8Array, list: FileList): ContainerParts {
  const c = readBbcfg(b);
  const keys = new Map<number, Variant[]>(), types = new Map<number, number>();
  for (const r of c.index) {
    let k = keys.get(r.blob);
    if (!k) keys.set(r.blob, (k = []));
    k.push({ platform: r.platform, sku: r.sku, hwRev: r.hwRev });
    if (!types.has(r.blob)) types.set(r.blob, r.fileType);
  }
  const ft = new Map<number, { blobs: number; records: number }>();
  const tally = (t: number): { blobs: number; records: number } => {
    let e = ft.get(t);
    if (!e) ft.set(t, (e = { blobs: 0, records: 0 }));
    return e;
  };
  for (const r of c.index) tally(r.fileType).records++;
  for (const t of types.values()) tally(t).blobs++;
  const container: BasebandContainer = {
    member,
    magic: c.magic,
    headerVersion: c.headerVersion,
    meta: c.meta,
    records: c.index.length,
    blobs: c.blobs.length,
    fileTypes: [...ft].sort((a, b) => a[0] - b[0]).map(([type, e]) => {
      const known = BBCFG_FILE_TYPES[type];
      return { type, name: fileTypeName(type), ...(known ? { confidence: known.confidence, note: known.note } : {}), ...e };
    }),
  };
  const parts: ContainerParts = { container, images: [], nv: [] };
  const fail = (blob: number, error: string): void => { (container.errors ??= []).push({ blob, error }); };

  for (const ref of c.blobs) {
    const i = ref.index;
    const type = types.get(i);
    // No variant loads a blob the index never names, so there is no file type or variant to list it under.
    if (type === undefined) { fail(i, "no index record names this blob"); continue; }
    const variants = [...(keys.get(i) ?? [])].sort(byVariant);
    let blob: BbcfgBlob;
    try {
      blob = decodeBbcfgBlob(b, ref);
    } catch (e) {
      fail(i, errorMessage(e));
      continue;
    }
    if (blob.image && blob.mcfg) {
      for (const it of blob.mcfg.items) {
        if (it.kind !== "file") continue;
        const d = mcfgItemData(blob.image, it);
        if (contentFormat(d, it.path) !== "bin") list.add(member, it.path, d, { blob: i, variants });
      }
      parts.images.push({
        member, blob: i, fileType: type, fileTypeName: fileTypeName(type), variants,
        cfgType: blob.mcfg.cfgTypeName, version: blob.mcfg.version, ...trailerOf(blob.mcfg.trailer),
        files: itemPaths(blob.mcfg),
      });
      continue;
    }
    const records = blobRecords(member, blob, NV_TYPES.has(type), variants, list);
    if (records.length) parts.nv.push({ member, blob: i, fileType: type, fileTypeName: fileTypeName(type), digest: ref.digest, variants, records });
  }
  return parts;
}

/** A DER blob's text files go to `list`; its other NV/EFS records are listed when `keep`. */
function blobRecords(member: string, blob: BbcfgBlob, keep: boolean, variants: Variant[], list: FileList): BasebandNvRecord[] {
  const where = { blob: blob.index, variants };
  const records: BasebandNvRecord[] = [];
  for (const f of blob.files) {
    const fmt = contentFormat(f.data, f.path);
    if ((fmt === "xml" || fmt === "text") && f.data.length > 1) list.add(member, f.path, f.data, where);
    else if (keep) {
      records.push({
        efs: f.path, hex: bytesToHex(f.data),
        ...(f.f77 !== undefined ? { f77: f.f77 } : {}), ...(f.f78 !== undefined ? { f78: f.f78 } : {}),
        ...annotateNv(f.path, leUint(f.data)),
      });
    }
  }
  for (const r of blob.nv) {
    const z = inflateNv(r.value);
    if (z && contentFormat(z) === "xml") list.add(member, `/nv/rfnv/${r.id}.xml`, z, where);
    else if (!z && contentFormat(r.value) === "xml") list.add(member, `/nv/rfnv/${r.id}.xml`, r.value, where);
    if (keep) {
      records.push({
        nv: r.id, hex: bytesToHex(r.value),
        ...(r.f11 !== undefined ? { f11: r.f11 } : {}), ...(r.f14 !== undefined ? { f14: r.f14 } : {}),
        ...annotateNv(r.id, leUint(r.value)),
      });
    }
  }
  return records;
}

/** The modem image's built-in configs; their files go to `list`. */
function modemConfigSummaries(modem: Uint8Array, list: FileList): ModemConfigSummary[] {
  return scanModemConfigs(modem).map((m) => {
    const label = m.label ?? `@${m.offset}`;
    // plain segments whose file items are the zlib images themselves: those are listed on their own
    for (const f of m.files) if (!(m.container === "plain" && isZlibStart(f.data, 0))) list.add("qdsp6sw.mbn", f.path, f.data, { config: label });
    return {
      offset: m.offset, container: m.container, length: m.length, ...(m.label !== undefined ? { label: m.label } : {}),
      cfgType: m.image.cfgTypeName, format: m.image.format, version: m.image.version,
      ...trailerOf(m.image.trailer), files: m.files.map((f) => f.path),
    };
  });
}

/**
 * Compact, JSON-safe digest of a baseband package for the site. `members` maps
 * zip member basenames (bbcfg.mbn, pt.mbn, qdsp6sw.mbn, Info.plist) to bytes;
 * any may be missing.
 */
export function basebandSummary(members: Record<string, Uint8Array>, opts: BasebandSummaryOptions = {}): BasebandSummary {
  const family = opts.name && modemGeneration(opts.name);
  const info = members["Info.plist"];
  const list = new FileList();
  const out: BasebandSummary = {
    schema: MODEM_SUMMARY_SCHEMA,
    kind: "bbfw",
    package: { ...(opts.name ? { name: opts.name } : {}), ...(family ? { family } : {}), ...(info ? packageInfo(info) : {}) },
    members: opts.listing ?? Object.entries(members).map(([name, b]) => ({ name, size: b.length })),
    containers: [],
    files: list.files,
    nv: [],
    images: [],
    bandCombos: [],
    amprNs: [],
  };

  for (const member of ["bbcfg.mbn", "pt.mbn"]) {
    const b = members[member];
    if (!b || !isBbcfg(b)) continue;
    const parts = containerParts(member, b, list);
    out.containers.push(parts.container);
    out.images.push(...parts.images);
    out.nv.push(...parts.nv);
  }

  const modem = members["qdsp6sw.mbn"];
  if (modem) out.modemConfigs = modemConfigSummaries(modem, list);

  for (const f of out.files) {
    if (!f.text) continue;
    if (f.path.endsWith("/band_combos_per_plmn.xml")) {
      const carriers = parseBandCombos(f.text);
      out.bandCombos.push({ sha1: f.sha1, variants: f.variants ?? [], carriers: carriers.map((c) => ({ tag: c.tag, plmns: c.plmns, ...comboStats(c.combos) })) });
    } else if (f.member === "pt.mbn" && f.text.includes("<ampr_configured_ns")) {
      out.amprNs.push({ sha1: f.sha1, variants: f.variants ?? [], groups: parseAmprNs(f.text) });
    }
  }
  if (opts.mccMnc !== undefined && out.bandCombos.length) {
    out.carrierMap = mapComboCarriers(out.bandCombos.flatMap((s) => s.carriers), opts.mccMnc);
  }
  const mdb = modemDatabases(out.files, list.raw, opts.mccMnc);
  if (mdb) out.mdb = mdb;
  const ss = ssgccsConfigs(out.files);
  if (ss.length) out.ssgccs = ss;
  return out;
}

const where = ({ member, path, sha1, variants, configs }: BasebandFile): Pick<BasebandFile, "member" | "path" | "sha1" | "variants" | "configs"> =>
  ({ member, path, sha1, ...(variants ? { variants } : {}), ...(configs ? { configs } : {}) });

/** The .mdb databases and small EFS settings among `files`, decoded from their bytes. */
function modemDatabases(files: BasebandFile[], raw: ReadonlyMap<BasebandFile, Uint8Array>, mccMnc: MccMncTable | undefined): BasebandSummary["mdb"] {
  const databases: BasebandMdb[] = [], settings: BasebandModemEfs[] = [];
  for (const [f, data] of raw) {
    if (f.format !== "mdb") {
      const v = decodeModemEfs(f.path, data);
      if (v) settings.push({ ...where(f), hex: bytesToHex(data), ...v });
      continue;
    }
    const d: BasebandMdb = where(f);
    try {
      const m = readMdb(data);
      d.header = m.header;
      if (f.path.endsWith("/mcc2arfcn.mdb") && m.layout === 3) d.scan = parseMcc2Arfcn(m.blob);
      else if (/\/plmn2features\w*\.mdb$/.test(f.path)) d.features = parsePlmnFeatures(m);
    } catch (e) {
      d.error = errorMessage(e);
    }
    databases.push(d);
  }
  if (!databases.length && !settings.length) return undefined;
  const order = new Map(files.map((f, i) => [f.sha1 + f.path, i]));
  const at = (x: { sha1: string; path: string }) => order.get(x.sha1 + x.path) ?? order.size;
  const byFile = (a: { sha1: string; path: string }, b: { sha1: string; path: string }) => at(a) - at(b);
  const out: NonNullable<BasebandSummary["mdb"]> = { databases: databases.sort(byFile), settings: settings.sort(byFile) };
  const plmns = [...new Set(databases.flatMap((d) => d.features?.flatMap((x) => x.plmns) ?? []))];
  if (mccMnc !== undefined && plmns.length) {
    const m = mapComboCarriers(plmns.map((p) => ({ tag: p, plmns: [p] })), mccMnc);
    out.plmnBundles = Object.fromEntries(Object.entries(m).filter(([, x]) => x.bundles.length).map(([p, x]) => [p, x.bundles]));
  }
  return out;
}

/** ssgccs_config.txt paired with the ssgccs_int_config.txt the same blobs or configs carry. */
function ssgccsConfigs(files: BasebandFile[]): BasebandSsgccs[] {
  type TextFile = BasebandFile & { text: string };
  const texts = files.filter((f): f is TextFile => f.text !== undefined);
  const main = texts.filter((f) => f.path.endsWith("/ssgccs_config.txt"));
  const int = texts.filter((f) => f.path.endsWith("/ssgccs_int_config.txt"));
  const overlap = (a: BasebandFile, b: BasebandFile) =>
    a.member === b.member && ((a.blobs ?? []).some((x) => b.blobs?.includes(x)) || (a.configs ?? []).some((x) => b.configs?.includes(x)));
  const used = new Set<BasebandFile>();
  const out: BasebandSsgccs[] = [];
  const entry = ([first, ...more]: [TextFile, ...TextFile[]]): BasebandSsgccs => {
    const fs = [first, ...more];
    return {
      ...(first.variants ? { variants: first.variants } : {}),
      ...(first.configs ? { configs: first.configs } : {}),
      files: fs.map((f) => ({ path: f.path, sha1: f.sha1, text: f.text })),
      config: parseSsgccs(...fs.map((f) => f.text)),
    };
  };
  for (const f of main) {
    const pair = int.find((x) => overlap(f, x));
    if (pair) used.add(pair);
    out.push(entry(pair ? [f, pair] : [f]));
  }
  for (const f of int) if (!used.has(f)) out.push(entry([f]));
  return out;
}
