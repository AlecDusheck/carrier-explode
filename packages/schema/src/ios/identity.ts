/** Which SIMs and countries an Apple bundle serves: its SupportedSIMs, Apple's manifest routes, and its name. */

import { buildMccMnc, buildWatchRoutes, type PlistDict } from "@carrier-explode/decode-ios";
import { isoForMcc } from "../countries.ts";
import { simMatcher, uniqueRules } from "../sims.ts";
import {
	sourceKey,
	type ApplePlatform,
	type SimMatcher,
	type SimRule,
	type SourceKey,
	type SourceRef,
} from "../types.ts";
import { stringSet } from "../values.ts";
import { appleNameIso, isoForCountryId } from "./names.ts";

const QUALIFIERS: ReadonlyMap<string, "gid1" | "gid2" | "iccidPrefix"> = new Map([
	["GID1", "gid1"],
	["GID2", "gid2"],
	["ID", "iccidPrefix"],
]);

/** `310260`, `310260_GID1-54`, `20404_GID2-1A_ID-891480`: MCC+MNC, then qualifiers that must all match. */
export function parseSupportedSim(entry: string): SimMatcher | undefined {
	const [mccmnc = "", ...quals] = entry.trim().split("_");
	const fields: { gid1?: string; gid2?: string; iccidPrefix?: string } = {};
	for (const q of quals) {
		const [, kind = "", value] = /^([^-]+)-(.+)$/.exec(q) ?? [];
		const field = QUALIFIERS.get(kind.toUpperCase());
		if (field === undefined || value === undefined) return undefined;
		fields[field] = value;
	}
	return simMatcher({ mccmnc, ...fields });
}

export const supportedSims = (v: unknown): SimMatcher[] =>
	(Array.isArray(v) ? v : []).flatMap((e: unknown) =>
		typeof e === "string" ? (parseSupportedSim(e) ?? []) : [],
	);

/** A manifest route: SIMs matching `rule` load the bundle named `bundle`. */
interface Route {
	readonly bundle: string;
	readonly rule: SimRule | undefined;
}

const plmnRule = (sim: SimMatcher | undefined): SimRule | undefined =>
	sim === undefined ? undefined : { by: "plmn", sim };

/** MobileDeviceCarriersByMccMnc, and the ICCID and carrier-ID tables beside it: iPhones and iPads load their own file of the bundle each names. */
function phoneRoutes(root: PlistDict): Route[] {
	const table = buildMccMnc(root);
	return [
		...table.entries.flatMap((e) => [
			...(e.bundle === undefined
				? []
				: [{ bundle: e.bundle, rule: plmnRule(simMatcher({ mccmnc: e.plmn })) }]),
			...e.mvnos.map((v) => ({
				bundle: v.bundle,
				rule: plmnRule(simMatcher({ mccmnc: e.plmn, gid1: v.gid1, gid2: v.gid2, iccidPrefix: v.iccid })),
			})),
		]),
		...table.iccids.map(([prefix, bundle]): Route => ({ bundle, rule: { by: "iccid", prefix } })),
		...table.carrierIds.map(([id, bundle]): Route => ({ bundle, rule: { by: "carrierId", id } })),
	];
}

/** CarrierBundles.Watch routes, as decode-ios reads them. */
const watchRoutes = (root: PlistDict): Route[] =>
	buildWatchRoutes(root).map((r) => ({
		bundle: r.bundle,
		rule: plmnRule(simMatcher({ mccmnc: r.plmn, gid1: r.gid1, gid2: r.gid2, iccidPrefix: r.iccid })),
	}));

/** The SIM routes of Apple's manifest, per carrier source, one per ruleKey. */
export function manifestRoutes(root: PlistDict): Record<SourceKey<ApplePlatform>, SimRule[]> {
	const routes = new Map<SourceKey<ApplePlatform>, SimRule[]>();
	const add = (platforms: readonly ApplePlatform[], list: readonly Route[]): void => {
		for (const { bundle, rule } of list) {
			if (bundle === "" || rule === undefined) continue;
			for (const platform of platforms) {
				const key = sourceKey({ platform, kind: "carrier", name: bundle });
				routes.set(key, [...(routes.get(key) ?? []), rule]);
			}
		}
	};
	add(["ios", "ipados"], phoneRoutes(root));
	add(["watchos"], watchRoutes(root));
	return Object.fromEntries([...routes].map(([key, rules]) => [key, uniqueRules(rules)]));
}

/** Best evidence first: ISOAlpha2CountryCode, the bundle name, HomeBundleIdentifier, SupportedCountryIds, the SIMs' MCCs. */
export function iosIso(
	source: SourceRef,
	plist: Readonly<Record<string, unknown>>,
	sims: readonly SimMatcher[],
): string[] {
	const listed = (
		Array.isArray(plist.ISOAlpha2CountryCode) ? plist.ISOAlpha2CountryCode : [plist.ISOAlpha2CountryCode]
	).flatMap((x: unknown) => (typeof x === "string" && /^[a-z]{2}$/i.test(x) ? [x.toLowerCase()] : []));
	if (listed.length > 0) return stringSet(listed);
	const named = appleNameIso(source);
	if (named !== undefined) return [named];
	const home = plist.HomeBundleIdentifier;
	const homeIso = typeof home === "string" ? isoForCountryId(home) : undefined;
	if (homeIso !== undefined) return [homeIso];
	const ids = Array.isArray(plist.SupportedCountryIds) ? plist.SupportedCountryIds : [];
	const byId = stringSet(
		ids.flatMap((x: unknown) => (typeof x === "string" ? (isoForCountryId(x) ?? []) : [])),
	);
	if (byId.length > 0) return byId;
	return stringSet(sims.flatMap((m) => isoForMcc(m.mccmnc) ?? []));
}
