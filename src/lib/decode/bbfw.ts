/**
 * Plaintext decoder for Apple Qualcomm baseband packages (`Mav*.bbfw`, a zip):
 * the BBCFGMBN containers (bbcfg.mbn, pt.mbn), Qualcomm MCFG images and their
 * MCFG_TRL trailers, and the built-in configs inside the modem image
 * (qdsp6sw.mbn). Nothing is decrypted or verified: payloads are plain DER, or
 * MAVZ ("MAVZ" + u32le length + zlib). Bytes in, plain objects out; `fflate`
 * is the only dependency.
 */

import { Unzlib, unzlibSync } from "fflate";
import { readTlv, type Tlv } from "./der";
import { sha1Hex } from "./bytes";
import { bytesToHex, parsePlist } from "./plist";
import { describeNv } from "./nv";
import { comboStats, parseAmprNs, parseBandCombos, xmlRefs, type AmprGroup, type ComboStats, type XmlRefs } from "./policy";

const td = new TextDecoder();
const latin1 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const uint = (b: Uint8Array) => { let v = 0; for (let i = 0; i < b.length; i++) v = v * 256 + b[i]; return v; };
const ascii = (b: Uint8Array, o: number, s: string) => { for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false; return true; };

function* kids(b: Uint8Array, t: Tlv): Generator<Tlv> {
  for (let p = t.contentStart; p < t.contentEnd; ) {
    const c = readTlv(b, p, t.contentEnd);
    yield c;
    p = c.end;
  }
}
const ctx = (t: Tlv, num: number) => t.cls === 2 && t.num === num;
const val = (b: Uint8Array, t: Tlv) => b.subarray(t.contentStart, t.contentEnd);

/* ------------------------------------------------------------ container */

export interface BbcfgMeta {
  project?: string;
  /** "020A0100" = 2.10.01 */
  versionHex?: string;
  /** Same as Info.plist Baseband.Version. */
  version?: string;
  buildHost?: string;
  buildUser?: string;
  field84?: string;
  field85?: string;
  buildTime?: string;
  sourceRevision?: string;
}

// bbcfg.mbn: header tags 80..87 (82..87 are build-system placeholders)
const META_KEYS = ["project", "versionHex", "buildHost", "buildUser", "field84", "field85", "buildTime", "sourceRevision"] as const;

export interface FileTypeInfo { name: string; confidence: "high" | "med" | "low"; note: string }

// qdsp6sw.mbn: log table "DFLT_CAL STAT_NV PA_CHAR STAT_CFG RFFE_DEV RFFE_LUT RFC_MMW PROT_NV PROT_PRI PROT SKU", matched by content
export const BBCFG_FILE_TYPES: Record<number, FileTypeInfo> = {
  1: { name: "DFLT_CAL?", confidence: "low", note: "RF defaults/calibration NV list, VTNV/zlib values" },
  4: { name: "STAT_NV?", confidence: "low", note: "RF static NV list" },
  7: { name: "STAT_CFG?", confidence: "med", note: "MAVZ MCFG HW image, /rfc/<id>_0_{res,cmn}.dat (sub-6 RF card)" },
  8: { name: "RFFE_DEV", confidence: "high", note: "EFS /rfc/device_settings/*" },
  9: { name: "RFFE_LUT", confidence: "high", note: "EFS /rfc/device_lut/*" },
  10: { name: "RFC_MMW", confidence: "high", note: "MAVZ MCFG HW image, /rfc/29xx (mmWave RF card)" },
  13: { name: "PROT_SKU?", confidence: "low", note: "MAVZ 64 KiB binary table" },
  15: { name: "PROT_NV", confidence: "high", note: "protocol static NV/EFS" },
  17: { name: "PROT_PRI", confidence: "high", note: "product PRI defaults: /policyman/*.xml, /data/3gpp/*.xml" },
  20: { name: "SHPNG", confidence: "high", note: "common shipping settings" },
  22: { name: "PA_CHAR?", confidence: "low", note: "pt.mbn RFNV 646xx power tables" },
  24: { name: "PA_CHAR?", confidence: "low", note: "pt.mbn RFNV 646xx incl. A-MPR NS XML (NV 64628)" },
};

export const fileTypeName = (t: number) => BBCFG_FILE_TYPES[t]?.name ?? `type ${t}`;

export interface BbcfgIndexRecord {
  platform: number;
  sku: number;
  hwRev: number;
  fileType: number;
  fileTypeName: string;
  /** Position in `blobs`. */
  blob: number;
}

export type BlobFormat = "der" | "mavz" | "bin";

export interface BbcfgBlobRef {
  index: number;
  /** 40 hex chars; not a hash of the payload (the modem copies it into /mav/bbcfg_file_hash_*). */
  digest: string;
  offset: number;
  length: number;
  format: BlobFormat;
}

export interface BbcfgContainer {
  /** "CFG" (bbcfg.mbn) or "POW" (pt.mbn): the first four bytes reversed. */
  magic: string;
  headerVersion: number;
  /** Both header size fields; each is the file length - 0x28. */
  sizes: [number, number];
  meta: BbcfgMeta;
  index: BbcfgIndexRecord[];
  blobs: BbcfgBlobRef[];
}

export const isBbcfg = (b: Uint8Array) => b.length > 0x32 && ascii(b, 0x28, "BBCFGMBN");

/** Header, metadata, index and blob table; payloads are left in place. */ // bbcfg.mbn / pt.mbn
export function readBbcfg(b: Uint8Array): BbcfgContainer {
  if (!isBbcfg(b)) throw new Error("not a BBCFGMBN container");
  const root = readTlv(b, 0x30);
  const meta: BbcfgMeta = {};
  const index: BbcfgIndexRecord[] = [];
  const blobs: BbcfgBlobRef[] = [];
  for (const t of kids(b, root)) {
    if (ctx(t, 8)) {
      // a8: {9f8148 platform, 9f8149 sku, 9f814a hw_rev, 9f814b file_type, 9f814c blob}
      for (const rec of kids(b, t)) {
        const f: number[] = [];
        for (const x of kids(b, rec)) if (x.cls === 2 && x.num >= 200 && x.num <= 204) f[x.num - 200] = uint(val(b, x));
        index.push({ platform: f[0], sku: f[1], hwRev: f[2], fileType: f[3], fileTypeName: fileTypeName(f[3]), blob: f[4] });
      }
    } else if (ctx(t, 9)) {
      // a9: {9f64 digest, 9f65 payload}
      for (const rec of kids(b, t)) {
        let digest = "", p: Tlv | undefined;
        for (const x of kids(b, rec)) {
          if (ctx(x, 100)) digest = latin1(val(b, x));
          else if (ctx(x, 101)) p = x;
        }
        if (!p) continue;
        const head = b.subarray(p.contentStart, p.contentStart + 4);
        const format: BlobFormat = ascii(head, 0, "MAVZ") ? "mavz" : head[0] === 0x30 ? "der" : "bin";
        blobs.push({ index: blobs.length, digest, offset: p.contentStart, length: p.contentEnd - p.contentStart, format });
      }
    } else if (t.cls === 2 && !t.constructed && t.num < META_KEYS.length) {
      meta[META_KEYS[t.num]] = latin1(val(b, t));
    }
  }
  const h = meta.versionHex;
  if (h && /^[0-9a-f]{6}/i.test(h)) {
    meta.version = `${parseInt(h.slice(0, 2), 16)}.${String(parseInt(h.slice(2, 4), 16)).padStart(2, "0")}.${String(parseInt(h.slice(4, 6), 16)).padStart(2, "0")}`;
  }
  return {
    magic: latin1(b.subarray(0, 4)).split("").reverse().join("").replace(/\0/g, ""),
    headerVersion: u32(b, 4),
    sizes: [u32(b, 0x10), u32(b, 0x14)],
    meta,
    index,
    blobs,
  };
}

/** "MAVZ" + u32le inflated length + zlib stream. */ // bbcfg.mbn
export function inflateMavz(p: Uint8Array): Uint8Array {
  if (!ascii(p, 0, "MAVZ")) throw new Error("not MAVZ");
  const n = u32(p, 4);
  if (n > 256 << 20) throw new Error(`MAVZ length ${n} too large`);
  const out = unzlibSync(p.subarray(8), { out: new Uint8Array(n) });
  if (out.length !== n) throw new Error(`MAVZ inflated to ${out.length}, header says ${n}`);
  return out;
}

export interface NvRecord {
  id: number;
  value: Uint8Array;
  /** 9f8311 and 9f8314, meaning unknown. */
  f11?: number;
  f14?: number;
}

export interface EfsRecord {
  path: string;
  data: Uint8Array;
  /** 9f8377 and 9f8378, meaning unknown. */
  f77?: number;
  f78?: number;
}

export interface BbcfgBlob extends BbcfgBlobRef {
  nv: NvRecord[];
  files: EfsRecord[];
  /** MAVZ payload, inflated. */
  image?: Uint8Array;
  mcfg?: McfgImage;
}

const small = (b: Uint8Array) => (b.length <= 6 ? uint(b) : undefined);

/** DER blob payload: SEQUENCE { bf8458 NV records, bf8459 EFS records }. */ // bbcfg.mbn: blob tag 9f65
export function readBlobRecords(p: Uint8Array): { nv: NvRecord[]; files: EfsRecord[] } {
  const nv: NvRecord[] = [], files: EfsRecord[] = [];
  const root = readTlv(p, 0);
  for (const group of kids(p, root)) {
    if (ctx(group, 600)) {
      // bf8458: {9f8310 id, 9f8311, 9f8312 size, 9f8313 value, 9f8314}
      for (const rec of kids(p, group)) {
        const r: NvRecord = { id: 0, value: new Uint8Array(0) };
        for (const x of kids(p, rec)) {
          const v = val(p, x);
          if (ctx(x, 400)) r.id = uint(v);
          else if (ctx(x, 401)) r.f11 = small(v);
          else if (ctx(x, 403)) r.value = v;
          else if (ctx(x, 404)) r.f14 = small(v);
        }
        nv.push(r);
      }
    } else if (ctx(group, 601)) {
      // bf8459: {9f8374 path, 9f8375 size, 9f8376 data, 9f8377, 9f8378}
      for (const rec of kids(p, group)) {
        const r: EfsRecord = { path: "", data: new Uint8Array(0) };
        for (const x of kids(p, rec)) {
          const v = val(p, x);
          if (ctx(x, 500)) r.path = latin1(v).replace(/\0+$/, "");
          else if (ctx(x, 502)) r.data = v;
          else if (ctx(x, 503)) r.f77 = small(v);
          else if (ctx(x, 504)) r.f78 = small(v);
        }
        files.push(r);
      }
    }
  }
  return { nv, files };
}

/** One blob's content; MAVZ images are inflated and parsed as MCFG when they are one. */
export function decodeBbcfgBlob(b: Uint8Array, ref: BbcfgBlobRef): BbcfgBlob {
  const p = b.subarray(ref.offset, ref.offset + ref.length);
  if (ref.format === "mavz") {
    const image = inflateMavz(p);
    return { ...ref, nv: [], files: [], image, mcfg: parseMcfg(image) };
  }
  if (ref.format === "der") return { ...ref, ...readBlobRecords(p) };
  return { ...ref, nv: [], files: [] };
}

/* ------------------------------------------------------------------ MCFG */

export interface McfgTrailer {
  trailerVersion?: string;
  version?: string;
  label?: string;
  baseVersion?: string;
  capability?: string;
  /** Build-tool text, often a truncated Python bytes repr. */
  digest?: string;
  /** Every TLV as hex, by type. */
  tlvs: Record<number, string>;
}

// MCFG_TRL TLVs: 0 trailer ver | 1 version | 3 label | 5 base version | 7 capability id | 8 digest | 9 end
const TRL_KEYS: Record<number, keyof Omit<McfgTrailer, "tlvs">> = { 0: "trailerVersion", 1: "version", 3: "label", 5: "baseVersion", 7: "capability", 8: "digest" };

/** Trailer item body: u8, u8, u16 length, "MCFG_TRL", then TLVs (u8 type, u16le length, value). */ // MCFG item type 10
export function parseMcfgTrailer(body: Uint8Array): McfgTrailer | undefined {
  if (!ascii(body, 4, "MCFG_TRL")) return undefined;
  const out: McfgTrailer = { tlvs: {} };
  for (let o = 12; o + 3 <= body.length; ) {
    const t = body[o], n = u16(body, o + 1);
    if ((t === 0 && n === 0) || o + 3 + n > body.length) break;
    const v = body.subarray(o + 3, o + 3 + n);
    o += 3 + n;
    out.tlvs[t] = bytesToHex(v);
    const k = TRL_KEYS[t];
    if (k) out[k] = t === 3 || t === 8 ? latin1(v).replace(/\0+$/, "") : bytesToHex(v);
    if (t === 9) break;
  }
  return out;
}

export interface McfgItem {
  type: number;
  attr: number;
  length: number;
  nv?: number;
  path?: string;
  /** Payload bounds within the image passed to parseMcfg. */
  dataOffset?: number;
  dataLength?: number;
}

export interface McfgImage {
  /** Where the MCFG segment starts in the image (non-zero inside an ELF). */
  segmentOffset: number;
  format: number;
  cfgType: number;
  cfgTypeName: string;
  numItems: number;
  muxdCarrierIndex: number;
  versionId: number;
  version: string;
  items: McfgItem[];
  trailer?: McfgTrailer;
  /** Bytes from the segment start to the end of the last item. */
  length: number;
}

/** The PT_LOAD segment that starts with "MCFG", or `img` itself for a bare segment. */ // ELF32 program headers
function mcfgSegment(img: Uint8Array): number | undefined {
  if (ascii(img, 0, "MCFG")) return 0;
  if (!(img[0] === 0x7f && ascii(img, 1, "ELF")) || img[4] !== 1) return undefined;
  const phoff = u32(img, 28), phnum = u16(img, 44);
  for (let i = 0; i < phnum; i++) {
    const off = u32(img, phoff + 32 * i + 4);
    if (off + 4 <= img.length && ascii(img, off, "MCFG")) return off;
  }
  return undefined;
}

/**
 * Qualcomm MCFG image (ELF or bare segment). Header: "MCFG" u16 format, u16
 * cfg type (0 HW, 1 SW), u32 items, u16 muxd carrier index, u16 spare, then
 * the version record (u16 id, u16 length, value). Items: u32 length, u8 type,
 * u8 attr, u16 reserved, data; type 1 = NV, 2/4/16/27 = file, 10 = MCFG_TRL.
 */
export function parseMcfg(img: Uint8Array, maxItems = 4096): McfgImage | undefined {
  const s = mcfgSegment(img);
  if (s === undefined || s + 20 > img.length) return undefined;
  const ct = u16(img, s + 6);
  const vlen = u16(img, s + 18);
  const out: McfgImage = {
    segmentOffset: s,
    format: u16(img, s + 4),
    cfgType: ct,
    cfgTypeName: ct === 0 ? "HW" : ct === 1 ? "SW" : String(ct),
    numItems: u32(img, s + 8),
    muxdCarrierIndex: u16(img, s + 12),
    versionId: u16(img, s + 16),
    version: bytesToHex(img.subarray(s + 20, s + 20 + vlen).slice().reverse()),
    items: [],
    length: 0,
  };
  const count = Math.min(out.numItems || maxItems, maxItems);
  let o = s + 20 + vlen;
  while (o + 8 <= img.length && out.items.length < count) {
    const ln = u32(img, o);
    if (ln < 8 || o + ln > img.length) break;
    const it: McfgItem = { type: img[o + 4], attr: img[o + 5], length: ln };
    const body = img.subarray(o + 8, o + ln);
    if (it.type === 10) {
      out.trailer = parseMcfgTrailer(body);
    } else if (it.type === 1 && body.length >= 4) {
      it.nv = u16(body, 0);
      it.dataOffset = o + 12;
      it.dataLength = Math.min(u16(body, 2), body.length - 4);
    } else if (body[0] === 1 && body[1] === 0 && body.length >= 4) {
      // u16 1, u16 path length, path, u16 2, u16 (u32 for type 16) data length, data
      const pl = u16(body, 2);
      it.path = latin1(body.subarray(4, 4 + pl)).replace(/\0+$/, "");
      const q = 4 + pl;
      if (body[q] === 2 && body[q + 1] === 0) {
        const w = it.type === 16 ? 4 : 2;
        const dl = w === 4 ? u32(body, q + 2) : u16(body, q + 2);
        it.dataOffset = o + 8 + q + 2 + w;
        it.dataLength = Math.min(dl, img.length - it.dataOffset);
      }
    }
    out.items.push(it);
    o += ln;
    if (it.type === 10) break;
  }
  out.length = o - s;
  return out;
}

/** An item's payload; attr bit 0x10 marks a one-byte 0x07 prefix before the file bytes. */
export function mcfgItemData(img: Uint8Array, it: McfgItem): Uint8Array {
  if (it.dataOffset === undefined || it.dataLength === undefined) return new Uint8Array(0);
  const d = img.subarray(it.dataOffset, it.dataOffset + it.dataLength);
  return it.attr & 0x10 && d[0] === 0x07 ? d.subarray(1) : d;
}

/* ------------------------------------------------------ modem built-ins */

export interface ModemConfig {
  /** Offset in the modem image of the zlib stream or the plain MCFG header. */
  offset: number;
  container: "zlib" | "plain";
  /** Inflated length (zlib) or segment length (plain). */
  length: number;
  label?: string;
  image: McfgImage;
  files: Array<{ path: string; data: Uint8Array }>;
}

const isZlibStart = (b: Uint8Array, o: number) =>
  b[o] === 0x78 && (b[o + 1] === 0x01 || b[o + 1] === 0x5e || b[o + 1] === 0x9c || b[o + 1] === 0xda);

const isImage = (d: Uint8Array) => (d[0] === 0x7f && ascii(d, 1, "ELF")) || ascii(d, 0, "MCFG");

/** Streams at most `cap` bytes out of a zlib stream at the start of `src`; trailing bytes are ignored. */
function inflateCapped(src: Uint8Array, cap: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let n = 0;
  const s = new Unzlib((c) => {
    n += c.length;
    if (n > cap) throw new Error("inflated past cap");
    parts.push(c);
  });
  s.push(src, false);
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** First inflated bytes, or undefined when `b[o..]` is not a zlib stream. */
function probeZlib(b: Uint8Array, o: number): Uint8Array | undefined {
  let head: Uint8Array | undefined;
  try {
    const s = new Unzlib((c) => { head ??= c; });
    s.push(b.subarray(o, o + 512), false);
  } catch {
    return undefined;
  }
  return head;
}

function modemFiles(img: Uint8Array, m: McfgImage): ModemConfig["files"] {
  return m.items.filter((it) => it.path).map((it) => ({ path: it.path!, data: mcfgItemData(img, it) }));
}

/**
 * Built-in MCFG images in the modem ELF: plain segments (found by header), and
 * zlib streams that inflate to an ELF or MCFG image. About 1.5 s on a 127 MB image.
 */ // qdsp6sw.mbn
export function scanModemConfigs(b: Uint8Array): ModemConfig[] {
  const out: ModemConfig[] = [];
  for (let o = 0; o + 20 <= b.length; o++) {
    const c = b[o];
    if (c === 0x4d && ascii(b, o, "MCFG") && u16(b, o + 16) === 0x1383 && u16(b, o + 6) <= 1) {
      // plain segment: header + version record id 0x1383
      const m = parseMcfg(b.subarray(o, Math.min(b.length, o + (16 << 20))), 256);
      if (m?.trailer) {
        // not skipped: its file items can be the zlib images below
        out.push({ offset: o, container: "plain", length: m.length, label: m.trailer.label || undefined, image: m, files: modemFiles(b.subarray(o), m) });
      }
    } else if (c === 0x78 && isZlibStart(b, o)) {
      const head = probeZlib(b, o);
      if (!head || head.length < 4 || !isImage(head)) continue;
      let img: Uint8Array;
      try {
        img = inflateCapped(b.subarray(o, o + (4 << 20)), 32 << 20);
      } catch {
        continue;
      }
      const m = parseMcfg(img);
      if (!m) continue;
      const label = m.trailer?.label ?? m.items.find((it) => it.path?.startsWith("/protected"))?.path;
      out.push({ offset: o, container: "zlib", length: img.length, label, image: m, files: modemFiles(img, m) });
    }
  }
  return out;
}

/* --------------------------------------------------------------- content */

export type ContentFormat = "xml" | "text" | "mdb" | "bin";

/** Same test as the reference extractor: XML by prologue/first tag, text when printable. */
export function contentFormat(d: Uint8Array, path = ""): ContentFormat {
  let i = 0;
  while (i < d.length && i < 64 && (d[i] === 0x20 || (d[i] >= 9 && d[i] <= 13))) i++;
  if (d[i] === 0x3c && (ascii(d, i, "<?xml") || /[A-Za-z_]/.test(String.fromCharCode(d[i + 1] ?? 0)))) return "xml";
  if (path.endsWith(".mdb")) return "mdb";
  if (path.endsWith(".txt")) return "text";
  if (d.length >= 8) {
    let printable = true;
    for (let k = 0; k < d.length && printable; k++) printable = (d[k] >= 32 && d[k] < 127) || d[k] === 9 || d[k] === 10 || d[k] === 13;
    if (printable) return "text";
  }
  return "bin";
}

/** Zlib NV value (pt.mbn RFNV), inflated; undefined when it is not one. */
function inflateNv(v: Uint8Array): Uint8Array | undefined {
  if (!(v[0] === 0x78 && (v[1] === 0x9c || v[1] === 0xda))) return undefined;
  try {
    return inflateCapped(v, 16 << 20);
  } catch {
    return undefined;
  }
}

/* --------------------------------------------------------------- summary */

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
  /** From the NV/EFS lookup, when known. */
  name?: string;
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
  trailer?: Omit<McfgTrailer, "tlvs">;
  files: string[];
}

export interface BasebandContainer {
  member: string;
  magic: string;
  headerVersion: number;
  meta: BbcfgMeta;
  records: number;
  blobs: number;
  fileTypes: Array<{ type: number; name: string; blobs: number; records: number }>;
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
  trailer?: Omit<McfgTrailer, "tlvs">;
  files: string[];
}

export interface BasebandSummary {
  schema: 1;
  package: {
    name?: string;
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
}

export interface BasebandSummaryOptions {
  /** Package file name, e.g. "Mav25-2.10.01.Release.bbfw". */
  name?: string;
  /** Every zip member with its size, when only some are passed in `members`. */
  listing?: Array<{ name: string; size: number }>;
  /** The OTA manifest's MobileDeviceCarriersByMccMnc dictionary. */
  mccMnc?: unknown;
}

// ft 15/17/20 hold the protocol/carrier settings worth listing record by record
const NV_TYPES = new Set([15, 17, 20]);

const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);

/** Bundles for each band-combo tag, derived from its PLMN list. */ // reference extractor: map_bundles
export function mapComboCarriers(carriers: Array<{ tag: string; plmns: string[] }>, mccMnc: unknown): Record<string, CarrierMapping> {
  const byPlmn = isDict(mccMnc) ? mccMnc : {};
  const out: Record<string, CarrierMapping> = {};
  for (const { tag, plmns } of carriers) {
    const m = (out[tag] ??= { plmns: [], bundles: [], mvnoBundles: [] });
    const prim = new Set(m.bundles), mv = new Set(m.mvnoBundles), ps = new Set(m.plmns);
    for (const p of plmns) {
      ps.add(p);
      const r = byPlmn[p.replace("-", "")];
      if (!isDict(r)) continue;
      const mvnos = (Array.isArray(r.MVNOs) ? r.MVNOs : []).filter(isDict);
      const names: string[] = typeof r.BundleName === "string" ? [r.BundleName] : [];
      for (const x of mvnos) {
        const gid = `${x.GID1 ?? ""}${x.GID2 ?? ""}`.toUpperCase();
        if (gid && /^F+$/.test(gid) && typeof x.BundleName === "string") names.push(x.BundleName);
      }
      for (const n of names) prim.add(n);
      for (const x of mvnos) if (typeof x.BundleName === "string" && !names.includes(x.BundleName)) mv.add(x.BundleName);
    }
    m.plmns = [...ps];
    m.bundles = [...prim].sort();
    m.mvnoBundles = [...mv].filter((n) => !prim.has(n)).sort();
  }
  return out;
}

const variantKey = (v: Variant) => `${v.platform}/${v.sku}/${v.hwRev}`;
const byVariant = (a: Variant, b: Variant) => a.platform - b.platform || a.sku - b.sku || a.hwRev - b.hwRev;

function addVariants(into: Variant[], add: Variant[]) {
  const seen = new Set(into.map(variantKey));
  for (const v of add) if (!seen.has(variantKey(v))) { seen.add(variantKey(v)); into.push(v); }
  into.sort(byVariant);
}

const trailerOf = (t?: McfgTrailer) => {
  if (!t) return undefined;
  const { tlvs: _, ...rest } = t;
  return rest;
};

/**
 * Compact, JSON-safe digest of a baseband package for the site. `members` maps
 * zip member basenames (bbcfg.mbn, pt.mbn, qdsp6sw.mbn, Info.plist) to bytes;
 * any may be missing.
 */
export function basebandSummary(members: Record<string, Uint8Array>, opts: BasebandSummaryOptions = {}): BasebandSummary {
  const out: BasebandSummary = {
    schema: 1,
    package: { ...(opts.name ? { name: opts.name } : {}) },
    members: opts.listing ?? Object.entries(members).map(([name, b]) => ({ name, size: b.length })),
    containers: [],
    files: [],
    nv: [],
    images: [],
    bandCombos: [],
    amprNs: [],
  };

  const info = members["Info.plist"];
  if (info) {
    try {
      const p = parsePlist(info);
      if (isDict(p)) {
        const k = (s: string) => (typeof p[`com.apple.EmbeddedSoftwareRestore.Baseband.${s}`] === "string" ? (p[`com.apple.EmbeddedSoftwareRestore.Baseband.${s}`] as string) : undefined);
        const pk = { version: k("Version"), chipId: k("ChipId"), sblVersion: k("SBLVersion"), restoreSblVersion: k("RestoreSBLVersion") };
        for (const [key, v] of Object.entries(pk)) if (v) (out.package as Record<string, string>)[key] = v;
      }
    } catch { /* Info.plist is optional */ }
  }

  const byKey = new Map<string, BasebandFile>();
  const add = (member: string, path: string, data: Uint8Array, where: { blob?: number; variants?: Variant[]; config?: string }) => {
    const sha1 = sha1Hex(data);
    const key = `${member}\0${path}\0${sha1}`;
    let f = byKey.get(key);
    if (!f) {
      const format = contentFormat(data, path);
      f = { member, path, format, length: data.length, sha1 };
      if (format === "xml" || format === "text") f.text = td.decode(data);
      else f.hex = bytesToHex(data);
      if (format === "xml") {
        const refs = xmlRefs(f.text!);
        if (Object.keys(refs).length) f.refs = refs;
      }
      byKey.set(key, f);
      out.files.push(f);
    }
    if (where.blob !== undefined && !(f.blobs ??= []).includes(where.blob)) f.blobs.push(where.blob);
    if (where.variants) addVariants((f.variants ??= []), where.variants);
    if (where.config && !(f.configs ??= []).includes(where.config)) f.configs.push(where.config);
  };

  for (const member of ["bbcfg.mbn", "pt.mbn"]) {
    const b = members[member];
    if (!b || !isBbcfg(b)) continue;
    const c = readBbcfg(b);
    const keys = new Map<number, Variant[]>(), types = new Map<number, number>();
    for (const r of c.index) {
      let k = keys.get(r.blob);
      if (!k) keys.set(r.blob, (k = []));
      k.push({ platform: r.platform, sku: r.sku, hwRev: r.hwRev });
      if (!types.has(r.blob)) types.set(r.blob, r.fileType);
    }
    const ft = new Map<number, { blobs: number; records: number }>();
    for (const r of c.index) {
      const e = ft.get(r.fileType) ?? { blobs: 0, records: 0 };
      e.records++;
      ft.set(r.fileType, e);
    }
    for (const t of types.values()) ft.get(t)!.blobs++;
    const summary: BasebandContainer = {
      member,
      magic: c.magic,
      headerVersion: c.headerVersion,
      meta: c.meta,
      records: c.index.length,
      blobs: c.blobs.length,
      fileTypes: [...ft].sort((a, b) => a[0] - b[0]).map(([type, e]) => ({ type, name: fileTypeName(type), ...e })),
    };
    out.containers.push(summary);

    for (const ref of c.blobs) {
      const i = ref.index;
      const variants = [...(keys.get(i) ?? [])].sort(byVariant);
      const type = types.get(i) ?? -1;
      let blob: BbcfgBlob;
      try {
        blob = decodeBbcfgBlob(b, ref);
      } catch (e) {
        (summary.errors ??= []).push({ blob: i, error: (e as Error).message });
        continue;
      }
      if (blob.image && blob.mcfg) {
        for (const it of blob.mcfg.items) {
          if (!it.path) continue;
          const d = mcfgItemData(blob.image, it);
          if (contentFormat(d, it.path) !== "bin") add(member, it.path, d, { blob: i, variants });
        }
        out.images.push({
          member, blob: i, fileType: type, fileTypeName: fileTypeName(type), variants,
          cfgType: blob.mcfg.cfgTypeName, version: blob.mcfg.version, trailer: trailerOf(blob.mcfg.trailer),
          files: blob.mcfg.items.filter((it) => it.path).map((it) => it.path!),
        });
        continue;
      }
      const records: BasebandNvRecord[] = [];
      const keep = NV_TYPES.has(type);
      for (const f of blob.files) {
        const fmt = contentFormat(f.data, f.path);
        if ((fmt === "xml" || fmt === "text") && f.data.length > 1) add(member, f.path, f.data, { blob: i, variants });
        else if (keep) {
          const info = describeNv(f.path);
          const name = info && !info.family ? info.name : undefined; // a family match only repeats the leaf name
          records.push({ efs: f.path, hex: bytesToHex(f.data), f77: f.f77, f78: f.f78, ...(name ? { name } : {}) });
        }
      }
      for (const r of blob.nv) {
        const z = inflateNv(r.value);
        if (z && contentFormat(z) === "xml") add(member, `/nv/rfnv/${r.id}.xml`, z, { blob: i, variants });
        else if (!z && contentFormat(r.value) === "xml") add(member, `/nv/rfnv/${r.id}.xml`, r.value, { blob: i, variants });
        if (keep) {
          const name = describeNv(r.id)?.name;
          records.push({ nv: r.id, hex: bytesToHex(r.value), f11: r.f11, f14: r.f14, ...(name ? { name } : {}) });
        }
      }
      if (records.length) out.nv.push({ member, blob: i, fileType: type, fileTypeName: fileTypeName(type), digest: ref.digest, variants, records });
    }
  }

  const modem = members["qdsp6sw.mbn"];
  if (modem) {
    out.modemConfigs = [];
    for (const m of scanModemConfigs(modem)) {
      const label = m.label ?? `@${m.offset}`;
      // plain segments whose file items are the zlib images themselves: those are listed on their own
      for (const f of m.files) if (!(m.container === "plain" && isZlibStart(f.data, 0))) add("qdsp6sw.mbn", f.path, f.data, { config: label });
      out.modemConfigs.push({
        offset: m.offset, container: m.container, length: m.length, label: m.label,
        cfgType: m.image.cfgTypeName, format: m.image.format, version: m.image.version,
        trailer: trailerOf(m.image.trailer), files: m.files.map((f) => f.path),
      });
    }
  }

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
  return out;
}
