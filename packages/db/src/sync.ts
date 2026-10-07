/**
 * Writing a scope of a table as it should be, touching only rows that differ. Rows travel as one JSON array per
 * statement, read back with json_each, because D1 counts each statement of a batch as a query.
 */

import { getColumns, sql, type InferSelectModel, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteInsertValue, SQLiteTable } from "drizzle-orm/sqlite-core";

import { diff, run, type IndexDb, type Statement } from "./db.ts";

/** A table's primary key, by column name. */
type Key<T extends SQLiteTable> = readonly [
	keyof InferSelectModel<T> & string,
	...(keyof InferSelectModel<T> & string)[],
];

/** The largest JSON one statement binds: D1 takes strings up to 2,000,000 bytes. */
const JSON_BYTES = 1_000_000;

function columnsOf<T extends SQLiteTable>(
	table: T,
	names: readonly string[],
): Array<readonly [string, SQLiteColumn]> {
	const columns: Readonly<Record<string, SQLiteColumn>> = getColumns(table);
	return names.map((k) => {
		const c = columns[k];
		if (c === undefined) throw new Error(`no column ${k}`);
		return [k, c] as const;
	});
}

/** `rows` as JSON arrays of `columns`' stored values, as few JSON texts as JSON_BYTES allows. */
function jsonBatches(
	rows: readonly object[],
	columns: ReadonlyArray<readonly [string, SQLiteColumn]>,
): string[] {
	const out: string[] = [];
	let part: string[] = [];
	let bytes = 2;
	for (const row of rows) {
		const fields: ReadonlyMap<string, unknown> = new Map(Object.entries(row));
		const encoded = JSON.stringify(
			columns.map(([k, c]) => {
				const value = fields.get(k);
				return value === undefined || value === null ? null : c.mapToDriverValue(value);
			}),
		);
		if (part.length > 0 && bytes + encoded.length + 1 > JSON_BYTES) {
			out.push(`[${part.join(",")}]`);
			part = [];
			bytes = 2;
		}
		part.push(encoded);
		bytes += encoded.length + 1;
	}
	if (part.length > 0) out.push(`[${part.join(",")}]`);
	return out;
}

const names = (columns: ReadonlyArray<readonly [string, SQLiteColumn]>): SQL =>
	sql.join(
		columns.map(([, c]) => sql.identifier(c.name)),
		sql`, `,
	);

/** Each JSON row's fields, in `columns` order, as a select list over json_each. */
const fieldsOf = (columns: ReadonlyArray<readonly [string, SQLiteColumn]>): SQL =>
	sql.join(
		columns.map((_, i) => sql`json_extract(value, ${`$[${i}]`})`),
		sql`, `,
	);

/** Inserts of `rows`; `conflict` says what a row whose key is held does (the WHERE keeps SQLite from reading ON as a join). */
function insertsWith<T extends SQLiteTable>(
	db: IndexDb,
	table: T,
	rows: readonly SQLiteInsertValue<T>[],
	conflict: SQL,
): Statement[] {
	const columns = columnsOf(table, Object.keys(getColumns(table)));
	return jsonBatches(rows, columns).map((json) =>
		db.run(
			sql`INSERT INTO ${table} (${names(columns)}) SELECT ${fieldsOf(columns)} FROM json_each(${json}) WHERE true ${conflict}`,
		),
	);
}

/** Inserts of `rows` that leave a row already there as it is. */
export function inserts<T extends SQLiteTable>(
	db: IndexDb,
	table: T,
	rows: readonly SQLiteInsertValue<T>[],
): Statement[] {
	return insertsWith(db, table, rows, sql`ON CONFLICT DO NOTHING`);
}

/** Inserts of `rows` that overwrite a row with the same `key` in its `set` columns. */
export function upserts<T extends SQLiteTable>(
	db: IndexDb,
	table: T,
	key: Key<T>,
	set: readonly (keyof InferSelectModel<T> & string)[],
	rows: readonly SQLiteInsertValue<T>[],
): Statement[] {
	const assignments = sql.join(
		columnsOf(table, set).map(([, c]) => sql`${sql.identifier(c.name)} = excluded.${sql.identifier(c.name)}`),
		sql`, `,
	);
	return insertsWith(
		db,
		table,
		rows,
		sql`ON CONFLICT (${names(columnsOf(table, key))}) DO UPDATE SET ${assignments}`,
	);
}

function deletes<T extends SQLiteTable>(
	db: IndexDb,
	table: T,
	key: Key<T>,
	rows: readonly InferSelectModel<T>[],
): Statement[] {
	const columns = columnsOf(table, key);
	return jsonBatches(rows, columns).map((json) =>
		db.run(
			sql`DELETE FROM ${table} WHERE (${names(columns)}) IN (SELECT ${fieldsOf(columns)} FROM json_each(${json}))`,
		),
	);
}

/** Makes the rows of `table` within `scope` exactly `wanted`, every column as a select returns it. Returns the rows written and deleted. */
export async function syncScope<T extends SQLiteTable>(
	db: IndexDb,
	table: T,
	key: Key<T>,
	scope: SQL,
	wanted: readonly (InferSelectModel<T> & SQLiteInsertValue<T>)[],
): Promise<InferSelectModel<T>[]> {
	const held: InferSelectModel<T>[] = await db.select().from(table).where(scope);
	const { put, gone } = diff(held, wanted, (r) => JSON.stringify(key.map((k) => r[k])));
	// A changed row is deleted and inserted again, in the same transaction.
	await run(db, [...deletes(db, table, key, [...gone, ...put]), ...inserts(db, table, put)]);
	return [...put, ...gone];
}
