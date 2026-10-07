/** The index: one D1 session per request, so reads go to the nearest replica and stay in order within the request. */

import { env } from "cloudflare:workers";
import { indexDb, type IndexDb, type Page } from "@carrier-explode/db";
import { perRequest } from "./cache";

export const db = perRequest(async (): Promise<IndexDb> => indexDb(env.DB.withSession()));

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
