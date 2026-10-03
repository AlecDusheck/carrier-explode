/**
 * Which SIMs an Android canonical carrier is for: carrier_list.pb maps each
 * CarrierId (mcc_mnc plus at most one of spn / imsi prefix / gid1 prefix) to a
 * canonical name, the same lookup CarrierResolver does on the phone. Generic
 * entries in others.pb are named after their rule (`20404GID1=2801`), so their
 * MCC is in the name even without the list.
 */

import type { CarrierId, CarrierList } from "#lib/decode/android/types.ts";
import { countryName } from "#lib/names.ts";
import { isoForMcc } from "../mcc.ts";
import { simMatcher } from "../sims.ts";
import { matcherKey, type SimMatcher } from "../types.ts";
import { stringSet } from "../values.ts";

const matcherOf = (id: CarrierId): SimMatcher | undefined =>
  simMatcher({ mccmnc: id.mccMnc, gid1: id.gid1, spn: id.spn, imsiPrefix: id.imsi });

/** The SIM rules carrier_list gives `canonical`, de-duplicated, in list order. */
export function listSims(list: CarrierList, canonical: string): SimMatcher[] {
  const byKey = new Map<string, SimMatcher>();
  for (const entry of list.entries) {
    if (entry.canonicalName !== canonical) continue;
    for (const id of entry.carrierIds) {
      const m = matcherOf(id);
      if (m && !byKey.has(matcherKey(m))) byKey.set(matcherKey(m), m);
    }
  }
  return [...byKey.values()];
}

/** `tmobile_us` -> "us"; only a real ISO code counts (`_zz`, `_satellite` do not). */
function suffixIso(canonical: string): string | undefined {
  const cc = /_([a-z]{2})$/.exec(canonical)?.[1];
  return cc !== undefined && countryName(cc) !== undefined ? cc : undefined;
}

/** ISO codes: the canonical name's suffix, else the MCCs of its SIMs, else of a rule-named canonical. */
export function androidIso(canonical: string, sims: readonly SimMatcher[]): string[] {
  const named = suffixIso(canonical);
  if (named) return [named];
  const fromSims = stringSet(sims.flatMap((m) => isoForMcc(m.mccmnc) ?? []));
  if (fromSims.length) return fromSims;
  const digits = /^(\d{5,6})/.exec(canonical)?.[1];
  const byName = digits === undefined ? undefined : isoForMcc(digits);
  return byName ? [byName] : [];
}

/**
 * A readable name: the carrier_name_string the carrier set, else the canonical
 * name without its country suffix (`tmobile_us` -> `tmobile`). Android ships no
 * brand names, so the cross-platform carrier name prefers iOS's (../identity.ts).
 */
export function androidDisplay(canonical: string, carrierNameString: string | undefined): string {
  if (carrierNameString) return carrierNameString;
  return suffixIso(canonical) ? canonical.replace(/_[a-z]{2}$/, "") : canonical;
}
