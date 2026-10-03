/** Which SIMs and countries an Android canonical carrier is for, from carrier_list.pb as CarrierResolver reads it. */

import type { CarrierId, CarrierList } from "#lib/decode/android/index.ts";
import { countryName } from "#lib/names.ts";
import { isoForMcc } from "../mcc.ts";
import { simMatcher } from "../sims.ts";
import { matcherKey, type SimMatcher } from "../types.ts";
import { stringSet } from "../values.ts";

const MVNO_FIELD = { spn: "spn", imsi: "imsiPrefix", gid1: "gid1" } as const satisfies Record<NonNullable<CarrierId["mvno"]>["kind"], keyof SimMatcher>;

function matcherOf(id: CarrierId): SimMatcher | undefined {
  if (id.mccMnc === undefined) return undefined;
  return simMatcher({ mccmnc: id.mccMnc, ...(id.mvno ? { [MVNO_FIELD[id.mvno.kind]]: id.mvno.value } : {}) });
}

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

/** The canonical name's suffix, else its SIMs' MCCs, else the MCC a rule-named canonical (`20404GID1=2801`) starts with. */
export function androidIso(canonical: string, sims: readonly SimMatcher[]): string[] {
  const named = suffixIso(canonical);
  if (named) return [named];
  const fromSims = stringSet(sims.flatMap((m) => isoForMcc(m.mccmnc) ?? []));
  if (fromSims.length) return fromSims;
  const digits = /^(\d{5,6})/.exec(canonical)?.[1];
  const byName = digits === undefined ? undefined : isoForMcc(digits);
  return byName ? [byName] : [];
}

/** carrier_name_string when set, else the canonical name without its country suffix. */
export function androidDisplay(canonical: string, carrierNameString: string | undefined): string {
  if (carrierNameString) return carrierNameString;
  return suffixIso(canonical) ? canonical.replace(/_[a-z]{2}$/, "") : canonical;
}
