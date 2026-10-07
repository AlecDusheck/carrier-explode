/**
 * Apple's carrier bundle manifest (the iTunes "version" plist): every carrier and country bundle Apple publishes over
 * the air, and the SIM tables that pick one.
 */

import { bytesToHex } from "@carrier-explode/binary";
import { isJsonDict, isPlistDict, parsePlist, type PlistDict, type PlistValue } from "./plist.ts";
import { compareVersions } from "./versions.ts";

export const MANIFEST_URL =
	"https://itunes.apple.com/WebObjects/MZStore.woa/wa/com.apple.jingle.appserver.client.MZITunesClientCheck/version";

export interface BundleRef {
	/** iOS version key this entry is published under, "legacy", or "<family> <n>" for a CarrierBundles entry. */
	os: string;
	build: string;
	url: string;
	/** SHA-1 of the file, hex. Absent where the entry only carries a long digest. */
	digest?: string;
	/** SHA-384, hex. Newer entries put it under Digest3; Watch and country entries put it under the plain Digest key, so it is routed by length. */
	digest3?: string;
	/** Present for ByProductType entries: "iPad", "iPod", or one model ("iPhone7,1"). */
	productType?: string;
	/** Present for CarrierBundles entries, which are keyed by device family. */
	family?: "iPhone" | "Watch";
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

/** `v` when it is a dictionary, else an empty one. */
const dict = (v: PlistValue | undefined): Dict => (isPlistDict(v) ? v : {});
/** The dictionary-valued entries of `d`. */
const dicts = (d: Dict): Array<[string, Dict]> =>
	Object.entries(d).flatMap(([k, v]) => (isPlistDict(v) ? [[k, v]] : []));
const text = (v: PlistValue | undefined): string => (v === undefined || v === null ? "" : String(v));

function refFromEntry(
	os: string,
	e: Dict,
	from: Pick<BundleRef, "productType" | "family"> = {},
): BundleRef | null {
	const url = e.BundleURL;
	if (typeof url !== "string") return null;
	const plain = e.Digest instanceof Uint8Array ? e.Digest : undefined;
	const long = e.Digest3 instanceof Uint8Array ? e.Digest3 : undefined;
	const digest3 = long ?? (plain?.length === 48 ? plain : undefined);
	return {
		os,
		build: typeof e.BuildVersion === "string" ? e.BuildVersion : text(e.BundleVersion),
		url,
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
	for (const [os, v] of dicts(dict(dict(root.MobileDeviceCarrierBundlesByProductVersion)[name]))) {
		if (os !== "ByProductType") {
			add(refFromEntry(os, v));
			continue;
		}
		for (const [pt, versions] of dicts(v))
			for (const [pos, pe] of dicts(versions)) add(refFromEntry(pos, pe, { productType: pt }));
	}
	const legacy = dict(root.MobileDeviceCarrierBundles)[name];
	if (isPlistDict(legacy)) add(refFromEntry("legacy", legacy));

	// Watch and newer-format carrier bundles: keyed by an opaque id, named by BundleID.
	const cb = dict(root.CarrierBundles);
	for (const family of ["Watch", "iPhone"] as const) {
		for (const [key, v] of dicts(dict(dict(cb[family]).Bundles))) {
			if (v.BundleID !== name) continue;
			const r = refFromEntry(`${family} ${key.split("_").pop() ?? key}`, v, { family });
			if (r) out.push({ ...r, build: text(v.BundleVersion) || r.build });
		}
	}
	return out;
}

/** Country bundles of one family, with the OS.Min of the BundleMappings slot that routes to each. */
function manifestCountries(fam: Dict, family: ManifestCountry["family"]): ManifestCountry[] {
	const minOsFor = new Map<string, string>();
	for (const [, slots] of dicts(dict(fam.BundleMappings))) {
		for (const [, slot] of dicts(slots)) {
			const target = text(slot.BundleMatchEntry);
			const os = slot.OS;
			if (target && isPlistDict(os) && typeof os.Min === "string") minOsFor.set(target, os.Min);
		}
	}
	return dicts(dict(fam.Bundles)).flatMap(([key, v]): ManifestCountry[] => {
		if (typeof v.BundleURL !== "string") return [];
		const minOS = minOsFor.get(key);
		return [
			{
				id: text(v.BundleID) || key,
				version: text(v.BundleVersion),
				url: v.BundleURL,
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
		dicts(dict(dict(dict(root.CarrierBundles).Watch).Bundles)).map(([, v]) => text(v.BundleID)),
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
	entries: MccMncEntry[];
	carrierIds: Array<[string, string]>;
	iccids: Array<[string, string]>;
}

function mvnoRule(m: Dict): MvnoRule {
	const pick = (k: "ICCID" | "GID1" | "GID2"): string | undefined =>
		typeof m[k] === "string" ? m[k] : undefined;
	const [iccid, gid1, gid2] = [pick("ICCID"), pick("GID1"), pick("GID2")];
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
		.flatMap(([k, v]): Array<[string, string]> => (typeof v === "string" ? [[k, v]] : []))
		.toSorted((a, b) => a[0].localeCompare(b[0]));

export function buildMccMnc(root: Dict): MccMncTable {
	// oxlint-disable-next-line oxc/no-map-spread -- the spreads only leave out absent optional fields; nothing is copied.
	const entries = Object.entries(dict(root.MobileDeviceCarriersByMccMnc)).map(([plmn, v]): MccMncEntry => {
		const e = dict(v);
		const mvnos = Array.isArray(e.MVNOs) ? e.MVNOs.filter(isPlistDict).map(mvnoRule) : [];
		return {
			plmn,
			mcc: plmn.slice(0, 3),
			mnc: plmn.slice(3),
			...(typeof e.BundleName === "string" ? { bundle: e.BundleName } : {}),
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

const record = (v: unknown): Readonly<Record<string, unknown>> => (isJsonDict(v) ? v : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** CarrierBundles.Watch: IMSI rules name a BundleMappings key, whose entries (one per minimum watchOS) name Bundles entries. */
export function buildWatchRoutes(root: Dict): WatchRoute[] {
	const watch = record(record(root.CarrierBundles).Watch);
	const bundles = record(watch.Bundles),
		mappings = record(watch.BundleMappings);
	const bundlesOf = (mapKey: unknown): string[] => {
		const key = str(mapKey);
		if (key === undefined) return [];
		return [
			...new Set(
				Object.values(record(mappings[key])).flatMap((e) => {
					const entry = str(record(e).BundleMatchEntry);
					return (entry === undefined ? undefined : str(record(bundles[entry]).BundleID)) ?? [];
				}),
			),
		];
	};
	return Object.entries(record(watch.IMSI)).flatMap(([plmn, v]) => {
		const rule = record(v);
		const mvnos = Array.isArray(rule.MVNOs) ? rule.MVNOs.map(record) : [];
		return bundlesOf(rule.BundleMapKey)
			.map((bundle): WatchRoute => ({ plmn, bundle }))
			.concat(
				mvnos.flatMap((m) => {
					const gid1 = str(m.GID1),
						gid2 = str(m.GID2),
						iccid = str(m.ICCID);
					const qualifiers = {
						...(gid1 !== undefined ? { gid1 } : {}),
						...(gid2 !== undefined ? { gid2 } : {}),
						...(iccid !== undefined ? { iccid } : {}),
					};
					// oxlint-disable-next-line oxc/no-map-spread -- each route has its own copy of the MVNO's qualifiers.
					return bundlesOf(m.BundleMapKey).map((bundle) => ({ plmn, bundle, ...qualifiers }));
				}),
			);
	});
}

export function parseManifest(bytes: Uint8Array): Dict {
	const v = parsePlist(bytes);
	if (!isPlistDict(v)) throw new Error("manifest is not a dictionary");
	return v;
}

/** Everything a reader takes off the manifest: the lists, each bundle's refs, and the PLMN table. */
export interface ManifestTables {
	index: ManifestIndex;
	refs: Record<string, BundleRef[]>;
	plmn: MccMncTable;
}

export function manifestTables(root: Dict): ManifestTables {
	const index = buildIndex(root);
	const refs: Record<string, BundleRef[]> = {};
	for (const name of [...index.carriers, ...index.watchCarriers]) refs[name] ??= carrierRefs(root, name);
	return { index, refs, plmn: buildMccMnc(root) };
}
