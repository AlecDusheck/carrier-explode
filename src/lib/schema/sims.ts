/**
 * SimMatcher normalisation, shared by both mappers so that equal rules give
 * equal matcherKeys. The two platforms write the same SIM facts differently:
 * iOS `310410_GID1-FFFF`, `23410_GID1-0AFFFF`, `354d`; Android `310410`,
 * `23410|gid1=0A`, `BAE1000000000000`. Normalising is what lets a plain
 * matcherKey comparison (./identity.ts) link them.
 */

import type { SimMatcher } from "./types.ts";

/** 5 or 6 digits: MCC + 2- or 3-digit MNC. */
export const isMccMnc = (s: string): boolean => /^\d{5,6}$/.test(s);

/**
 * A GID value as a prefix: upper-case hex, with trailing FF bytes dropped.
 * GID files are FF-padded (3GPP TS 31.102 4.2.10), so `0AFFFF` and `0A`
 * match the same SIMs. An all-FF GID is an
 * unprogrammed GID file, i.e. no GID rule at all: returns undefined.
 * Trailing 00 bytes are kept: a prefix rule with zeros is narrower.
 */
export function normaliseGid(raw: string): string | undefined {
  let hex = raw.trim().toUpperCase();
  if (!/^[0-9A-F]+$/.test(hex)) return hex || undefined;
  while (hex.length % 2 === 0 && hex.endsWith("FF")) hex = hex.slice(0, -2);
  return hex || undefined;
}

/** Build a SimMatcher with only the present fields, normalised. Undefined when mccmnc is malformed. */
export function simMatcher(fields: {
  mccmnc: string;
  gid1?: string | undefined;
  gid2?: string | undefined;
  spn?: string | undefined;
  imsiPrefix?: string | undefined;
  iccidPrefix?: string | undefined;
}): SimMatcher | undefined {
  const mccmnc = fields.mccmnc.trim();
  if (!isMccMnc(mccmnc)) return undefined;
  const gid1 = fields.gid1 === undefined ? undefined : normaliseGid(fields.gid1);
  const gid2 = fields.gid2 === undefined ? undefined : normaliseGid(fields.gid2);
  // SPN comparisons on the phone are case-insensitive (CarrierResolver), so the key is too.
  const spn = fields.spn?.trim().toUpperCase() || undefined;
  const imsiPrefix = fields.imsiPrefix?.trim() || undefined;
  const iccidPrefix = fields.iccidPrefix?.trim() || undefined;
  return {
    mccmnc,
    ...(gid1 !== undefined ? { gid1 } : {}),
    ...(gid2 !== undefined ? { gid2 } : {}),
    ...(spn !== undefined ? { spn } : {}),
    ...(imsiPrefix !== undefined ? { imsiPrefix } : {}),
    ...(iccidPrefix !== undefined ? { iccidPrefix } : {}),
  };
}

/** True when the rule is the bare network code: any SIM of that MCC+MNC no narrower rule claims. */
export const isPlain = (m: SimMatcher): boolean =>
  m.gid1 === undefined && m.gid2 === undefined && m.spn === undefined && m.imsiPrefix === undefined && m.iccidPrefix === undefined;
