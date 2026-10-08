/** The index: one D1 session per request, so reads go to the nearest replica and stay in order within the request. */

import { env } from "cloudflare:workers";
import { indexDb, type IndexDb, type Page } from "@carrier-explode/db";
import { perRequest } from "./cache";

const session = perRequest(async (): Promise<D1DatabaseSession> => env.DB.withSession());

export const db = perRequest(async (): Promise<IndexDb> => indexDb(await session()));

/**
 * The index's version as this request reads it: D1's bookmark, which every write moves. What is derived from the index
 * under it stays true; the request's later reads are at least as new.
 */
export const indexVersion = perRequest(async (): Promise<string> => {
	const s = await session();
	await s.prepare("SELECT 1").run();
	const bookmark = s.getBookmark();
	if (bookmark === null) throw new Error("D1 gave no bookmark after a query");
	return bookmark;
});

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
