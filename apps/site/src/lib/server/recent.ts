/** The home page's recent changes: carriers' new versions in one country, newest first, a page at a time. */

import { changeFeed, type FeedFilter, type FeedItem, type FeedKey } from "@carrier-explode/db";
import { sourceOf, versionPath } from "@carrier-explode/schema/types";
import type { Picture } from "#lib/types.ts";
import { cached } from "./cache";
import { db, indexVersion } from "./db";
import { listEntries } from "./lists";

const PAGE = 20;

export type RecentChange = FeedItem & {
	/** What people call its carrier; null for a source no list shows yet. */
	readonly brand: string | null;
	readonly picture: Picture | null;
	/** What changed, or a new source's version. */
	readonly path: string;
};

export interface RecentChanges {
	/** The country the changes are in. */
	readonly iso: string;
	readonly changes: readonly RecentChange[];
	/** Where the next page starts; null after the last. */
	readonly next: FeedKey | null;
}

async function pageOf(filter: FeedFilter, after: FeedKey | null): Promise<RecentChanges> {
	// One more than a page tells whether another follows.
	const read = await changeFeed(await db(), filter, { after, take: PAGE + 1 });
	const items = read.slice(0, PAGE);
	const entries = await listEntries(items.map((i) => i.key.source));
	return {
		iso: filter.iso,
		next: read.length > PAGE ? (items.at(-1)?.key ?? null) : null,
		changes: items.map((i): RecentChange => {
			const entry = entries.get(i.key.source);
			const to = versionPath(sourceOf(i.key.source), i.key);
			return Object.assign(i, {
				brand: entry?.brand ?? null,
				picture: entry?.picture ?? null,
				path: i.from === null ? to : `${to}/changes`,
			});
		}),
	};
}

const cacheKey = (filter: FeedFilter, after: FeedKey | null): string =>
	[filter.iso, filter.platform ?? "all", after === null ? "" : JSON.stringify(after)].join(":");

/** Where a visitor's country is unknown or has no changes, the feed is this one's. */
export const FALLBACK_ISO = "us";

/** A page of the newest changes; a country with none starts the fallback country's instead. */
export async function getRecentChanges(filter: FeedFilter, after: FeedKey | null): Promise<RecentChanges> {
	const found = await cached(`recent-changes:v2:${cacheKey(filter, after)}:${await indexVersion()}`, () =>
		pageOf(filter, after),
	);
	return filter.iso !== FALLBACK_ISO && after === null && found.changes.length === 0
		? getRecentChanges({ ...filter, iso: FALLBACK_ISO }, null)
		: found;
}
