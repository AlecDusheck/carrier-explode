/**
 * Apple's carrier bundle manifest (the iTunes "version" plist): every carrier and country bundle Apple publishes over
 * the air, and the SIM tables that pick one.
 */

import * as v from "valibot";

import { bytesToHex } from "@carrier-explode/binary";
import { isRecord } from "@carrier-explode/values";
import { isJsonDict, isPlistDict, parsePlist, type PlistDict, type PlistValue } from "./plist.ts";
import { compareVersions } from "./versions.ts";

export const MANIFEST_URL =
	"https://itunes.apple.com/WebObjects/MZStore.woa/wa/com.apple.jingle.appserver.client.MZITunesClientCheck/version";

export interface BundleRef {
	/** iOS version key this entry is published under, "legacy", or "<family> <n>" for a CarrierBundles entry. */
	readonly os: string;
	readonly build: string;
	readonly url: string;
	/** SHA-1 of the file, hex. Absent where the entry only carries a long digest. */
	readonly digest?: string;
	/** SHA-384, hex. Newer entries put it under Digest3; Watch and country entries put it under the plain Digest key, so it is routed by length. */
	readonly digest3?: string;
	/** Present for ByProductType entries: "iPad", "iPod", or one model ("iPhone7,1"). */
	readonly productType?: string;
	/** Present for CarrierBundles entries, which are keyed by device family. */
	readonly family?: "iPhone" | "Watch";
}

interface ManifestCountry {
	readonly id: string;
	readonly version: string;
	readonly url: string;
	readonly minOS?: string;
	readonly family: "iPhone" | "Watch";
}

/** The root tables the site counts. */
const COUNTED_TABLES = [
	"MobileDeviceCarrierBundlesByProductVersion",
	"MobileDeviceCarrierBundles",
	"MobileDeviceCarriersByMccMnc",
	"MobileDeviceCarriers",
	"MobileDeviceCarriersByCarrierID",
] as const;

export interface ManifestIndex {
	/** Entries per counted root table. */
	readonly counts: Readonly<Record<string, number>>;
	/** Names under ByProductVersion or the legacy table. */
	readonly carriers: readonly string[];
	/** BundleIDs under CarrierBundles.Watch. */
	readonly watchCarriers: readonly string[];
	readonly countries: readonly ManifestCountry[];
}

type Dict = PlistDict;

/** `x` when it is a dictionary, else an empty one. */
const dict = (x: PlistValue | undefined): Dict => (isPlistDict(x) ? x : {});
/** The dictionary-valued entries of `d`. */
const dicts = (d: Dict): Array<[string, Dict]> =>
	Object.entries(d).flatMap(([k, x]) => (isPlistDict(x) ? [[k, x]] : []));
const text = (x: unknown): string => (x === undefined || x === null ? "" : String(x));

/** A field the manifest gives another type counts as absent, as one it leaves out. */
const maybe = <S extends v.GenericSchema>(
	s: S,
): v.SchemaWithFallback<v.OptionalSchema<S, undefined>, undefined> => v.fallback(v.optional(s), undefined);

const entrySchema = v.looseObject({
	BundleURL: v.string(),
	BuildVersion: maybe(v.string()),
	Digest: maybe(v.instance(Uint8Array)),
	Digest3: maybe(v.instance(Uint8Array)),
});

function refFromEntry(
	os: string,
	entry: Dict,
	from: Pick<BundleRef, "productType" | "family"> = {},
): BundleRef | null {
	const parsed = v.safeParse(entrySchema, entry);
	if (!parsed.success) return null;
	const e = parsed.output;
	const plain = e.Digest;
	const digest3 = e.Digest3 ?? (plain?.length === 48 ? plain : undefined);
	return {
		os,
		build: e.BuildVersion ?? text(e.BundleVersion),
		url: e.BundleURL,
		...(plain?.length === 20 ? { digest: bytesToHex(plain) } : {}),
		...(digest3 ? { digest3: bytesToHex(digest3) } : {}),
		...from,
	};
}

/**
 * YYYY-MM-DD from `/20261001/`, `/031-04427-20150119-…/` or `/031-2099.20131204.rVQEN/`; YYYY alone from the 2020-2022
 * `/2020/` scheme or a malformed date (`/202206043/`), which sorts after every full date of its year.
 */
export function publishedOn(url: string): string | undefined {
	for (const [, y, m, d] of url.matchAll(/(?<=[/.-])(20\d\d)(\d\d)(\d\d)(?=[/.-])/g)) {
		if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) return `${y}-${m}-${d}`;
	}
	return url.match(/\/(20\d\d)\d*\//)?.[1];
}

/** All published refs for one carrier name, in manifest order: every reader orders listings itself. */
export function carrierRefs(root: Dict, name: string): BundleRef[] {
	const out: BundleRef[] = [];
	const add = (r: BundleRef | null): void => {
		if (r) out.push(r);
	};
	for (const [os, entry] of dicts(dict(dict(root.MobileDeviceCarrierBundlesByProductVersion)[name]))) {
		if (os !== "ByProductType") {
			add(refFromEntry(os, entry));
			continue;
		}
		for (const [pt, versions] of dicts(entry))
			for (const [pos, pe] of dicts(versions)) add(refFromEntry(pos, pe, { productType: pt }));
	}
	const legacy = dict(root.MobileDeviceCarrierBundles)[name];
	if (isPlistDict(legacy)) add(refFromEntry("legacy", legacy));

	// Watch and newer-format carrier bundles: keyed by an opaque id, named by BundleID.
	const cb = dict(root.CarrierBundles);
	for (const family of ["Watch", "iPhone"] as const) {
		for (const [key, entry] of dicts(dict(dict(cb[family]).Bundles))) {
			if (entry.BundleID !== name) continue;
			const r = refFromEntry(`${family} ${key.split("_").pop() ?? key}`, entry, { family });
			if (r) out.push({ ...r, build: text(entry.BundleVersion) || r.build });
		}
	}
	return out;
}

const slotOsSchema = v.looseObject({ Min: v.string() });

/** Country bundles of one family, with the OS.Min of the BundleMappings slot that routes to each. */
function manifestCountries(fam: Dict, family: ManifestCountry["family"]): ManifestCountry[] {
	const minOsFor = new Map<string, string>();
	for (const [, slots] of dicts(dict(fam.BundleMappings))) {
		for (const [, slot] of dicts(slots)) {
			const target = text(slot.BundleMatchEntry);
			const os = v.safeParse(slotOsSchema, slot.OS);
			if (target && os.success) minOsFor.set(target, os.output.Min);
		}
	}
	return dicts(dict(fam.Bundles)).flatMap(([key, entry]): ManifestCountry[] => {
		if (!v.is(entrySchema, entry)) return [];
		const minOS = minOsFor.get(key);
		return [
			{
				id: text(entry.BundleID) || key,
				version: text(entry.BundleVersion),
				url: entry.BundleURL,
				...(minOS ? { minOS } : {}),
				family,
			},
		];
	});
}

const byName = (a: string, b: string): number => a.localeCompare(b);

export function buildIndex(root: Dict): ManifestIndex {
	const carriers = new Set(
		[
			...dicts(dict(root.MobileDeviceCarrierBundlesByProductVersion)),
			...dicts(dict(root.MobileDeviceCarrierBundles)),
		].map(([k]) => k),
	);
	const watchCarriers = new Set(
		dicts(dict(dict(dict(root.CarrierBundles).Watch).Bundles)).map(([, entry]) => text(entry.BundleID)),
	);
	const countryBundles = dict(root.CountryBundles);
	const countries = [
		...manifestCountries(dict(countryBundles.iPhone), "iPhone"),
		...manifestCountries(dict(countryBundles.Watch), "Watch"),
	].toSorted((a, b) => byName(a.id, b.id) || compareVersions(a.version, b.version));
	return {
		counts: Object.fromEntries(COUNTED_TABLES.map((k) => [k, Object.keys(dict(root[k])).length])),
		carriers: [...carriers].toSorted(byName),
		watchCarriers: [...watchCarriers].toSorted(byName),
		countries,
	};
}

interface MvnoRule {
	bundle: string;
	iccid?: string;
	gid1?: string;
	gid2?: string;
}

interface MccMncEntry {
	plmn: string;
	mcc: string;
	mnc: string;
	bundle?: string;
	mvnos: MvnoRule[];
}

export interface MccMncTable {
	readonly entries: MccMncEntry[];
	readonly carrierIds: Array<[string, string]>;
	readonly iccids: Array<[string, string]>;
}

/** An MVNO's qualifiers, each a string or absent. */
const qualifiersSchema = v.looseObject({
	ICCID: maybe(v.string()),
	GID1: maybe(v.string()),
	GID2: maybe(v.string()),
});

const carrierSchema = v.looseObject({
	BundleName: maybe(v.string()),
	MVNOs: v.fallback(v.array(v.unknown()), []),
});

function mvnoRule(m: Readonly<Record<string, unknown>>): MvnoRule {
	const { ICCID: iccid, GID1: gid1, GID2: gid2 } = v.parse(qualifiersSchema, m);
	return {
		bundle: text(m.BundleName),
		...(iccid ? { iccid } : {}),
		...(gid1 ? { gid1 } : {}),
		...(gid2 ? { gid2 } : {}),
	};
}

/** String-valued entries of a table, sorted by key. */
const stringPairs = (d: Dict): Array<[string, string]> =>
	Object.entries(d)
		.flatMap(([k, x]): Array<[string, string]> => (typeof x === "string" ? [[k, x]] : []))
		.toSorted((a, b) => a[0].localeCompare(b[0]));

export function buildMccMnc(root: Dict): MccMncTable {
	// oxlint-disable-next-line oxc/no-map-spread -- the spreads only leave out absent optional fields; nothing is copied.
	const entries = Object.entries(dict(root.MobileDeviceCarriersByMccMnc)).map(([plmn, x]): MccMncEntry => {
		const e = dict(x);
		const { BundleName, MVNOs } = v.parse(carrierSchema, e);
		const mvnos = MVNOs.filter(isRecord).map(mvnoRule);
		return {
			plmn,
			mcc: plmn.slice(0, 3),
			mnc: plmn.slice(3),
			...(BundleName === undefined ? {} : { bundle: BundleName }),
			mvnos,
		};
	});
	entries.sort((a, b) => a.plmn.localeCompare(b.plmn));
	// MobileDeviceCarriers is keyed by ICCID prefix (890100, 8901150, ...), not by
	// PLMN, so it is a separate lookup rather than extra rows in the PLMN table.
	return {
		entries,
		carrierIds: stringPairs(dict(root.MobileDeviceCarriersByCarrierID)),
		iccids: stringPairs(dict(root.MobileDeviceCarriers)),
	};
}

/** A Watch SIM route: SIMs of `plmn` (and the MVNO's qualifiers, when given) load the bundle `bundle`. */
export interface WatchRoute {
	readonly plmn: string;
	readonly bundle: string;
	readonly gid1?: string;
	readonly gid2?: string;
	readonly iccid?: string;
}

const record = (x: unknown): Readonly<Record<string, unknown>> => (isJsonDict(x) ? x : {});

const watchRuleSchema = v.looseObject({
	BundleMapKey: maybe(v.string()),
	MVNOs: v.fallback(v.array(v.unknown()), []),
});
const watchMvnoSchema = v.looseObject({ ...qualifiersSchema.entries, BundleMapKey: maybe(v.string()) });
const mappingSchema = v.looseObject({ BundleMatchEntry: maybe(v.string()) });
const bundleIdSchema = v.looseObject({ BundleID: maybe(v.string()) });

/** CarrierBundles.Watch: IMSI rules name a BundleMappings key, whose entries (one per minimum watchOS) name Bundles entries. */
export function buildWatchRoutes(root: Dict): WatchRoute[] {
	const watch = record(record(root.CarrierBundles).Watch);
	const bundles = record(watch.Bundles),
		mappings = record(watch.BundleMappings);
	const bundlesOf = (key: string | undefined): string[] => {
		if (key === undefined) return [];
		return [
			...new Set(
				Object.values(record(mappings[key])).flatMap((e) => {
					const entry = v.parse(mappingSchema, record(e)).BundleMatchEntry;
					return (
						(entry === undefined ? undefined : v.parse(bundleIdSchema, record(bundles[entry])).BundleID) ?? []
					);
				}),
			),
		];
	};
	return Object.entries(record(watch.IMSI)).flatMap(([plmn, x]) => {
		const rule = v.parse(watchRuleSchema, record(x));
		const mvnos = rule.MVNOs.map((m) => v.parse(watchMvnoSchema, record(m)));
		return bundlesOf(rule.BundleMapKey)
			.map((bundle): WatchRoute => ({ plmn, bundle }))
			.concat(
				mvnos.flatMap((m) => {
					const qualifiers = {
						...(m.GID1 !== undefined ? { gid1: m.GID1 } : {}),
						...(m.GID2 !== undefined ? { gid2: m.GID2 } : {}),
						...(m.ICCID !== undefined ? { iccid: m.ICCID } : {}),
					};
					// oxlint-disable-next-line oxc/no-map-spread -- each route has its own copy of the MVNO's qualifiers.
					return bundlesOf(m.BundleMapKey).map((bundle) => ({ plmn, bundle, ...qualifiers }));
				}),
			);
	});
}

export function parseManifest(bytes: Uint8Array): Dict {
	const root = parsePlist(bytes);
	if (!isPlistDict(root)) throw new Error("manifest is not a dictionary");
	return root;
}

/** Everything a reader takes off the manifest: the lists, each bundle's refs, and the PLMN table. */
export interface ManifestTables {
	readonly index: ManifestIndex;
	readonly refs: Record<string, BundleRef[]>;
	readonly plmn: MccMncTable;
}

export function manifestTables(root: Dict): ManifestTables {
	const index = buildIndex(root);
	const refs: Record<string, BundleRef[]> = {};
	for (const name of [...index.carriers, ...index.watchCarriers]) refs[name] ??= carrierRefs(root, name);
	return { index, refs, plmn: buildMccMnc(root) };
}
