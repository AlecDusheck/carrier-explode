/**
 * CDMA Preferred Roaming List decoder: the IS-683-A PRL (SSPR_P_REV 1) and the
 * Extended PRL (SSPR_P_REV 3). Field layout per 3GPP2 C.S0016-D v1.0 §3.5.5.
 */

import { BitReader, bytesToHex, crc16Ccitt } from "./bytes";

export interface PrlChannel {
  /** CDMA band class; absent for records that imply one (cellular, PCS). */
  band?: number;
  bandName?: string;
  channel: number;
}

export interface PrlAcqRecord {
  index: number;
  type: number;
  typeName: string;
  /** Octets of type-specific data (extended records only). */
  length?: number;
  /** A_B: cellular system A/B selection. */
  system?: string;
  /** PRI_SEC: standard channel selection. */
  channelSelection?: string;
  /** PCS frequency blocks. */
  blocks?: string[];
  channels?: PrlChannel[];
  /** Type-specific bytes for record types without a decoder. */
  raw?: string;
}

export interface PrlSysRecord {
  index: number;
  type: number;
  typeName: string;
  /** Record length in octets (extended records only). */
  length?: number;
  /** PREF_NEG: true = preferred (allowed), false = negative (forbidden). */
  preferred: boolean;
  /** GEO: true when in the same geographic region as the previous record. */
  geo: boolean;
  /** PRI: true when more desirable than the next record. */
  priority: boolean;
  /** GEO region number, counting from 0. */
  region: number;
  acqIndex: number;
  roamInd?: number;
  roamIndName?: string;
  sid?: number;
  /** NID, including the value NID_INCL implies when not stored. */
  nid?: number;
  nidIncl?: string;
  /** HRPD subnet as hex, with its length in bits. */
  subnet?: string;
  mcc?: string;
  mnc?: string;
  subtype?: string;
  sids?: number[];
  sidNids?: Array<{ sid: number; nid: number }>;
  subnetIds?: string[];
  association?: { tag: number; pn: boolean; data: boolean };
  raw?: string;
}

export interface PrlDecoded {
  /** "prl" for SSPR_P_REV 1, "extended" for SSPR_P_REV 3. */
  format: "prl" | "extended";
  sspPRev: number;
  /** PR_LIST_SIZE, in octets including the CRC. */
  size: number;
  id: number;
  prefOnly: boolean;
  defRoamInd: number;
  defRoamIndName: string;
  numAcqRecs: number;
  numCommonSubnetRecs?: number;
  numSysRecs: number;
  /** GEO regions in the system table. */
  regions: number;
  acquisition: PrlAcqRecord[];
  /** Common Subnet Table entries (hex), extended PRL only. */
  commonSubnets?: string[];
  systems: PrlSysRecord[];
  crc: { stored: number; computed: number; ok: boolean };
  /** Reserved bits between the last record and the CRC. */
  padBits: number;
  warnings: string[];
}

// C.S0016-D Table 3.5.5.2-2 (values 1-9 also Table 3.5.5.2-1)
const ACQ_TYPES: Record<number, string> = {
  0: "Reserved",
  1: "Cellular Analog",
  2: "Cellular CDMA (Standard Channels)",
  3: "Cellular CDMA (Custom Channels)",
  4: "Cellular CDMA Preferred",
  5: "PCS CDMA (Using Blocks)",
  6: "PCS CDMA (Using Channels)",
  7: "JTACS CDMA (Standard Channels)",
  8: "JTACS CDMA (Custom Channels)",
  9: "2GHz Band (Using Channels)",
  10: "Generic cdma2000 1x and IS-95",
  11: "Generic HRPD",
  12: "Reserved (obsolete identification)",
  13: "Reserved (obsolete identification)",
  14: "Reserved (obsolete identification)",
  15: "Common acquisition table for UMB",
  16: "Generic UMB",
};

// C.S0016-D Table 3.5.5.2.1.1-1
const A_B = ["System A", "System B", "Reserved", "System A or B"];
// C.S0016-D Tables 3.5.5.2.1.2-1 and 3.5.5.2.1.7-1
const PRI_SEC = ["Reserved", "Primary", "Secondary", "Primary or Secondary"];
// C.S0016-D Table 3.5.5.2.1.5-1
const BLOCKS = ["A", "B", "C", "D", "E", "F", "Reserved", "Any"];
// C.S0016-D Tables 3.5.5.3-1 and 3.5.5.3.2-3
const NID_INCL = ["not included, NID 65535 (any)", "included", "not included, NID 0 (public)", "reserved"];
// C.S0016-D Table 3.5.5.3.2-1
const SYS_TYPES: Record<number, string> = {
  0: "cdma2000 1x and IS-95",
  1: "HRPD",
  2: "Reserved (obsolete identification)",
  3: "MCC-MNC based",
};
// C.S0016-D Table 3.5.5.3.2.2-2
const SYS_SUBTYPES = ["MCC, MNC only", "MCC, MNC and SIDs", "MCC, MNC, SIDs and NIDs", "MCC, MNC and subnet IDs"];

// 3GPP2 C.S0057-E Table 1.5-1
const BAND_CLASSES: Record<number, string> = {
  0: "800 MHz cellular",
  1: "1.9 GHz PCS",
  2: "TACS",
  3: "JTACS",
  4: "Korean PCS",
  5: "450 MHz",
  6: "2 GHz IMT-2000",
  7: "Upper 700 MHz",
  8: "1800 MHz",
  9: "900 MHz",
  10: "Secondary 800 MHz",
  11: "400 MHz European PAMR",
  12: "800 MHz PAMR",
  13: "2.5 GHz IMT-2000 extension",
  14: "US PCS 1.9 GHz",
  15: "AWS",
  16: "US 2.5 GHz",
  17: "US 2.5 GHz forward link only",
  18: "700 MHz public safety",
  19: "Lower 700 MHz",
  20: "L-band",
  21: "S-band",
};

// 3GPP2 C.R1001-H §8.1 (Enhanced Roaming Indicator)
const ROAM_IND = [
  "Roaming indicator on",
  "Roaming indicator off",
  "Roaming indicator flashing",
  "Out of neighborhood",
  "Out of building",
  "Roaming: preferred system",
  "Roaming: available system",
  "Roaming: alliance partner",
  "Roaming: premium partner",
  "Roaming: full service functionality",
  "Roaming: partial service functionality",
  "Roaming banner on",
  "Roaming banner off",
];

export function bandClassName(band: number): string | undefined {
  return BAND_CLASSES[band];
}

export function roamIndName(v: number): string {
  if (v < ROAM_IND.length) return ROAM_IND[v];
  if (v < 64) return "Reserved (standard ERI)";
  if (v < 128) return "Operator-defined ERI"; // meaning comes from the carrier's ERI file
  return "Reserved";
}

/** 12-bit BCD MCC/MNC; 'F' nibbles mark absent digits. */ // C.S0016-D Table 3.5.5.3.2.2-3
function bcd3(v: number): string {
  return [v >> 8, (v >> 4) & 15, v & 15].filter((d) => d !== 15).map((d) => d.toString(16)).join("");
}

/** Channel lists shared by the legacy and extended cellular/PCS/JTACS/2 GHz records. */ // §3.5.5.2.1.3, §3.5.5.2.1.6
function chanList(r: BitReader): PrlChannel[] {
  const n = r.u(5);
  const out: PrlChannel[] = [];
  for (let i = 0; i < n; i++) out.push({ channel: r.u(11) });
  return out;
}

/** Type-specific acquisition fields for types 1-9, identical in both formats bar the reserved padding. */ // §3.5.5.2.1, §3.5.5.2.2
function acqBody(type: number, r: BitReader, rec: PrlAcqRecord): boolean {
  switch (type) {
    case 1:
    case 4:
      rec.system = A_B[r.u(2)];
      return true;
    case 2:
    case 7:
      rec.system = A_B[r.u(2)];
      rec.channelSelection = PRI_SEC[r.u(2)];
      return true;
    case 3:
    case 6:
    case 8:
    case 9:
      rec.channels = chanList(r);
      return true;
    case 5: {
      const n = r.u(3);
      rec.blocks = [];
      for (let i = 0; i < n; i++) rec.blocks.push(BLOCKS[r.u(3)]);
      return true;
    }
    default:
      return false;
  }
}

function crcOf(bytes: Uint8Array, size: number) {
  const stored = size >= 2 && size <= bytes.length ? (bytes[size - 2] << 8) | bytes[size - 1] : -1;
  const computed = crc16Ccitt(bytes.subarray(0, Math.max(0, size - 2)), true); // §3.5.5.1; corpus: 35 PRLs
  return { stored, computed, ok: stored === computed };
}

function header(bytes: Uint8Array) {
  if (bytes.length < 8) throw new Error("PRL too short");
  return { size: (bytes[0] << 8) | bytes[1], id: (bytes[2] << 8) | bytes[3] };
}

/** Walks the system table, tracking GEO regions. */
function region(systems: PrlSysRecord[], geo: boolean): number {
  const prev = systems[systems.length - 1];
  return prev ? (geo ? prev.region : prev.region + 1) : 0;
}

/** SSPR_P_REV 1: bit-packed records, no length fields. */ // C.S0016-D §3.5.5 (Preferred Roaming List)
function decodeLegacy(bytes: Uint8Array): PrlDecoded {
  const { size, id } = header(bytes);
  const end = Math.min(size, bytes.length) * 8 - 16;
  const r = new BitReader(bytes, 32, end);
  const warnings: string[] = [];
  const prefOnly = r.flag();
  const defRoamInd = r.u(8);
  const numAcqRecs = r.u(9);
  const numSysRecs = r.u(14);

  const acquisition: PrlAcqRecord[] = [];
  for (let i = 0; i < numAcqRecs; i++) {
    const type = r.u(4);
    const rec: PrlAcqRecord = { index: i, type, typeName: ACQ_TYPES[type] ?? "Reserved" };
    if (!acqBody(type, r, rec)) throw new Error(`acquisition record ${i}: reserved type ${type}`);
    acquisition.push(rec);
  }

  const systems: PrlSysRecord[] = [];
  for (let i = 0; i < numSysRecs; i++) {
    const sid = r.u(15); // §3.5.5.3.1
    const incl = r.u(2);
    const nid = incl === 1 ? r.u(16) : incl === 2 ? 0 : 65535;
    const preferred = r.flag();
    const geo = r.flag();
    const priority = preferred ? r.flag() : false;
    const acqIndex = r.u(9);
    const rec: PrlSysRecord = {
      index: i, type: 0, typeName: SYS_TYPES[0], preferred, geo, priority,
      region: region(systems, geo), acqIndex, sid, nid, nidIncl: NID_INCL[incl],
    };
    if (preferred) {
      rec.roamInd = r.u(8);
      rec.roamIndName = roamIndName(rec.roamInd);
    }
    if (acqIndex >= numAcqRecs) warnings.push(`system record ${i}: ACQ_INDEX ${acqIndex} out of range`);
    systems.push(rec);
  }
  const padBits = end - r.pos;
  if (padBits >= 8) warnings.push(`${padBits} bits left between the system table and the CRC`);
  return {
    format: "prl", sspPRev: 1, size, id, prefOnly, defRoamInd, defRoamIndName: roamIndName(defRoamInd),
    numAcqRecs, numSysRecs, regions: systems.length ? systems[systems.length - 1].region + 1 : 0,
    acquisition, systems, crc: crcOf(bytes, size), padBits, warnings,
  };
}

/** SSPR_P_REV 3: octet-aligned, length-prefixed records. */ // C.S0016-D §3.5.5 (Extended Preferred Roaming List)
function decodeExtended(bytes: Uint8Array): PrlDecoded {
  const { size, id } = header(bytes);
  const end = Math.min(size, bytes.length) * 8 - 16;
  const r = new BitReader(bytes, 32, end);
  const warnings: string[] = [];
  const sspPRev = r.u(8);
  const prefOnly = r.flag();
  const defRoamInd = r.u(8);
  const numAcqRecs = r.u(9);
  const numCommonSubnetRecs = r.u(9);
  const numSysRecs = r.u(14);
  r.skip(7);

  const acquisition: PrlAcqRecord[] = [];
  for (let i = 0; i < numAcqRecs; i++) {
    const type = r.u(8); // §3.5.5.2.2
    const length = r.u(8);
    const start = r.pos;
    if (start + length * 8 > end) throw new Error(`acquisition record ${i} overruns the list`);
    const body = new BitReader(bytes, start, start + length * 8);
    const rec: PrlAcqRecord = { index: i, type, typeName: ACQ_TYPES[type] ?? "Reserved", length };
    if (type === 10 || type === 11) {
      // §3.5.5.2.2.10-11: LENGTH/2 (BAND_CLASS 5, CHANNEL_NUMBER 11) pairs
      rec.channels = [];
      while (body.left >= 16) {
        const band = body.u(5);
        rec.channels.push({ band, bandName: bandClassName(band), channel: body.u(11) });
      }
    } else if (!acqBody(type, body, rec)) {
      rec.raw = bytesToHex(bytes.subarray(start >> 3, (start >> 3) + length));
    } else if (body.left >= 8) {
      warnings.push(`acquisition record ${i}: ${body.left} bits unused`);
    }
    acquisition.push(rec);
    r.pos = start + length * 8;
  }

  // §3.5.5.3.2.1: RESERVED 4, SUBNET_COMMON_LENGTH 4, SUBNET_COMMON 8×length
  const tableStart = r.pos >> 3;
  const commonSubnets: string[] = [];
  const subnetAt = new Map<number, string>();
  for (let i = 0; i < numCommonSubnetRecs; i++) {
    const off = (r.pos >> 3) - tableStart;
    r.skip(4);
    const len = r.u(4);
    const hex = r.hex(len * 8);
    commonSubnets.push(hex);
    subnetAt.set(off, hex);
  }

  const systems: PrlSysRecord[] = [];
  for (let i = 0; i < numSysRecs; i++) {
    const start = r.pos;
    const length = r.u(5); // §3.5.5.3.2
    const type = r.u(4);
    const recEnd = start + length * 8;
    if (length === 0 || recEnd > end) throw new Error(`system record ${i} has bad length ${length}`);
    const s = new BitReader(bytes, r.pos, recEnd);
    const preferred = s.flag();
    const geo = s.flag();
    const priority = s.flag();
    const acqIndex = s.u(9);
    const rec: PrlSysRecord = {
      index: i, type, typeName: SYS_TYPES[type] ?? "Reserved", length,
      preferred, geo, priority, region: region(systems, geo), acqIndex,
    };
    let known = true;
    switch (type) {
      case 0: {
        s.skip(1); // Table 3.5.5.3.2-2
        const incl = s.u(2);
        rec.sid = s.u(15);
        rec.nid = incl === 1 ? s.u(16) : incl === 2 ? 0 : 65535;
        rec.nidIncl = NID_INCL[incl];
        break;
      }
      case 1: {
        s.skip(3); // Table 3.5.5.3.2-4
        const hasCommon = s.flag();
        const lsbLen = s.u(7);
        const lsb = new BitReader(bytes, s.pos, s.pos + lsbLen);
        s.skip(lsbLen);
        let common = "";
        if (hasCommon) {
          const off = s.u(12);
          const c = subnetAt.get(off);
          if (c === undefined) warnings.push(`system record ${i}: no common subnet at offset ${off}`);
          else common = c;
        }
        rec.subnet = `${joinBits(common, lsb, lsbLen)}/${common.length * 4 + lsbLen}`;
        break;
      }
      case 3: {
        const sub = s.u(3); // §3.5.5.3.2.2
        rec.subtype = SYS_SUBTYPES[sub] ?? "Reserved";
        rec.mcc = bcd3(s.u(12)) || undefined;
        rec.mnc = bcd3(s.u(12)) || undefined; // all-'F': no digits stored
        if (sub === 1 || sub === 2 || sub === 3) {
          s.skip(4);
          const n = s.u(4);
          for (let k = 0; k < n; k++) {
            if (sub === 1) (rec.sids ??= []).push(s.u(16));
            else if (sub === 2) (rec.sidNids ??= []).push({ sid: s.u(16), nid: s.u(16) });
            else {
              const bits = s.u(8);
              (rec.subnetIds ??= []).push(`${s.hex(bits)}/${bits}`);
            }
          }
        } else if (sub !== 0) known = false;
        break;
      }
      default:
        known = false;
    }
    if (known) {
      if (preferred) {
        rec.roamInd = s.u(8);
        rec.roamIndName = roamIndName(rec.roamInd);
      }
      if (s.flag()) rec.association = { tag: s.u(8), pn: s.flag(), data: s.flag() };
      if (s.left >= 8) warnings.push(`system record ${i}: ${s.left} bits unused`);
    } else {
      rec.raw = bytesToHex(bytes.subarray(start >> 3, recEnd >> 3));
    }
    if (acqIndex >= numAcqRecs) warnings.push(`system record ${i}: ACQ_INDEX ${acqIndex} out of range`);
    systems.push(rec);
    r.pos = recEnd;
  }
  const padBits = end - r.pos;
  if (padBits >= 8) warnings.push(`${padBits} bits left between the system table and the CRC`);
  return {
    format: "extended", sspPRev, size, id, prefOnly, defRoamInd, defRoamIndName: roamIndName(defRoamInd),
    numAcqRecs, numCommonSubnetRecs, numSysRecs,
    regions: systems.length ? systems[systems.length - 1].region + 1 : 0,
    acquisition, commonSubnets, systems, crc: crcOf(bytes, size), padBits, warnings,
  };
}

/** Common-part hex followed by `n` bits from `lsb`, re-packed as one left-aligned hex string. */
function joinBits(common: string, lsb: BitReader, n: number): string {
  const bits: number[] = [];
  for (const ch of common) {
    const v = parseInt(ch, 16);
    for (let k = 3; k >= 0; k--) bits.push((v >> k) & 1);
  }
  for (let k = 0; k < n; k++) bits.push(lsb.u(1));
  while (bits.length % 4) bits.push(0);
  let s = "";
  for (let k = 0; k < bits.length; k += 4) s += ((bits[k] << 3) | (bits[k + 1] << 2) | (bits[k + 2] << 1) | bits[k + 3]).toString(16);
  return s;
}

function fits(d: PrlDecoded): boolean {
  return d.padBits >= 0 && d.padBits < 8;
}

/** True when the bytes look like a PRL: the size field matches and the CRC checks out. */
export function isPrl(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const { size } = header(bytes);
  return size === bytes.length && crcOf(bytes, size).ok;
}

/** Decodes a PRL; tries both layouts (byte 4 = 3 suggests extended) and keeps the one whose records end at the CRC. */
export function decodePrl(bytes: Uint8Array): PrlDecoded {
  const { size } = header(bytes);
  const tries = bytes[4] === 3 ? [decodeExtended, decodeLegacy] : [decodeLegacy, decodeExtended];
  let first: PrlDecoded | undefined;
  let err: Error | undefined;
  for (const t of tries) {
    try {
      const d = t(bytes);
      if (fits(d)) return finish(d, bytes, size);
      first ??= d;
    } catch (e) {
      err ??= e as Error;
    }
  }
  if (first) return finish(first, bytes, size);
  throw err ?? new Error("not a PRL");
}

function finish(d: PrlDecoded, bytes: Uint8Array, size: number): PrlDecoded {
  if (size !== bytes.length) d.warnings.unshift(`PR_LIST_SIZE is ${size} but the file is ${bytes.length} bytes`);
  if (!d.crc.ok) d.warnings.unshift("CRC mismatch");
  return d;
}

/** One-line description for the file list banner. */
export function describePrl(d: PrlDecoded): string {
  const fmt = d.format === "extended" ? `Extended PRL (SSPR_P_REV ${d.sspPRev})` : "PRL (SSPR_P_REV 1)";
  return `${fmt}, ID ${d.id}: ${d.acquisition.length} acquisition records, ${d.systems.length} system records in ${d.regions} GEO region${d.regions === 1 ? "" : "s"}; CRC ${d.crc.ok ? "ok" : "mismatch"}`;
}
