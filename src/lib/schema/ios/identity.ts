/**
 * Which SIMs an iOS bundle is for, and which countries it serves. Two sources
 * say so: the bundle's own SupportedSIMs (carrier.plist, and each
 * MVNOOverrides entry), and Apple's manifest, which maps MCC+MNC (+ GID/ICCID)
 * to bundle names before the phone opens any bundle. The manifest is the
 * stronger claim (it is what routes a SIM), so linking (../identity.ts) takes
 * both.
 */

import type { MccMncTable } from "#lib/decode/index.ts";
import { carrierName, countryDisplay, splitName } from "#lib/names.ts";
import { isoForCountryName, isoForMcc } from "../mcc.ts";
import { simMatcher } from "../sims.ts";
import { sourceKey, type SimMatcher, type SourceRef } from "../types.ts";
import { stringSet } from "../values.ts";

/**
 * `310260`, `310260_GID1-54`, `310260_ID-89012600`, `20404_GID2-1A_ID-891480`:
 * the MCC+MNC, then any number of `_<FIELD>-<value>` qualifiers, all of which must match.
 */
export function parseSupportedSim(entry: string): SimMatcher | undefined {
  const [mccmnc = "", ...quals] = entry.trim().split("_");
  const fields: { gid1?: string; gid2?: string; iccidPrefix?: string } = {};
  for (const q of quals) {
    const m = /^(GID1|GID2|ID)-(.+)$/i.exec(q);
    if (!m?.[1] || !m[2]) return undefined;
    const kind = m[1].toUpperCase();
    if (kind === "GID1") fields.gid1 = m[2];
    else if (kind === "GID2") fields.gid2 = m[2];
    else fields.iccidPrefix = m[2];
  }
  return simMatcher({ mccmnc, ...fields });
}

export const supportedSims = (v: unknown): SimMatcher[] =>
  (Array.isArray(v) ? v : []).flatMap((e: unknown) => {
    const m = typeof e === "string" ? parseSupportedSim(e) : undefined;
    return m ? [m] : [];
  });

/**
 * Manifest routes per iOS carrier source key. Bare ICCID prefixes
 * (MobileDeviceCarriers) are left out: a SimMatcher needs an MCC+MNC, and the
 * same bundles are reachable through their PLMN entries anyway.
 */
export function manifestSims(table: Pick<MccMncTable, "entries">): Record<string, SimMatcher[]> {
  const out: Record<string, SimMatcher[]> = {};
  const add = (bundle: string, m: SimMatcher | undefined): void => {
    if (!bundle || !m) return;
    const key = sourceKey({ platform: "ios", kind: "carrier", name: bundle });
    (out[key] ??= []).push(m);
  };
  for (const e of table.entries) {
    if (e.bundle) add(e.bundle, simMatcher({ mccmnc: e.plmn }));
    for (const v of e.mvnos) add(v.bundle, simMatcher({ mccmnc: e.plmn, gid1: v.gid1, gid2: v.gid2, iccidPrefix: v.iccid }));
  }
  return out;
}

/** How a source is named to people: the brand for carriers (`ATT_US` -> AT&T), the country for country bundles. */
export function iosDisplay(source: SourceRef): string {
  return source.kind === "country" ? countryDisplay(source.name) : carrierName(source.name).brand;
}

/**
 * ISO codes, best evidence first: ISOAlpha2CountryCode (country bundles), the
 * name's suffix, HomeBundleIdentifier, SupportedCountryIds MCCs, then the
 * MCCs of the SIMs it claims.
 */
export function iosIso(source: SourceRef, plist: Readonly<Record<string, unknown>>, sims: readonly SimMatcher[]): string[] {
  const listed = (Array.isArray(plist.ISOAlpha2CountryCode) ? plist.ISOAlpha2CountryCode : [plist.ISOAlpha2CountryCode])
    .flatMap((x: unknown) => (typeof x === "string" && /^[a-z]{2}$/i.test(x) ? [x.toLowerCase()] : []));
  if (listed.length) return stringSet(listed);
  const named = source.kind === "country" ? isoForCountryName(source.name) : splitName(source.name).cc;
  if (named) return [named];
  const home = typeof plist.HomeBundleIdentifier === "string" ? isoForCountryName(plist.HomeBundleIdentifier) : undefined;
  if (home) return [home];
  const ids = Array.isArray(plist.SupportedCountryIds) ? plist.SupportedCountryIds : [];
  const byId = ids.flatMap((x: unknown) => {
    const iso = typeof x !== "string" ? undefined : /^\d{3}$/.test(x) ? isoForMcc(x) : isoForCountryName(x);
    return iso ? [iso] : [];
  });
  if (byId.length) return stringSet(byId);
  return stringSet(sims.flatMap((m) => isoForMcc(m.mccmnc) ?? []));
}
