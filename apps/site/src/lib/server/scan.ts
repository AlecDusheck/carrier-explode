/** One setting across a scope of sources' heads, the settings few others share, and the wiki's live numbers: the index's SQL scans. */

import * as v from "valibot";
import {
	rareSettings,
	SCAN_HELD,
	scanSetting,
	type RareSetting,
	type ScanHeld,
	type ScannedSource,
} from "@carrier-explode/db";
import { RARITY, rarityFile } from "@carrier-explode/schema";
import { jsonSchema } from "@carrier-explode/schema/records";
import { canonical } from "@carrier-explode/values";
import type { Json, Platform, SourceKey, SourceKind } from "@carrier-explode/schema/types";
import type { ScanScope } from "#lib/ui-state.svelte.ts";
import type { Ver } from "#lib/types.ts";
import { cached } from "./cache";
import { resolve } from "./catalog";
import { db, indexVersion } from "./db";
import {
	chipEntries,
	chipOf,
	getCarriers,
	getCountryCarriers,
	getList,
	type ChipEntry,
	type ListEntry,
} from "./lists";

interface Match {
	/** The leaf as its file states it: `apns[0].apn`. */
	readonly path: string;
	readonly value: Json;
}

/** A source in scope as its chip shows it. */
type ScanSource = ChipEntry & Pick<ListEntry, "name">;

/** A source in scope, and every leaf it reads at the path: its head's, else the default.pb its newest phone reads it over. */
interface ScanHit {
	readonly source: ScanSource;
	/** Its head's version; null where the index has no entry for it. */
	readonly version: string | null;
	readonly held: ScanHeld;
	readonly matches: readonly Match[];
}

interface ScanBucket {
	readonly value: Json;
	readonly held: ScanHeld;
	/** Sources holding this value at any matched path. */
	readonly count: number;
	/** The first BUCKET_NAMES of them. */
	readonly sources: readonly ScanSource[];
}

export interface ScanResult {
	readonly path: string;
	readonly file: string;
	readonly scope: string;
	/** Sources in scope. */
	readonly scanned: number;
	/** Of those, how many set the key, and how many read it from their build's default.pb. */
	readonly set: number;
	readonly defaulted: number;
	readonly buckets: readonly ScanBucket[];
	readonly hits: readonly ScanHit[];
}

const BUCKET_NAMES = 60;

const leafValue = v.pipe(v.string(), v.parseJson(), jsonSchema);

/** The sources a scope covers on a platform, and the kind they are: carriers, one country's carriers, or country bundles. */
async function scopeSources(
	platform: Platform,
	scope: ScanScope,
): Promise<{ readonly kind: SourceKind; readonly sources: readonly ListEntry[] }> {
	if (scope === "countries") return { kind: "country", sources: await getList(platform, "country") };
	if (scope === "carriers") return { kind: "carrier", sources: await getCarriers(platform) };
	return { kind: "carrier", sources: await getCountryCarriers(platform, scope.slice("country:".length)) };
}

/** Every source in scope's leaves at `path` in `file`; `path` may use `[*]` for any index. Covers the whole scope: no limit. */
export async function scanKey(
	platform: Platform,
	path: string,
	file: string,
	scope: ScanScope,
): Promise<ScanResult> {
	const { kind, sources } = await scopeSources(platform, scope);
	return tally({ path, file, scope }, sources, await scanSetting(await db(), { platform, kind }, file, path));
}

const rank = (x: ScanHeld): number => SCAN_HELD.indexOf(x);

/** The scan per source in scope, each source carrying what its chip shows, and bucketed by value and where it comes from. */
export function tally(
	query: Pick<ScanResult, "path" | "file" | "scope">,
	sources: readonly ListEntry[],
	scanned: readonly ScannedSource[],
): ScanResult {
	const bySource = new Map(scanned.map((s) => [s.source, s]));
	const hits = sources.map((s): ScanHit => {
		const read = bySource.get(s.key);
		return {
			source: { ...chipOf(s), name: s.name },
			version: read?.version ?? null,
			held: read?.held ?? "absent",
			matches: (read?.leaves ?? []).map((l) => ({ path: l.key, value: v.parse(leafValue, l.value) })),
		};
	});

	const buckets = new Map<string, { value: Json; held: ScanHeld; count: number; sources: ScanSource[] }>();
	const add = (value: Json, from: ScanHeld, source: ScanSource): void => {
		const k = `${from}\0${canonical(value)}`;
		const b = buckets.get(k) ?? { value, held: from, count: 0, sources: [] };
		buckets.set(k, b);
		b.count++;
		if (b.sources.length < BUCKET_NAMES) b.sources.push(source);
	};
	for (const h of hits) {
		if (h.held === "absent") add(null, "absent", h.source);
		// A source counts once per distinct value it holds.
		for (const value of new Set(h.matches.map((m) => canonical(m.value))))
			add(v.parse(leafValue, value), h.held, h.source);
	}
	return {
		...query,
		scanned: hits.length,
		set: hits.filter((h) => h.held === "own").length,
		defaulted: hits.filter((h) => h.held === "default").length,
		buckets: [...buckets.values()].toSorted((a, b) => b.count - a.count || rank(a.held) - rank(b.held)),
		hits: hits.toSorted((a, b) => rank(a.held) - rank(b.held) || a.source.name.localeCompare(b.source.name)),
	};
}

export interface SettingSummary {
	readonly scanned: number;
	readonly set: number;
	readonly median: number | null;
	readonly min: { readonly value: number; readonly sources: readonly SourceKey[] } | null;
	readonly max: { readonly value: number; readonly sources: readonly SourceKey[] } | null;
}

/** One setting cut to what a wiki table shows: how many sources set it, the median of its numbers, and who holds the largest and smallest. */
export async function settingSummary(
	platform: Platform,
	path: string,
	file: string,
	scope: ScanScope,
): Promise<SettingSummary> {
	const r = await scanKey(platform, path, file, scope);
	const nums = r.hits
		.filter((h) => h.held === "own")
		.flatMap((h) =>
			h.matches.flatMap((m) =>
				typeof m.value === "number" ? [{ source: h.source.key, value: m.value }] : [],
			),
		)
		.toSorted((a, b) => a.value - b.value);
	const holders = (value: number | undefined): SettingSummary["min"] =>
		value === undefined
			? null
			: { value, sources: [...new Set(nums.filter((x) => x.value === value).map((x) => x.source))] };
	return {
		scanned: r.scanned,
		set: r.set,
		median: nums[Math.floor(nums.length / 2)]?.value ?? null,
		min: holders(nums[0]?.value),
		max: holders(nums.at(-1)?.value),
	};
}

/** A rare setting, the other sources holding it as their chips show them. */
export type RareRow = Omit<RareSetting, "with"> & { readonly with: readonly ChipEntry[] };

/** Rarity is judged among heads, so only a source's head version has it. */
export type Rare =
	| { readonly state: "judged"; readonly rows: readonly RareRow[] }
	| { readonly state: "notHead" };

/** A version's settings in its main file that at most a few other sources of its platform and kind share. */
export async function getRare(at: Ver): Promise<Rare> {
	const r = await resolve(at);
	if (r.entry.sha !== r.source.headSha) return { state: "notHead" };
	const { platform, kind } = r.ref;
	const rows = await cached(`rare:v1:${r.key}:${await indexVersion()}`, async () =>
		rareSettings(await db(), r.key, { platform, kind }, rarityFile(platform), RARITY),
	);
	const chips = new Map(
		(await chipEntries([...new Set(rows.flatMap((row) => row.with))])).map((c) => [c.key, c]),
	);
	return {
		state: "judged",
		// oxlint-disable-next-line oxc/no-map-spread -- the rows are the cache's; assigning to them would change it.
		rows: rows.map((row) => ({ ...row, with: row.with.flatMap((k) => chips.get(k) ?? []) })),
	};
}
