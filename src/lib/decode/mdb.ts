/**
 * Qualcomm modem databases (EFS /mdb/*.mdb) and the small binary EFS files the
 * modem's built-in configs carry. Layouts were read from the Mav25-2.10.01
 * samples; the parsers in qdsp6sw.mbn are compressed, so field meanings past
 * the layout are marked. Bytes in, plain objects out; `fflate` is the only
 * dependency.
 */

import { unzlibSync } from "fflate";
import { bytesToHex } from "./plist";

export type MdbConfidence = "high" | "med" | "low";

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const cstr = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length && b[i]; i++) s += String.fromCharCode(b[i]); return s; };
const inflate = (b: Uint8Array, n: number) => {
  if (n > 16 << 20) throw new Error(`mdb: ${n} bytes is too large`);
  const out = unzlibSync(b, { out: new Uint8Array(n) });
  if (out.length !== n) throw new Error(`mdb: inflated to ${out.length}, header says ${n}`);
  return out;
};

/* -------------------------------------------------------------- container */

export interface MdbHeader {
  version: number;
  /** 3 = one blob, 1 = index + records. */
  layout: number;
  /** "Maverick" (Apple) or "Qualcomm". */
  creator: string;
  /** Build time, when set. */
  built?: string;
}

export interface MdbRecord {
  /** Keys pointing at this record (PLMN keys for plmn2features). */
  keys: number[];
  data: Uint8Array;
}

export interface MdbFile {
  header: MdbHeader;
  /** Layout 3. */
  blob?: Uint8Array;
  /** Layout 1, in file order. */
  records?: MdbRecord[];
}

/**
 * 0x00 u8 version, 0x01 u8 layout, 0x02 char[27] creator, 0x28 u32 build time;
 * layout 3: 0x30 u32 size + zlib; layout 1: 0x30 u32 index zlib size, u32
 * index size, zlib index {6 x u32, then {u32 key, u32 offset}}, then records
 * {u16 size, u16 zlib size, zlib}, offsets counted from the first record.
 */ // qdsp6sw.mbn: /mdb/nr/mcc2arfcn.mdb, /mdb/nr/plmn2features.mdb samples
export function readMdb(b: Uint8Array): MdbFile {
  if (b.length < 0x34) throw new Error("mdb: too short");
  const t = u32(b, 0x28);
  const header: MdbHeader = { version: b[0], layout: b[1], creator: cstr(b.subarray(2, 0x1d)), ...(t ? { built: new Date(t * 1000).toISOString() } : {}) };
  if (header.layout === 3) return { header, blob: inflate(b.subarray(0x34), u32(b, 0x30)) };
  if (header.layout !== 1) throw new Error(`mdb: unknown layout ${header.layout}`);
  const zlen = u32(b, 0x30);
  const idx = inflate(b.subarray(0x38, 0x38 + zlen), u32(b, 0x34));
  const keySize = u32(idx, 0), entrySize = u32(idx, 16);
  if (keySize !== 4 || entrySize !== 8) throw new Error(`mdb: index entries of ${entrySize} bytes, keys of ${keySize}`);
  const base = 0x38 + zlen;
  const byOffset = new Map<number, number[]>();
  for (let o = 24; o + 8 <= idx.length; o += 8) {
    const off = u32(idx, o + 4);
    const keys = byOffset.get(off) ?? [];
    keys.push(u32(idx, o));
    byOffset.set(off, keys);
  }
  const records: MdbRecord[] = [];
  for (const [off, keys] of [...byOffset].sort((x, y) => x[0] - y[0])) {
    const o = base + off;
    if (o + 4 > b.length) throw new Error(`mdb: record at ${off} is past the end`);
    records.push({ keys, data: inflate(b.subarray(o + 4, o + 4 + u16(b, o + 2)), u16(b, o)) });
  }
  return { header, records };
}

/* ------------------------------------------------------------ PLMN keys */

const digit = (n: number) => (n <= 9 ? String(n) : "F");

/** 3GPP TS 24.008 PLMN bytes as a u24 (MCC2|MCC1, MNC3|MCC3, MNC2|MNC1) to "MCC-MNC"; an MNC of FF means any. */ // TS 24.008 10.5.1.3
export function plmnFromKey(key: number): string {
  const b0 = (key >> 16) & 0xff, b1 = (key >> 8) & 0xff, b2 = key & 0xff;
  const mcc = digit(b0 & 15) + digit(b0 >> 4) + digit(b1 & 15);
  const mnc3 = b1 >> 4;
  const mnc = digit(b2 & 15) + digit(b2 >> 4) + (mnc3 === 15 ? "" : digit(mnc3));
  return `${mcc}-${mnc}`;
}

/* -------------------------------------------------------------- NR-ARFCN */

/** NR-ARFCN to MHz (global frequency raster). */ // TS 38.104 5.4.2.1
export function nrArfcnToMHz(n: number): number {
  const f = n < 600000 ? n * 0.005 : n < 2016667 ? 3000 + (n - 600000) * 0.015 : 24250.08 + (n - 2016667) * 0.06;
  return Math.round(f * 1000) / 1000;
}

// TS 38.101-1 / 38.101-2 Table 5.2-1 [band, UL lo, UL hi, DL lo, DL hi] MHz; TDD bands repeat the range, SUL/SDL leave the other side 0
const NR_BANDS: Array<[number, number, number, number, number]> = [
  [1, 1920, 1980, 2110, 2170], [2, 1850, 1910, 1930, 1990], [3, 1710, 1785, 1805, 1880], [5, 824, 849, 869, 894],
  [7, 2500, 2570, 2620, 2690], [8, 880, 915, 925, 960], [12, 699, 716, 729, 746], [13, 777, 787, 746, 756],
  [14, 788, 798, 758, 768], [18, 815, 830, 860, 875], [20, 832, 862, 791, 821], [24, 1626.5, 1660.5, 1525, 1559],
  [25, 1850, 1915, 1930, 1995], [26, 814, 849, 859, 894], [28, 703, 748, 758, 803], [29, 0, 0, 717, 728],
  [30, 2305, 2315, 2350, 2360], [34, 2010, 2025, 2010, 2025], [38, 2570, 2620, 2570, 2620], [39, 1880, 1920, 1880, 1920],
  [40, 2300, 2400, 2300, 2400], [41, 2496, 2690, 2496, 2690], [46, 5150, 5925, 5150, 5925], [47, 5855, 5925, 5855, 5925],
  [48, 3550, 3700, 3550, 3700], [50, 1432, 1517, 1432, 1517], [51, 1427, 1432, 1427, 1432], [53, 2483.5, 2495, 2483.5, 2495],
  [65, 1920, 2010, 2110, 2200], [66, 1710, 1780, 2110, 2200], [67, 0, 0, 738, 758], [70, 1695, 1710, 1995, 2020],
  [71, 663, 698, 617, 652], [74, 1427, 1470, 1475, 1518], [75, 0, 0, 1432, 1517], [76, 0, 0, 1427, 1432],
  [77, 3300, 4200, 3300, 4200], [78, 3300, 3800, 3300, 3800], [79, 4400, 5000, 4400, 5000], [80, 1710, 1785, 0, 0],
  [81, 880, 915, 0, 0], [82, 832, 862, 0, 0], [83, 703, 748, 0, 0], [84, 1920, 1980, 0, 0], [85, 698, 716, 728, 746],
  [86, 1710, 1780, 0, 0], [89, 824, 849, 0, 0], [90, 2496, 2690, 2496, 2690], [91, 832, 862, 1427, 1432],
  [92, 832, 862, 1432, 1517], [93, 880, 915, 1427, 1432], [94, 880, 915, 1432, 1517], [95, 2010, 2025, 0, 0],
  [96, 5925, 7125, 5925, 7125], [97, 2300, 2400, 0, 0], [98, 1880, 1920, 0, 0], [99, 1626.5, 1660.5, 0, 0],
  [100, 874.4, 880, 919.4, 925], [101, 1900, 1910, 1900, 1910], [102, 5925, 6425, 5925, 6425], [104, 6425, 7125, 6425, 7125],
  [105, 663, 703, 612, 703], [106, 896, 901, 935, 940],
  [257, 26500, 29500, 26500, 29500], [258, 24250, 27500, 24250, 27500], [259, 39500, 43500, 39500, 43500],
  [260, 37000, 40000, 37000, 40000], [261, 27500, 28350, 27500, 28350], [262, 47200, 48200, 47200, 48200], [263, 57000, 71000, 57000, 71000],
];

/** NR bands whose uplink or downlink range holds [lo, hi] MHz. */
function bandsHolding(lo: number, hi: number, uplink: boolean): number[] {
  return NR_BANDS.filter(([, ul0, ul1, dl0, dl1]) => (uplink ? ul0 && lo >= ul0 && hi <= ul1 : dl0 && lo >= dl0 && hi <= dl1)).map((x) => x[0]);
}

/* ------------------------------------------------------------ mcc2arfcn */

export interface ArfcnRange {
  lo: number;
  hi: number;
  loMHz: number;
  hiMHz: number;
  uplink: boolean;
  /** Per-range u32, meaning unknown (2 for n77, 24 for n258, 1 for n28). */
  x: number;
}

export interface MccScanEntry {
  /** Undefined = any country (4095). */
  mcc?: string;
  /** Second key, meaning unknown; not a band number. */
  key: number;
  flags: number;
  ranges: ArfcnRange[];
  /** The one NR band holding every range, when exactly one does. */
  band?: number;
}

/**
 * Blob: 7 x u32 {key size, value size, data bytes, data bytes, capacity, record
 * size, 0}; each record {u32 mcc, u32 key, u32 ranges, u32 flags, 16 x {u32 lo,
 * u32 hi, u32 x, u32 uplink}}, NR-ARFCN.
 */ // qdsp6sw.mbn: /mdb/nr/mcc2arfcn.mdb
export function parseMcc2Arfcn(blob: Uint8Array): MccScanEntry[] {
  const dataBytes = u32(blob, 8), size = u32(blob, 20);
  if (size < 16 || 28 + dataBytes > blob.length) throw new Error("mcc2arfcn: bad blob header");
  const out: MccScanEntry[] = [];
  for (let r = 28; r + size <= 28 + dataBytes; r += size) {
    const mcc = u32(blob, r), n = Math.min(u32(blob, r + 8), (size - 16) >> 4);
    const ranges: ArfcnRange[] = [];
    for (let k = 0; k < n; k++) {
      const q = r + 16 + k * 16;
      const lo = u32(blob, q), hi = u32(blob, q + 4);
      ranges.push({ lo, hi, loMHz: nrArfcnToMHz(lo), hiMHz: nrArfcnToMHz(hi), uplink: u32(blob, q + 12) === 1, x: u32(blob, q + 8) });
    }
    let common: number[] | undefined;
    for (const g of ranges) {
      const hold = bandsHolding(g.loMHz, g.hiMHz, g.uplink);
      common = common ? common.filter((b) => hold.includes(b)) : hold;
    }
    out.push({ ...(mcc === 4095 ? {} : { mcc: String(mcc).padStart(3, "0") }), key: u32(blob, r + 4), flags: u32(blob, r + 12), ranges, ...(common?.length === 1 ? { band: common[0] } : {}) });
  }
  return out;
}

/* --------------------------------------------------------- plmn2features */

export interface PlmnFeatures {
  plmns: string[];
  /** u32 tag of the record (0x303 NR, 0x37f LTE). */
  tag: number;
  /** [feature id, value]; the ids are not bands and are not named anywhere in the firmware. */
  features?: Array<[number, number]>;
  /** Record bytes past the tag, trailing zeros cut, when they are not a feature list. */
  hex?: string;
}

const trimZeros = (b: Uint8Array) => { let n = b.length; while (n && !b[n - 1]) n--; return b.subarray(0, n); };

/** NR record: u32 0x303, u32 ?, u32 0x102, u32 count, count x {u16 value, u16 id}; other shapes are kept as hex. */ // qdsp6sw.mbn: /mdb/nr/plmn2features.mdb, /mdb/lte/plmn2features_lte.mdb
export function parsePlmnFeatures(f: MdbFile): PlmnFeatures[] {
  return (f.records ?? []).map((r) => {
    const d = r.data, tag = u32(d, 0);
    const out: PlmnFeatures = { plmns: r.keys.map(plmnFromKey), tag };
    const n = d.length >= 16 && u32(d, 8) === 0x102 ? u32(d, 12) : -1;
    if (n >= 0 && 16 + 4 * n <= d.length) {
      out.features = [];
      for (let i = 0; i < n; i++) out.features.push([u16(d, 16 + 4 * i + 2), u16(d, 16 + 4 * i)]);
    } else {
      out.hex = bytesToHex(trimZeros(d.subarray(4)));
    }
    return out;
  });
}

/* --------------------------------------------------------- small EFS files */

export interface ModemEfsValue {
  name: string;
  /** Decoded value, in words. */
  value: string;
  confidence: MdbConfidence;
}

// qdsp6sw.mbn: mmode device_mode enum (MSSS / DSDS / DSDA configs)
const DEVICE_MODES = ["single SIM", "dual SIM, dual standby (DSDS)", "dual SIM, dual active (DSDA)"];

/** What a small modem EFS file holds, for the ones whose layout is known. */ // qdsp6sw.mbn: DSDS-MN-Sariska / MSSS-MN-Sariska configs
export function decodeModemEfs(path: string, d: Uint8Array): ModemEfsValue | undefined {
  if (path === "/policyman/fullrat_timer" && d.length === 8) {
    return { name: "Full-RAT fallback timer", value: `${u32(d, 0)} s before trying every technology; second value ${u32(d, 4)} (unknown)`, confidence: "med" };
  }
  if (path === "/nv/item_files/modem/mmode/device_mode" && d.length === 1) {
    return { name: "Device mode", value: DEVICE_MODES[d[0]] ?? `mode ${d[0]}`, confidence: "med" };
  }
  if (path === "/protected/mcfg/active_int_carrier_info" && d.length > 0) {
    return { name: "Active built-in carrier config", value: cstr(d) || "(empty)", confidence: "med" };
  }
  if (path === "/mcfg_ftb" && d.length === 8) {
    return { name: "MCFG first-boot flag", value: d.every((x) => !x) ? "clear" : bytesToHex(d), confidence: "low" };
  }
  return undefined;
}
