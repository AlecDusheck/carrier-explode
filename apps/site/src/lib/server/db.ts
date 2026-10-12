/** The index: one D1 session per request, so reads go to the nearest replica and stay in order within the request. */

import { env } from "cloudflare:workers";
import { indexDb, type IndexDb, type Page } from "@carrier-explode/db";
import { perRequest } from "./cache";

/** How long an isolate keys derived values by the bookmark it last read; purges wait longer (PURGE_DELAY_S in apps/extractor/src/queues.ts). */
const BOOKMARK_MS = 30_000;

let latest: { readonly bookmark: string; readonly at: number } | null = null;

/**
 * The request's session and the index version it reads at least: a recent bookmark, which the session is opened at so no
 * replica behind it answers.
 */
const opened = perRequest(
	async (): Promise<{ readonly session: D1DatabaseSession; readonly version: string }> => {
		const known = latest;
		if (known !== null && Date.now() - known.at < BOOKMARK_MS) {
			return { session: env.DB.withSession(known.bookmark), version: known.bookmark };
		}
		const session = env.DB.withSession(known?.bookmark ?? "first-unconstrained");
		await session.prepare("SELECT 1").run();
		const bookmark = session.getBookmark();
		if (bookmark === null) throw new Error("D1 gave no bookmark after a query");
		latest = { bookmark, at: Date.now() };
		return { session, version: bookmark };
	},
);

export const db = perRequest(async (): Promise<IndexDb> => indexDb((await opened()).session));

/** A version the request reads at least as new as: what is derived from the index under it stays true. */
export const indexVersion = async (): Promise<string> => (await opened()).version;

/** Rows a page of a list holds. */
const TAKE = 1000;

/** Every row of a paged list: pages read in turn, each after the last row of the one before. */
export async function everyPage<K, R>(
	read: (page: Page<K>) => Promise<readonly R[]>,
	keyOf: (row: R) => K,
): Promise<R[]> {
	const out: R[] = [];
	let after: K | null = null;
	for (;;) {
		const rows = await read({ after, take: TAKE });
		out.push(...rows);
		const last = rows.at(-1);
		if (rows.length < TAKE || last === undefined) return out;
		after = keyOf(last);
	}
}
