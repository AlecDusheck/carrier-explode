/** The index's D1 handle, and how writes are cut to D1's limits and to only what changed. */

import { getTableName, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as v from "valibot";

import { canonical } from "@carrier-explode/values";

export type IndexDb = DrizzleD1Database;
export type Statement = BatchItem<"sqlite">;

/** One session per request: reads go to the nearest replica, and stay in order within the request. */
export const indexDb = (d1: D1Database | D1DatabaseSession): IndexDb => drizzle(d1);

/** One page of a list in its index's order: the rows after `after` (null: from the first), at most `take`. */
export interface Page<K> {
	readonly after: K | null;
	readonly take: number;
}

/** A column or aggregate of JSON text, parsed and checked: what a raw SQL row holds. */
export const jsonOf = <S extends v.GenericSchema>(schema: S) => v.pipe(v.string(), v.parseJson(), schema);

/** Every condition: drizzle's `and` may return none, which would make a scope the whole table. */
export const every = (...conditions: readonly [SQL, ...SQL[]]): SQL =>
	sql`(${sql.join([...conditions], sql` AND `)})`;

/** A column named with its table, as a correlated subquery must: drizzle leaves a single-table select's columns bare. */
export const qualified = (table: SQLiteTable, column: SQLiteColumn): SQL =>
	sql`${sql.identifier(getTableName(table))}.${sql.identifier(column.name)}`;

/** D1 binds at most 100 parameters a statement. */
const MAX_PARAMS = 100;

/** `rows` cut so each part binds at most MAX_PARAMS parameters, `perRow` a row and `fixed` more. */
export function chunks<R>(rows: readonly R[], perRow: number, fixed = 0): R[][] {
	const size = Math.floor((MAX_PARAMS - fixed) / perRow);
	return Array.from({ length: Math.ceil(rows.length / size) }, (_, i) =>
		rows.slice(i * size, (i + 1) * size),
	);
}

/** Runs `statements` as one D1 batch, which is one transaction. */
export async function run(db: IndexDb, statements: readonly Statement[]): Promise<void> {
	const [first, ...rest] = statements;
	if (first !== undefined) await db.batch([first, ...rest]);
}

/** What turns `held` into `wanted`: rows new or different, and held rows whose key `wanted` lacks. */
export function diff<H, W extends H>(
	held: readonly H[],
	wanted: readonly W[],
	key: (r: H) => string,
): { readonly put: W[]; readonly gone: H[] } {
	const had = new Map(held.map((r) => [key(r), canonical(r)]));
	const keep = new Set(wanted.map(key));
	return {
		put: wanted.filter((r) => had.get(key(r)) !== canonical(r)),
		gone: held.filter((r) => !keep.has(key(r))),
	};
}
