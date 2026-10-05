/**
 * Decoder for the Qualcomm-phone form of `overrides_<boards>.der.tri`: one DER [0] wrapping records of
 * u16-LE type, u16-LE length and value, record 3 holding records of its own. The Apple-modem form is
 * a `.der.pri` in the Intel dialect and decodes as one.
 */

import { bytesToHex, errorMessage, u16le } from "@carrier-explode/binary";
import { plmnFromKey, type Confidence } from "@carrier-explode/decode-qualcomm";
import { readTlv } from "./der.ts";

const ROLES = ["version", "records", "plmn", "plmn-list", "plmn-act-list"] as const;
type Role = (typeof ROLES)[number];

interface TriFieldInfo {
  readonly role: Role;
  readonly name?: string;
  readonly confidence: Confidence;
}

/** Records by their path of types. Lists are named for the SIM files the same bundle's Apple-modem file sets to the same PLMNs. */
const TRI_FIELDS = {
  "1": { role: "version", name: "File version", confidence: "high" },
  "3": { role: "records", confidence: "high" },
  "3/1": { role: "plmn", confidence: "low" },
  "3/3": { role: "plmn-act-list", name: "Operator PLMN selector with access technology (EF OPLMNwACT)", confidence: "med" },
  "3/4": { role: "plmn-list", name: "Equivalent home PLMNs (EF EHPLMN)", confidence: "med" },
  "3/5": { role: "plmn-list", name: "Forbidden PLMNs (EF FPLMN)", confidence: "low" },
} satisfies Record<string, TriFieldInfo>;

const isFieldPath = (path: string): path is keyof typeof TRI_FIELDS => Object.hasOwn(TRI_FIELDS, path);
const fieldInfo = (path: string): TriFieldInfo | undefined => (isFieldPath(path) ? TRI_FIELDS[path] : undefined);

// UTRAN, E-UTRAN and GSM sit where TS 31.102 §4.2.5 puts them; NG-RAN does not: this bit is set on exactly
// the PLMNs the Apple-modem file gives TS 31.102's NG-RAN bit (0x0800).
const ACCESS_BITS = [[0x8000, "UTRAN"], [0x4000, "E-UTRAN"], [0x0080, "GSM"], [0x0008, "NG-RAN"]] as const;
const NAMED_BITS = ACCESS_BITS.reduce((m, [bit]) => m | bit, 0);

export interface TriAccess {
  readonly names: readonly string[];
  /** Set bits no source names, as a big-endian u16 mask; 0 when every set bit is named. */
  readonly unknownBits: number;
}

export interface TriPlmnAccess {
  /** "208-01"; a nibble that is not a digit reads F. */
  readonly plmn: string;
  /** The entry's two access-technology bytes. */
  readonly hex: string;
  readonly access: TriAccess;
}

interface TriFieldBase {
  /** Record types from the top, `3/4`. */
  readonly path: string;
  readonly hex: string;
  readonly name?: string;
  readonly confidence?: Confidence;
}

export type TriField =
  | (TriFieldBase & { readonly kind: "version"; readonly version: string })
  | (TriFieldBase & { readonly kind: "plmn"; readonly plmn: string })
  | (TriFieldBase & { readonly kind: "plmn-list"; readonly plmns: readonly string[] })
  | (TriFieldBase & { readonly kind: "plmn-act-list"; readonly entries: readonly TriPlmnAccess[] })
  | (TriFieldBase & { readonly kind: "unknown" });

export interface TriDecoded {
  /** Every record in file order, nested ones flattened; bytes no record holds are kept as unknown fields. */
  readonly fields: readonly TriField[];
  readonly errors: readonly string[];
}

const plmnAt = (b: Uint8Array, o: number): string => plmnFromKey(((b[o] ?? 0) << 16) | ((b[o + 1] ?? 0) << 8) | (b[o + 2] ?? 0));

function accessOf(b: Uint8Array): TriAccess {
  const bits = ((b[0] ?? 0) << 8) | (b[1] ?? 0);
  return { names: ACCESS_BITS.flatMap(([bit, name]) => (bits & bit ? [name] : [])), unknownBits: bits & ~NAMED_BITS };
}

/** A record as its role reads it; a value whose length does not fit the role stays unknown. */
function readField(path: string, v: Uint8Array): TriField | undefined {
  const info = fieldInfo(path);
  const base: TriFieldBase = { path, hex: bytesToHex(v), ...(info?.name === undefined ? {} : { name: info.name }), ...(info ? { confidence: info.confidence } : {}) };
  switch (info?.role) {
    case "version":
      // major.minor.patch, matching the overrides plist's DerTriFileVersion
      return v.length === 4 ? { ...base, kind: "version", version: `${v[0]}.${v[1]}.${u16le(v, 2)}` } : undefined;
    case "plmn":
      return v.length === 3 ? { ...base, kind: "plmn", plmn: plmnAt(v, 0) } : undefined;
    case "plmn-list":
      return v.length % 3 === 0 ? { ...base, kind: "plmn-list", plmns: Array.from({ length: v.length / 3 }, (_, i) => plmnAt(v, 3 * i)) } : undefined;
    case "plmn-act-list":
      return v.length % 5 === 0
        ? {
          ...base,
          kind: "plmn-act-list",
          entries: Array.from({ length: v.length / 5 }, (_, i) => {
            const act = v.subarray(5 * i + 3, 5 * i + 5);
            return { plmn: plmnAt(v, 5 * i), hex: bytesToHex(act), access: accessOf(act) };
          }),
        }
        : undefined;
    default:
      return undefined;
  }
}

function readRecords(b: Uint8Array, parent: string, fields: TriField[], errors: string[]): void {
  let o = 0;
  while (o < b.length) {
    const type = o + 4 <= b.length ? u16le(b, o) : undefined;
    const len = o + 4 <= b.length ? u16le(b, o + 2) : undefined;
    if (type === undefined || len === undefined || o + 4 + len > b.length) {
      const path = `${parent}@${o}`;
      errors.push(`record at ${path} runs past its parent; its ${b.length - o} bytes are kept unread`);
      fields.push({ path, hex: bytesToHex(b.subarray(o)), kind: "unknown" });
      return;
    }
    const path = parent ? `${parent}/${type}` : String(type);
    const v = b.subarray(o + 4, o + 4 + len);
    if (fieldInfo(path)?.role === "records") readRecords(v, path, fields, errors);
    else fields.push(readField(path, v) ?? { path, hex: bytesToHex(v), kind: "unknown" });
    o += 4 + len;
  }
}

export function decodeTri(bytes: Uint8Array): TriDecoded {
  const fields: TriField[] = [];
  const errors: string[] = [];
  let end = 0;
  try {
    const t = readTlv(bytes, 0);
    if (t.tag !== 0xa0) throw new Error(`expected a DER [0] wrapper, found tag 0x${t.tag.toString(16)}`);
    readRecords(bytes.subarray(t.contentStart, t.contentEnd), "", fields, errors);
    end = t.end;
  } catch (e) {
    errors.push(errorMessage(e));
  }
  if (end < bytes.length) {
    if (end > 0) errors.push(`${bytes.length - end} bytes follow the DER wrapper`);
    fields.push({ path: `@${end}`, hex: bytesToHex(bytes.subarray(end)), kind: "unknown" });
  }
  return { fields, errors };
}
