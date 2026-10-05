/** The index tables a publish writes. */

import { getColumns } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";

import * as schema from "./schema.ts";

/** Every index table records the hash of a row's values and the publish that wrote it. */
export type IndexTable = SQLiteTable & { readonly hash: SQLiteColumn; readonly builtAt: SQLiteColumn };

export const INDEX_TABLES = {
  releases: schema.releases,
  release_changes: schema.releaseChanges,
  carriers: schema.carriers,
  countries: schema.countries,
  sources: schema.sources,
  phone_states: schema.phoneStates,
  phones: schema.phones,
  names: schema.names,
  legacy: schema.legacy,
} as const satisfies Readonly<Record<string, IndexTable>>;

export type TableName = keyof typeof INDEX_TABLES;

/** What a publish derives for a row: everything but the bookkeeping it adds. */
export type Row<N extends TableName> = Omit<(typeof INDEX_TABLES)[N]["$inferInsert"], "hash" | "builtAt">;
export type Rows = { readonly [N in TableName]: readonly Row<N>[] };

/** The primary key's columns, by property name, as the table defines them. */
export function keyColumns(table: IndexTable): ReadonlyArray<readonly [string, SQLiteColumn]> {
  const composite = getTableConfig(table).primaryKeys[0]?.columns;
  return Object.entries(getColumns(table)).filter(([, c]) => (composite === undefined ? c.primary : composite.includes(c)));
}

/** A row's key as text: its key columns' values, as a JSON array. */
export const keyText = (key: ReadonlyArray<readonly [string, SQLiteColumn]>, row: Readonly<Record<string, unknown>>): string =>
  JSON.stringify(key.map(([name]) => row[name]));
