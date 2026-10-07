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
import type { EntryRef, ReleasePlatform, SourceKey } from "@carrier-explode/schema/types";
import { every, jsonOf, qualified, type IndexDb, type Page } from "./db.ts";
import { labelled } from "./labels.ts";
import { changes, copies, entries, modemConfigs, modems, releases, sources } from "./schema.ts";
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

const familySchema = v.object({
	code: v.string(),
	label: v.nullable(v.string()),
	devices: v.array(v.string()),
});

/** A modem family as pages name it: its code, schema's name for it, and the devices its modems serve. */
export interface ModemFamily {
	readonly code: string;
	readonly name: string;
	readonly devices: readonly string[];
}

const familyLabel = (family: SQLWrapper): SQL<string | null> => labelled("modem", "name", family);

/** The families a release's modems are, each once, in its devices' order (newest first) of the newest phone each serves. */
const releaseFamilies =
	sql<string>`(SELECT json_group_array(json_object('code', f.family, 'label', f.label, 'devices', json(f.devices))) FROM (
  SELECT m.family, ${familyLabel(sql`m.family`)} AS label, min(r.key) AS newest, json_group_array(DISTINCT j.value) AS devices
  FROM ${modems} m, json_each(m.devices) j LEFT JOIN json_each(${qualified(releases, releases.devices)}) r ON r.value = j.value
  WHERE m.platform = ${qualified(releases, releases.platform)} AND m.release = ${qualified(releases, releases.id)}
  GROUP BY m.family ORDER BY newest IS NULL, newest, m.family) f)`.mapWith((s: string) =>
		v.parse(jsonOf(v.array(familySchema)), s),
	);

/** A release as lists and build pages show it: its header and the modem families it ships. */
export type ListedRelease = IndexedRelease & { readonly modemFamilies: readonly ModemFamily[] };

const listing = (db: IndexDb) =>
	db.select({ release: releases, modemFamilies: releaseFamilies }).from(releases).$dynamic();

function listedOf({
	release,
	modemFamilies,
}: {
	release: ReleaseRow;
	modemFamilies: ReadonlyArray<v.InferOutput<typeof familySchema>>;
}): ListedRelease {
	return {
		...releaseOfRow(release),
		modemFamilies: modemFamilies.map((f) => ({
			code: f.code,
			name: modemFamilyName(release.platform, f.code, f.label),
			devices: f.devices,
		})),
	};
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
	const rows = await listing(db)
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
	return rows.map(listedOf);
}

export async function releaseOf(
	db: IndexDb,
	platform: ReleasePlatform,
	id: string,
): Promise<ListedRelease | undefined> {
	const row = await listing(db)
		.where(and(eq(releases.platform, platform), eq(releases.id, id)))
		.get();
	return row === undefined ? undefined : listedOf(row);
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

/** The configurations a device's modem carries in a release, by label: a Pixel or Galaxy modem page. */
export function modemConfigsOf(
	db: IndexDb,
	platform: ReleasePlatform,
	release: string,
	device: string,
): Promise<ModemConfigRow[]> {
	return db
		.select({ device: modemConfigs.device, label: modemConfigs.label, sha: modemConfigs.sha })
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
