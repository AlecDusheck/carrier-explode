/** Releases, the modems they ship and how they change their sources: written by a build's index step, read by build pages and the API. */

import { and, asc, desc, eq, gt, like, lt, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as v from "valibot";

import {
	compareReleases,
	modemFamilyName,
	type ReleaseChange,
	type ShippedCopy,
} from "@carrier-explode/schema";
import { sourceKeySchema } from "@carrier-explode/schema/records";
import {
	RELEASE_PLATFORMS,
	type EntryRef,
	type ReleasePlatform,
	type SourceKey,
} from "@carrier-explode/schema/types";
import { every, jsonOf, qualified, type IndexDb, type Page } from "./db.ts";
import { labelled } from "./labels.ts";
import {
	carriers,
	changes,
	copies,
	devices as phones,
	entries,
	modemConfigs,
	modems,
	releases,
	sources,
} from "./schema.ts";
import { syncScope } from "./sync.ts";

type ReleaseRow = typeof releases.$inferSelect;
type Header = Omit<ReleaseRow, "label" | "prerelease" | "patch">;

export type IndexedRelease =
	| (Header & { readonly platform: "ios"; readonly label: string; readonly prerelease: boolean })
	| (Header & { readonly platform: "android"; readonly patch: string })
	| (Header & { readonly platform: "samsung" });

export type ModemRow = Omit<typeof modems.$inferSelect, "platform" | "release">;
export type ModemConfigRow = Omit<typeof modemConfigs.$inferSelect, "platform" | "release">;

const rowOf = (r: IndexedRelease): ReleaseRow => ({ label: null, prerelease: null, patch: null, ...r });

function releaseOfRow(row: ReleaseRow): IndexedRelease {
	const { label, prerelease, patch, ...header } = row;
	if (header.platform === "ios" && label !== null && prerelease !== null)
		return { ...header, platform: "ios", label, prerelease };
	if (header.platform === "android" && patch !== null) return { ...header, platform: "android", patch };
	if (header.platform === "samsung") return { ...header, platform: "samsung" };
	throw new Error(`${row.platform} ${row.id}: its header does not fit its platform`);
}

/** A release, its modems and their configurations, as its unit's record states them. Returns whether anything changed. */
export async function putRelease(
	db: IndexDb,
	release: IndexedRelease,
	shipped: readonly ModemRow[],
	configs: readonly ModemConfigRow[],
): Promise<boolean> {
	const { platform, id } = release;
	const changed = await Promise.all([
		syncScope(db, releases, ["platform", "id"], every(eq(releases.platform, platform), eq(releases.id, id)), [
			rowOf(release),
		]),
		syncScope(
			db,
			modems,
			["platform", "release", "name", "devices"],
			every(eq(modems.platform, platform), eq(modems.release, id)),
			shipped.map((m) => ({ ...m, platform, release: id })),
		),
		syncScope(
			db,
			modemConfigs,
			["platform", "release", "device", "label"],
			every(eq(modemConfigs.platform, platform), eq(modemConfigs.release, id)),
			configs.map((c) => ({ ...c, platform, release: id })),
		),
	]);
	return changed.some((rows) => rows.length > 0);
}

/** A release's rows as the index holds them, which a Pixel's record adds its device to. */
export interface ReleaseRows {
	readonly release: IndexedRelease;
	readonly modems: readonly ModemRow[];
	readonly configs: readonly ModemConfigRow[];
}

export async function heldRelease(
	db: IndexDb,
	platform: ReleasePlatform,
	id: string,
): Promise<ReleaseRows | undefined> {
	const row = await db
		.select()
		.from(releases)
		.where(and(eq(releases.platform, platform), eq(releases.id, id)))
		.get();
	if (row === undefined) return undefined;
	const [shipped, configs] = await Promise.all([
		db
			.select({
				name: modems.name,
				family: modems.family,
				devices: modems.devices,
				package: modems.package,
				size: modems.size,
				kind: modems.kind,
			})
			.from(modems)
			.where(and(eq(modems.platform, platform), eq(modems.release, id)))
			.orderBy(asc(modems.name), asc(modems.devices)),
		db
			.select({ device: modemConfigs.device, label: modemConfigs.label, sha: modemConfigs.sha })
			.from(modemConfigs)
			.where(and(eq(modemConfigs.platform, platform), eq(modemConfigs.release, id)))
			.orderBy(asc(modemConfigs.device), asc(modemConfigs.label)),
	]);
	return { release: releaseOfRow(row), modems: shipped, configs };
}

/** How many sources a release ships, its every line counted. */
export async function shippedSourceCount(
	db: IndexDb,
	platform: ReleasePlatform,
	id: string,
): Promise<number> {
	const row = await db
		.select({ n: sql<number>`count(DISTINCT ${copies.source})` })
		.from(copies)
		.where(
			every(eq(copies.originKind, "release"), eq(copies.origin, id), like(copies.source, `${platform}:%`)),
		)
		.get();
	return row?.n ?? 0;
}

/** How many of `keys` each of a platform's releases ships; a release shipping none is left out. */
export async function releasesShipping(
	db: IndexDb,
	platform: ReleasePlatform,
	keys: readonly SourceKey[],
): Promise<Array<{ readonly release: string; readonly sources: number }>> {
	const rows =
		await db.all(sql`SELECT c.origin AS release, count(DISTINCT c.source) AS sources FROM ${copies} c
    WHERE c.origin_kind = 'release' AND c.origin IN (SELECT id FROM ${releases} WHERE platform = ${platform})
      AND c.source IN (SELECT value FROM json_each(${JSON.stringify(keys)}))
    GROUP BY c.origin`);
	return v.parse(v.array(v.object({ release: v.string(), sources: v.number() })), rows);
}

/** A modem family as pages name it: its code, schema's name for it, and the devices its modems serve. */
export interface ModemFamily {
	readonly code: string;
	readonly name: string;
	readonly devices: readonly string[];
}

const familyLabel = (family: SQLWrapper): SQL<string | null> => labelled("modem", "name", family);

/** A release as lists and build pages show it: its header and the modem families it ships. */
export type ListedRelease = IndexedRelease & { readonly modemFamilies: readonly ModemFamily[] };

const shippedModemsSchema = v.array(
	v.object({
		release: v.string(),
		family: v.string(),
		label: v.nullable(v.string()),
		devices: jsonOf(v.array(v.string())),
	}),
);

/** Each release with its modem families, each once, in its devices' order (newest first) of the newest phone each serves. */
async function withFamilies(
	db: IndexDb,
	platform: ReleasePlatform,
	rows: readonly ReleaseRow[],
): Promise<ListedRelease[]> {
	const shipped = v.parse(
		shippedModemsSchema,
		await db.all(sql`SELECT m.release, m.family, ${familyLabel(sql`m.family`)} AS label, m.devices FROM ${modems} m
      WHERE m.platform = ${platform} AND m.release IN (SELECT value FROM json_each(${JSON.stringify(rows.map((r) => r.id))}))
      ORDER BY m.release, m.name, m.devices`),
	);
	return rows.map((row) => {
		const families = new Map<string, { readonly label: string | null; readonly devices: Set<string> }>();
		for (const m of shipped.filter((s) => s.release === row.id)) {
			const family = families.get(m.family) ?? { label: m.label, devices: new Set<string>() };
			for (const d of m.devices) family.devices.add(d);
			families.set(m.family, family);
		}
		// A family none of whose devices the release lists sorts last.
		const newest = (devices: ReadonlySet<string>): number =>
			Math.min(...[...devices].map((d) => row.devices.indexOf(d)).filter((i) => i >= 0));
		return {
			...releaseOfRow(row),
			modemFamilies: [...families]
				.map(([code, f]) => ({ code, label: f.label, devices: [...f.devices], newest: newest(f.devices) }))
				.toSorted((a, b) => a.newest - b.newest || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
				.map((f) => ({
					code: f.code,
					name: modemFamilyName(row.platform, f.code, f.label),
					devices: f.devices,
				})),
		};
	});
}

/** What a release list narrows to; a null field narrows nothing. */
export interface ReleaseFilter {
	/** The OS version as the release states it: `27.2`, `16`. */
	readonly version: string | null;
	/** Releases that list the device. */
	readonly device: string | null;
}

export const EVERY_RELEASE: ReleaseFilter = { version: null, device: null };

/** A platform's releases, newest first, a page at a time by `sortKey`. */
export async function releaseList(
	db: IndexDb,
	platform: ReleasePlatform,
	page: Page<string>,
	filter: ReleaseFilter = EVERY_RELEASE,
): Promise<ListedRelease[]> {
	const rows = await db
		.select()
		.from(releases)
		.where(
			and(
				eq(releases.platform, platform),
				page.after === null ? undefined : lt(releases.sortKey, page.after),
				filter.version === null ? undefined : eq(releases.version, filter.version),
				filter.device === null
					? undefined
					: sql`EXISTS (SELECT 1 FROM json_each(${qualified(releases, releases.devices)}) j WHERE j.value = ${filter.device})`,
			),
		)
		.orderBy(desc(releases.sortKey))
		.limit(page.take);
	return withFamilies(db, platform, rows);
}

export async function releaseOf(
	db: IndexDb,
	platform: ReleasePlatform,
	id: string,
): Promise<ListedRelease | undefined> {
	const row = await db
		.select()
		.from(releases)
		.where(and(eq(releases.platform, platform), eq(releases.id, id)))
		.get();
	return row === undefined ? undefined : (await withFamilies(db, platform, [row]))[0];
}

/** The releases either side of `id` by version: the one its changes are against, and the one whose changes are against it. */
export async function neighbours(
	db: IndexDb,
	platform: ReleasePlatform,
	id: string,
): Promise<{ readonly previous: string | null; readonly next: string | null }> {
	const ordered = (
		await db
			.select({
				id: releases.id,
				version: releases.version,
				patch: releases.patch,
				released: releases.released,
			})
			.from(releases)
			.where(eq(releases.platform, platform))
	).toSorted(compareReleases);
	const at = ordered.findIndex((r) => r.id === id);
	if (at < 0) return { previous: null, next: null };
	return { previous: ordered[at - 1]?.id ?? null, next: ordered[at + 1]?.id ?? null };
}

/** A platform's releases, oldest first: what re-deriving the platform derives the changes of. */
export async function releaseIds(db: IndexDb, platform: ReleasePlatform): Promise<string[]> {
	const rows = await db
		.select({ id: releases.id })
		.from(releases)
		.where(eq(releases.platform, platform))
		.orderBy(asc(releases.sortKey));
	return rows.map((r) => r.id);
}

/** The devices a release lists that no newer release of its platform lists: those whose radio its settings decide. */
export async function newestReleaseDevices(
	db: IndexDb,
	platform: ReleasePlatform,
	id: string,
): Promise<string[]> {
	const rows = await db.all(sql`SELECT j.value AS device FROM ${releases} r, json_each(r.devices) j
    WHERE r.platform = ${platform} AND r.id = ${id} AND NOT EXISTS (SELECT 1 FROM ${releases} o, json_each(o.devices) k
      WHERE o.platform = r.platform AND o.sort_key > r.sort_key AND k.value = j.value)`);
	return v.parse(v.array(v.object({ device: v.string() })), rows).map((r) => r.device);
}

/** Each copy a release ships with its entry and version: the changes step's input, and the build→version lookup. */
export function shippedIn(
	db: IndexDb,
	platform: ReleasePlatform,
	release: string,
): Promise<Array<ShippedCopy & Pick<typeof entries.$inferSelect, "version">>> {
	return db
		.select({
			source: entries.source,
			line: entries.line,
			slug: entries.slug,
			sha: copies.sha,
			version: entries.version,
		})
		.from(copies)
		.innerJoin(sources, and(eq(sources.key, copies.source), eq(sources.platform, platform)))
		.innerJoin(
			entries,
			every(
				eq(entries.source, copies.source),
				eq(entries.line, copies.line),
				eq(entries.sha, copies.sha),
				eq(entries.version, copies.version),
			),
		)
		.where(every(eq(copies.originKind, "release"), eq(copies.origin, release)))
		.orderBy(asc(entries.source), asc(entries.line), asc(entries.slug));
}

/** A release's changes as the changes step derived them. Returns whether anything changed. */
export async function syncChanges(
	db: IndexDb,
	platform: ReleasePlatform,
	release: string,
	derived: readonly ReleaseChange[],
): Promise<boolean> {
	const written = await syncScope(
		db,
		changes,
		["platform", "release", "source"],
		every(eq(changes.platform, platform), eq(changes.release, release)),
		derived.map((c) => ({
			platform,
			release,
			source: c.source,
			kind: c.kind,
			fromLine: c.kind === "added" ? null : c.from.line,
			fromSlug: c.kind === "added" ? null : c.from.slug,
			toLine: c.kind === "removed" ? null : c.to.line,
			toSlug: c.kind === "removed" ? null : c.to.slug,
		})),
	);
	return written.length > 0;
}

/** An end as pages show it, with its version. */
export type ShownEnd = EntryRef & Pick<typeof entries.$inferSelect, "version">;

type Shown<C> = C extends ReleaseChange
	? { readonly [K in keyof C]: C[K] extends EntryRef ? ShownEnd : C[K] }
	: never;

/** A change as pages show it. */
export type ShownChange = Shown<ReleaseChange>;

/** A release's changes, by source, a page at a time; each end with its entry's version. `carrier`: only its sources'. */
export async function changesOf(
	db: IndexDb,
	platform: ReleasePlatform,
	release: string,
	page: Page<SourceKey>,
	carrier: string | null = null,
): Promise<ShownChange[]> {
	const from = alias(entries, "from_entry");
	const to = alias(entries, "to_entry");
	const rows = await db
		.select({ change: changes, fromVersion: from.version, toVersion: to.version })
		.from(changes)
		.leftJoin(
			from,
			and(eq(from.source, changes.source), eq(from.line, changes.fromLine), eq(from.slug, changes.fromSlug)),
		)
		.leftJoin(
			to,
			and(eq(to.source, changes.source), eq(to.line, changes.toLine), eq(to.slug, changes.toSlug)),
		)
		.where(
			and(
				eq(changes.platform, platform),
				eq(changes.release, release),
				page.after === null ? undefined : gt(changes.source, page.after),
				carrier === null
					? undefined
					: sql`${changes.source} IN (SELECT ${sources.key} FROM ${sources} WHERE ${sources.carrier} = ${carrier})`,
			),
		)
		.orderBy(asc(changes.source))
		.limit(page.take);
	return rows.map(({ change: c, fromVersion, toVersion }): ShownChange => {
		const end = (line: string | null, slug: string | null, version: string | null): ShownEnd => {
			if (line === null || slug === null || version === null)
				throw new Error(`${release}: ${c.source}'s ${c.kind} change names an entry the index lacks`);
			return { line, slug, version };
		};
		switch (c.kind) {
			case "added":
				return { source: c.source, kind: c.kind, to: end(c.toLine, c.toSlug, toVersion) };
			case "removed":
				return { source: c.source, kind: c.kind, from: end(c.fromLine, c.fromSlug, fromVersion) };
			case "changed":
				return {
					source: c.source,
					kind: c.kind,
					from: end(c.fromLine, c.fromSlug, fromVersion),
					to: end(c.toLine, c.toSlug, toVersion),
				};
		}
	});
}

/** Where a feed page starts: after this item, in the feed's order. `at` is a day, or a Pixel build's patch month. */
export const feedKeySchema = v.object({
	at: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}(?:-\d{2})?$/)),
	source: sourceKeySchema,
	line: v.pipe(v.string(), v.maxLength(64)),
	slug: v.pipe(v.string(), v.maxLength(64)),
});
export type FeedKey = v.InferOutput<typeof feedKeySchema>;

const feedSchema = v.array(
	v.pipe(
		v.object({
			platform: v.picklist(RELEASE_PLATFORMS),
			source: sourceKeySchema,
			line: v.string(),
			slug: v.string(),
			version: v.string(),
			prev: v.nullable(v.string()),
			kind: v.picklist(["day", "month"]),
			at: v.string(),
		}),
		v.transform((r) => ({
			key: { at: r.at, source: r.source, line: r.line, slug: r.slug },
			platform: r.platform,
			version: r.version,
			from: r.prev,
			shipped:
				r.kind === "day" ? { kind: "day" as const, day: r.at } : { kind: "month" as const, month: r.at },
		})),
	),
);

/** A version a carrier's source changed to, and the version before it; `from` is null for a new source. */
export type FeedItem = v.InferOutput<typeof feedSchema>[number];

/** When a version first shipped: a day, or, for a Pixel build, its only date, its security patch month. */
export type Shipped = FeedItem["shipped"];

/** What a feed narrows to: a country and a platform (null: every one with builds). */
export interface FeedFilter {
	readonly iso: string;
	readonly platform: ReleasePlatform | null;
}

/**
 * Carriers' new versions, newest first, a page at a time. A version its timeline dates (an image's release day, an OTA
 * bundle's publish day) is listed on that day, once per source and day, preferring a line it changed on, then the main
 * line, then the newest phone's; a phone's first line is not a new source. A Pixel version is listed by the build that
 * first changed to it, on the build's patch month.
 */
export async function changeFeed(db: IndexDb, filter: FeedFilter, page: Page<FeedKey>): Promise<FeedItem[]> {
	const platforms = filter.platform === null ? RELEASE_PLATFORMS : [filter.platform];
	const after = page.after;
	const rows = await db.all(sql`WITH scoped AS (
    SELECT s.key, s.platform FROM ${sources} s
    WHERE s.kind = 'carrier' AND s.platform IN (SELECT value FROM json_each(${JSON.stringify(platforms)}))
      AND s.carrier IN (SELECT id FROM ${carriers} WHERE iso = ${filter.iso})
  ), dated AS (
    SELECT s.platform, e.source, e.line, e.slug, e.version, p.version AS prev, e.day,
      row_number() OVER (PARTITION BY e.source, e.day
        ORDER BY p.version IS NOT NULL DESC, e.line = '' DESC, d.released DESC, e.line, e.rank) AS nth
    FROM scoped s CROSS JOIN ${entries} e
    LEFT JOIN ${entries} p ON p.source = e.source AND p.line = e.line AND p.rank = e.rank + 1
    LEFT JOIN ${phones} d ON d.code = e.line
    WHERE e.source = s.key AND e.changed = 1 AND e.day IS NOT NULL
      ${after === null ? sql`` : sql`AND e.day <= ${after.at}`}
  ), built AS (
    SELECT s.platform, ch.source, ch.to_line AS line, ch.to_slug AS slug, t.version, f.version AS prev, r.patch,
      row_number() OVER (PARTITION BY ch.source, ch.to_line, ch.to_slug ORDER BY r.sort_key) AS nth
    FROM scoped s CROSS JOIN ${releases} r CROSS JOIN ${changes} ch
    JOIN ${entries} t ON t.source = ch.source AND t.line = ch.to_line AND t.slug = ch.to_slug
    LEFT JOIN ${entries} f ON f.source = ch.source AND f.line = ch.from_line AND f.slug = ch.from_slug
    WHERE r.platform = s.platform AND r.patch IS NOT NULL AND ch.platform = r.platform AND ch.release = r.id
      AND ch.source = s.key AND ch.kind <> 'removed' AND t.day IS NULL
  ), feed AS (
    SELECT platform, source, line, slug, version, prev, 'day' AS kind, day AS at FROM dated x
    WHERE nth = 1 AND (prev IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM ${entries} o WHERE o.source = x.source AND o.day < x.day))
    UNION ALL
    SELECT platform, source, line, slug, version, prev, 'month', patch FROM built WHERE nth = 1
  )
  SELECT * FROM feed
  ${after === null ? sql`` : sql`WHERE at < ${after.at} OR (at = ${after.at} AND (source, line, slug) > (${after.source}, ${after.line}, ${after.slug}))`}
  ORDER BY at DESC, source, line, slug LIMIT ${page.take}`);
	return v.parse(feedSchema, rows);
}

/** A release's modems, in name order, each family named. */
export async function modemsOf(
	db: IndexDb,
	platform: ReleasePlatform,
	release: string,
): Promise<Array<ModemRow & { readonly familyName: string }>> {
	const rows = await db
		.select({
			name: modems.name,
			family: modems.family,
			devices: modems.devices,
			package: modems.package,
			size: modems.size,
			kind: modems.kind,
			label: familyLabel(modems.family),
		})
		.from(modems)
		.where(and(eq(modems.platform, platform), eq(modems.release, release)))
		.orderBy(asc(modems.name), asc(modems.devices));
	return rows.map(({ label, name, family, devices, package: sha, size, kind }) => ({
		name,
		family,
		devices,
		package: sha,
		size,
		kind,
		familyName: modemFamilyName(platform, family, label),
	}));
}

/** A configuration with a person's name for it, where its selection names no carrier to call it by. */
export type NamedModemConfig = ModemConfigRow & { readonly name: string | null };

/** The configurations a device's modem carries in a release, by label: a Pixel or Galaxy modem page. */
export function modemConfigsOf(
	db: IndexDb,
	platform: ReleasePlatform,
	release: string,
	device: string,
): Promise<NamedModemConfig[]> {
	return db
		.select({
			device: modemConfigs.device,
			label: modemConfigs.label,
			sha: modemConfigs.sha,
			name: labelled("modem", "name", modemConfigs.label),
		})
		.from(modemConfigs)
		.where(
			and(
				eq(modemConfigs.platform, platform),
				eq(modemConfigs.release, release),
				eq(modemConfigs.device, device),
			),
		)
		.orderBy(asc(modemConfigs.label));
}
