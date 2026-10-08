/** OS releases as the index has them: a build's header, its neighbours, and what it changed for each source. */

import { error } from "@sveltejs/kit";
import {
	changesOf,
	neighbours,
	releasesShipping,
	releaseOf,
	shippedIn,
	type ListedRelease,
	type Page,
	type ShownChange,
	type ShownEnd,
} from "@carrier-explode/db";
import { sourceOf, versionPath, type ReleasePlatform, type SourceKey } from "@carrier-explode/schema/types";
import type { Picture } from "#lib/types.ts";
import { cached, perRequest } from "./cache";
import { db, everyPage, indexVersion } from "./db";
import { releasesOf } from "./catalog";
import { getCarriers, listEntries } from "./lists";

const releaseRow = perRequest(async (platform: ReleasePlatform, id: string) =>
	releaseOf(await db(), platform, id),
);

/** A build the index has: a missing one is its page's 404. */
export async function mustRelease(platform: ReleasePlatform, id: string): Promise<ListedRelease> {
	const r = await releaseRow(platform, id);
	if (!r) error(404, `No ${platform} release ${id}.`);
	return r;
}

/** Whether the index holds a build of `platform` before `id`: the oldest one has no changes to list. */
export const hasPrevious = async (platform: ReleasePlatform, id: string): Promise<boolean> =>
	(await neighbours(await db(), platform, id)).previous !== null;

/** A build's name, or null when the index lacks it. */
export const releaseNamed = async (platform: ReleasePlatform, id: string): Promise<ListedRelease | null> =>
	(await releaseRow(platform, id)) ?? null;

/** A source's version in one release, linked to that version's page. */
export interface ReleasedVersion {
	readonly version: string;
	readonly path: string;
}

export interface SourceChange {
	readonly source: SourceKey;
	/** What people call its carrier, and its picture; null for a source no list shows yet. */
	readonly brand: string | null;
	readonly picture: Picture | null;
	readonly from: ReleasedVersion | null;
	readonly to: ReleasedVersion | null;
}

export interface ReleaseView {
	readonly release: ListedRelease;
	readonly previous: ListedRelease | null;
	readonly added: readonly SourceChange[];
	readonly removed: readonly SourceChange[];
	readonly changed: readonly SourceChange[];
}

const shipped = perRequest(async (platform: ReleasePlatform, build: string) =>
	shippedIn(await db(), platform, build),
);

/** The version of a source on one line that a build shipped; null when it shipped none. */
export async function shippedVersion(
	platform: ReleasePlatform,
	build: string,
	key: SourceKey,
	line: string,
): Promise<ReleasedVersion | null> {
	const copy = (await shipped(platform, build)).find((c) => c.source === key && c.line === line);
	return copy === undefined ? null : { version: copy.version, path: versionPath(sourceOf(key), copy) };
}

/** How many of each of a platform's builds' sources its carrier list lists, by build. */
export const carriersShipped = async (platform: ReleasePlatform): Promise<Array<readonly [string, number]>> =>
	cached(`carriers-shipped:v1:${platform}:${await indexVersion()}`, async () => {
		const [builds, carriers] = await Promise.all([releasesOf(platform), getCarriers(platform)]);
		const counts = new Map(
			(
				await releasesShipping(
					await db(),
					platform,
					carriers.map((c) => c.key),
				)
			).map((r) => [r.release, r.sources]),
		);
		return builds.map((b) => [b.id, counts.get(b.id) ?? 0] as const);
	});

/** A source a build ships, at its version there. */
export interface ShippedSource {
	readonly source: SourceKey;
	readonly line: string;
	/** What people call its carrier; null for a source no list shows yet. */
	readonly brand: string | null;
	readonly picture: Picture | null;
	readonly at: ReleasedVersion;
}

/** Every source a build ships, by its carrier's name. */
export async function getShipped(platform: ReleasePlatform, build: string): Promise<ShippedSource[]> {
	const copies = await shipped(platform, build);
	const listed = await listEntries([...new Set(copies.map((c) => c.source))]);
	return copies
		.map((c): ShippedSource => {
			const entry = listed.get(c.source);
			return {
				source: c.source,
				line: c.line,
				brand: entry?.brand ?? null,
				picture: entry?.picture ?? null,
				at: { version: c.version, path: versionPath(sourceOf(c.source), c) },
			};
		})
		.toSorted(
			(a, b) => (a.brand ?? a.source).localeCompare(b.brand ?? b.source) || a.source.localeCompare(b.source),
		);
}

/** A build: what it added, removed and changed against its platform's previous release. */
export async function getRelease(platform: ReleasePlatform, id: string): Promise<ReleaseView> {
	const d = await db();
	const [release, { previous }, changes] = await Promise.all([
		mustRelease(platform, id),
		neighbours(d, platform, id),
		everyPage(
			(page: Page<SourceKey>) => changesOf(d, platform, id, page),
			(c) => c.source,
		),
	]);
	const [before, listed] = await Promise.all([
		previous === null ? null : releaseNamed(platform, previous),
		listEntries(changes.map((c) => c.source)),
	]);
	const view = (c: ShownChange): SourceChange => {
		const shown = (e: ShownEnd): ReleasedVersion => ({
			version: e.version,
			path: versionPath(sourceOf(c.source), e),
		});
		return {
			source: c.source,
			brand: listed.get(c.source)?.brand ?? null,
			picture: listed.get(c.source)?.picture ?? null,
			from: c.kind === "added" ? null : shown(c.from),
			to: c.kind === "removed" ? null : shown(c.to),
		};
	};
	const of = (kind: ShownChange["kind"]): SourceChange[] => changes.filter((c) => c.kind === kind).map(view);
	return { release, previous: before, added: of("added"), removed: of("removed"), changed: of("changed") };
}
