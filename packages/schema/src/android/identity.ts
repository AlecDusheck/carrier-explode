/** The SIMs an Android canonical carrier is for, from carrier_list.pb as CarrierResolver reads it. */

import type { CarrierId, CarrierList } from "@carrier-explode/decode-android";
import { simMatcher, uniqueSims } from "../sims.ts";
import type { SimMatcher } from "../types.ts";

const MVNO_FIELD = { spn: "spn", imsi: "imsiPrefix", gid1: "gid1" } as const satisfies Record<NonNullable<CarrierId["mvno"]>["kind"], keyof SimMatcher>;

const matcherOf = (id: CarrierId): SimMatcher | undefined =>
  simMatcher({ mccmnc: id.mccMnc, ...(id.mvno === undefined ? {} : { [MVNO_FIELD[id.mvno.kind]]: id.mvno.value }) });

/** The SIM rules carrier_list gives `canonical`, in list order. */
export const listSims = (list: CarrierList, canonical: string): SimMatcher[] =>
  uniqueSims(list.entries.flatMap((e) => (e.canonicalName === canonical ? e.carrierIds.flatMap((id) => matcherOf(id) ?? []) : [])));
