/** The SIM rules a Pixel's carrier_list.pb routes to each carrier source, as CarrierResolver reads it. */

import type { CarrierId, CarrierList } from "@carrier-explode/decode-android";
import { simMatcher, uniqueRules } from "../sims.ts";
import { sourceKey, type SimMatcher, type SimRule, type SourceKey } from "../types.ts";

const MVNO_FIELD = {
	spn: "spn",
	imsi: "imsiPrefix",
	gid1: "gid1",
	iccid: "iccidPrefix",
} as const satisfies Record<NonNullable<CarrierId["mvno"]>["kind"], keyof SimMatcher>;

const matcherOf = (id: CarrierId): SimMatcher | undefined =>
	simMatcher({
		mccmnc: id.mccMnc,
		...(id.mvno === undefined ? {} : { [MVNO_FIELD[id.mvno.kind]]: id.mvno.value }),
	});

/** The SIM routes of a carrier list, per carrier source, one per ruleKey in list order. Every carrier ID is a PLMN rule. */
export function carrierListRoutes(list: CarrierList): Record<SourceKey<"android">, SimRule[]> {
	const routes = new Map<SourceKey<"android">, SimRule[]>();
	for (const e of list.entries) {
		const key = sourceKey({ platform: "android", kind: "carrier", name: e.canonicalName });
		const rules = e.carrierIds.flatMap((id): SimRule[] => {
			const sim = matcherOf(id);
			return sim === undefined ? [] : [{ by: "plmn", sim }];
		});
		routes.set(key, [...(routes.get(key) ?? []), ...rules]);
	}
	return Object.fromEntries([...routes].map(([key, rules]) => [key, uniqueRules(rules)]));
}
