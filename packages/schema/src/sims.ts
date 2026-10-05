/** SimMatcher normalisation, so both platforms' spellings of one rule give one matcherKey. */

import { matcherKey, type SimMatcher } from "./types.ts";

/** 5 or 6 digits: MCC + 2- or 3-digit MNC. */
const isMccMnc = (s: string): boolean => /^\d{5,6}$/.test(s);

/** GID files are FF-padded (3GPP TS 31.102), so trailing FF bytes go; an all-FF GID is no rule at all. */
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

/** One matcher per matcherKey, the first of each. */
export function uniqueSims(sims: Iterable<SimMatcher>): SimMatcher[] {
  const byKey = new Map<string, SimMatcher>();
  for (const m of sims) if (!byKey.has(matcherKey(m))) byKey.set(matcherKey(m), m);
  return [...byKey.values()];
}
