/** Debouncing derivation: each facts message counts itself, and its settle message derives only if it is still the last. */

import { eq, sql } from "drizzle-orm";

import type { ReleasePlatform } from "@carrier-explode/schema/types";
import type { IndexDb } from "./db.ts";
import { factsWritten } from "./schema.ts";

/** Counts a facts message of `platform`. Returns its number. */
export async function countFacts(db: IndexDb, platform: ReleasePlatform): Promise<number> {
	const [row] = await db
		.insert(factsWritten)
		.values({ platform, messages: 1 })
		.onConflictDoUpdate({
			target: factsWritten.platform,
			set: { messages: sql`${factsWritten.messages} + 1` },
		})
		.returning({ messages: factsWritten.messages });
	if (row === undefined) throw new Error(`facts_written: no row returned for ${platform}`);
	return row.messages;
}

/** The number of `platform`'s last facts message; 0 before its first. */
export async function lastFacts(db: IndexDb, platform: ReleasePlatform): Promise<number> {
	const [row] = await db
		.select({ messages: factsWritten.messages })
		.from(factsWritten)
		.where(eq(factsWritten.platform, platform));
	return row?.messages ?? 0;
}
