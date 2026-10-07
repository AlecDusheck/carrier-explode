/** Apple's OTA manifest as file records, pure: the entries it lists per URL, the scope's share of them, and a record's listings brought up to date. */

import { sha1Hex } from "@carrier-explode/binary";
import {
	compareVersions,
	isPrerelease,
	type BundleRef,
	type ManifestTables,
} from "@carrier-explode/decode-ios";
import {
	APPLE_PLATFORMS,
	parseSourceKey,
	sourceKey,
	type ApplePlatform,
	type Digests,
	type OtaListing,
} from "@carrier-explode/schema/types";
import type { Scope } from "../scope.ts";

export interface Entry {
	readonly url: string;
	readonly version: string;
	readonly digests: Digests;
	readonly listing: Listed;
}

/** What the manifest says of a listing; the record adds when it was seen. */
type Listed = Pick<OtaListing, "source" | "os" | "model">;

/** ByProductType "iPad" entries are ipados and CarrierBundles.Watch entries watchos; the rest, single iPhone models included, ios. */
function platformOf(r: BundleRef): ApplePlatform {
	if (r.productType?.startsWith("iPad")) return "ipados";
	if (r.family === "Watch") return "watchos";
	return "ios";
}

const digestsOf = (r: BundleRef): Digests => ({
	...(r.digest === undefined ? {} : { sha1: r.digest }),
	...(r.digest3 === undefined ? {} : { sha384: r.digest3 }),
});

/** Every carrier and country bundle entry the manifest lists. */
export function manifestEntries(tables: ManifestTables): Entry[] {
	const carriers = Object.entries(tables.refs).flatMap(([name, refs]) =>
		refs.map((r): Entry => {
			const model = r.productType?.includes(",") ? r.productType : undefined;
			return {
				url: r.url,
				version: r.build,
				digests: digestsOf(r),
				listing: {
					source: sourceKey({ platform: platformOf(r), kind: "carrier", name }),
					os: r.os,
					...(model === undefined ? {} : { model }),
				},
			};
		}),
	);
	const countries = tables.index.countries.map((c): Entry => ({
		url: c.url,
		version: c.version,
		digests: {},
		listing: {
			source: sourceKey({ platform: c.family === "Watch" ? "watchos" : "ios", kind: "country", name: c.id }),
			os: c.minOS ?? null,
		},
	}));
	return [...carriers, ...countries];
}

/** `27.0` -> 27; undefined for `legacy`, `Watch 4` or none. */
const majorOf = (os: string | null): number | undefined => {
	const m = os === null ? null : /^(\d+)(?:\.|$)/.exec(os);
	return m?.[1] === undefined ? undefined : Number(m[1]);
};

/** The version an OS key states (`27.0.1`, and a CarrierBundles generation's number: `Watch 4` -> `4`); undefined for `legacy`, a prerelease or none. */
function osVersion(os: string | null): string | undefined {
	if (os === null || isPrerelease(os)) return undefined;
	return /\d+(?:\.\d+)*/.exec(os)?.[0];
}

/** Each source's entries under the newest OS it is listed for: the files a device on the newest OS is served. */
function currentFiles(entries: readonly Entry[]): Entry[] {
	return [
		...Map.groupBy(
			entries.filter((e) => osVersion(e.listing.os) !== undefined),
			(e) => e.listing.source,
		).values(),
	].flatMap((ofSource) => {
		const newest = ofSource
			.map((e) => osVersion(e.listing.os) ?? "")
			.toSorted(compareVersions)
			.at(-1);
		return ofSource.filter((e) => osVersion(e.listing.os) === newest);
	});
}

/** The iPhone entries for `phones` on the newest `majors` majors the manifest lists. */
function onPhones(
	take: { readonly majors: number; readonly phones: readonly string[] },
	entries: readonly Entry[],
): Entry[] {
	const phones = new Set(take.phones);
	const ios = entries.filter((e) => e.listing.model === undefined || phones.has(e.listing.model));
	const majors = new Set(
		[...new Set(ios.flatMap((e) => majorOf(e.listing.os) ?? []))]
			.toSorted((a, b) => b - a)
			.slice(0, take.majors),
	);
	return ios.filter((e) => majors.has(majorOf(e.listing.os) ?? 0));
}

function taken(take: Scope["appleOta"][ApplePlatform], entries: readonly Entry[]): Entry[] {
	if (take === "all") return [...entries];
	if (take === "none") return [];
	if (take === "current") return currentFiles(entries);
	return onPhones(take, entries);
}

/** The entries the scope fetches, each platform's by its own rule, in manifest order. */
export function scopedEntries(scope: Scope, entries: readonly Entry[]): Entry[] {
	const kept = new Set(
		APPLE_PLATFORMS.flatMap((p) =>
			taken(
				scope.appleOta[p],
				entries.filter((e) => parseSourceKey(e.listing.source)?.platform === p),
			),
		),
	);
	return entries.filter((e) => kept.has(e));
}

/** Both digests Apple states for a URL; listings that omit one are filled by those that give it. */
export function mergeDigests(url: string, ...all: readonly Digests[]): Digests {
	const out: { sha1?: string; sha384?: string } = {};
	for (const d of all) {
		for (const alg of ["sha1", "sha384"] as const) {
			const given = d[alg];
			if (given === undefined) continue;
			if (out[alg] !== undefined && out[alg] !== given)
				throw new Error(`${url}: the manifest gives two ${alg} digests`);
			out[alg] = given;
		}
	}
	return out;
}

const listingId = (l: Listed): string => JSON.stringify([l.source, l.os, l.model ?? null]);

/** What a record's live listings are, as its `listed` metadata keeps it: planning compares it with the manifest's without reading the record. */
export const listedDigest = (live: readonly Listed[]): string =>
	sha1Hex(new TextEncoder().encode(JSON.stringify([...new Set(live.map(listingId))].toSorted())));

/** A record's listings with the manifest's: each kept, live when still listed; each new one first seen `now`. */
export function updateListings(
	previous: readonly OtaListing[],
	current: readonly Listed[],
	now: string,
): OtaListing[] {
	const listed = new Map(current.map((l) => [listingId(l), l]));
	const out: OtaListing[] = [];
	for (const l of previous) {
		const live = listed.delete(listingId(l));
		out.push(live ? { ...l, lastSeenAt: now, live } : { ...l, live });
	}
	for (const l of listed.values()) out.push({ ...l, firstSeenAt: now, lastSeenAt: now, live: true });
	return out;
}
