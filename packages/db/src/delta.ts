/**
 * What a publish writes, as statements: rows whose hash differs from the live one, and deletes for live rows the new
 * index lacks. A row is written only over one the same or an earlier publish wrote, and deleted only if an earlier one
 * wrote it, so overlapping publishes leave the later one's rows, and one that dies part way is finished by the next.
 */

import { and, getColumns, lt, sql, type Query } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as v from "valibot";

import { sha256Hex } from "@carrier-explode/binary";
import { deviceSchema, labelSchema, sourceKeySchema } from "@carrier-explode/schema/records";
import type { SourceKey } from "@carrier-explode/schema/types";
import { meta } from "./schema.ts";
import { INDEX_TABLES, keyColumns, keyText, type IndexTable, type Rows, type TableName } from "./tables.ts";

/** D1 binds at most 100 parameters per statement. */
const MAX_PARAMS = 100;
/** A statement's parameters, in bytes: under D1's 2 MB row with room to spare (a Pixel timeline runs to 90 KB). */
const MAX_BYTES = 1_000_000;

export type Statement = Pick<Query, "sql" | "params">;
export const statementSchema = v.object({ sql: v.string(), params: v.array(v.union([v.string(), v.number(), v.null()])) });

const hashes = v.record(v.string(), v.string());
/**
 * What D1 held when read: each table's row keys (keyText) and hashes, each source's carrier, the newest publish applied,
 * the device records and the labels.
 */
export const liveSchema = v.object({
  /** A publish built from this is built at this time: anything written to the bucket or the labels before it is in it. */
  readAt: v.pipe(v.string(), v.isoTimestamp()),
  builtAt: v.nullable(v.string()),
  /** sourceKey -> carrier id: a build keeps each carrier's id. */
  carriers: v.record(v.string(), v.string()),
  /** The feeds' device records, which a build orders devices and resolves Apple's boards by. */
  devices: v.array(deviceSchema),
  labels: v.array(labelSchema),
  hashes: v.object({
    releases: hashes, release_changes: hashes, carriers: hashes, countries: hashes, sources: hashes, phone_states: hashes, phones: hashes, names: hashes,
    legacy: hashes,
  }) satisfies v.GenericSchema<unknown, { readonly [T in TableName]: Readonly<Record<string, string>> }>,
});
export type Live = v.InferOutput<typeof liveSchema>;

/** An index nothing has been published to, read at `readAt`. */
export const emptyLive = (readAt: string): Live => ({
  readAt,
  builtAt: null,
  carriers: {},
  devices: [],
  labels: [],
  hashes: { releases: {}, release_changes: {}, carriers: {}, countries: {}, sources: {}, phone_states: {}, phones: {}, names: {}, legacy: {} },
});

/** Builds statements and runs none: the extractor's Worker applies them over its D1 binding. */
const builder = drizzle(async () => {
  throw new Error("delta statements are applied by the Worker, not run here");
});

const hashOf = (row: object): Promise<string> => sha256Hex(new TextEncoder().encode(JSON.stringify(row)));

/** `xs` in order, as groups of at most `count` items and `bytes` of JSON. */
function pack<X>(xs: readonly X[], count: number, bytes: number): X[][] {
  const out: X[][] = [];
  let used = 0;
  for (const x of xs) {
    const size = JSON.stringify(x).length;
    const last = out.at(-1);
    if (last === undefined || last.length === count || used + size > bytes) {
      out.push([x]);
      used = size;
    } else {
      last.push(x);
      used += size;
    }
  }
  return out;
}

/** Rows into statements of `perRow` parameters a row and `fixed` more. */
const statementsOf = <X>(rows: readonly X[], perRow: number, fixed: number): X[][] => pack(rows, Math.floor((MAX_PARAMS - fixed) / perRow), MAX_BYTES);

/** A table's statements, and the rows they write or delete: written as rows, deleted as their key values. */
interface TableDelta<R> {
  readonly statements: readonly Statement[];
  readonly written: readonly R[];
  readonly deleted: readonly (readonly string[])[];
}

async function tableDelta<R extends Readonly<Record<string, unknown>>>(table: IndexTable, rows: readonly R[], live: Readonly<Record<string, string>>, builtAt: string): Promise<TableDelta<R>> {
  const columns = getColumns(table);
  const key = keyColumns(table);
  const hashed = await Promise.all(rows.map(async (row) => ({ source: row, row: { ...row, hash: await hashOf(row), builtAt }, key: keyText(key, row) })));
  const kept = new Set(hashed.map((r) => r.key));
  const changed = hashed.filter((r) => live[r.key] !== r.row.hash);
  const gone = Object.keys(live).filter((k) => !kept.has(k)).map((k) => v.parse(v.array(v.string()), JSON.parse(k)));

  const set = Object.fromEntries(Object.entries(columns).filter(([, c]) => !key.some(([, k]) => k === c)).map(([name, c]) => [name, sql`excluded.${sql.identifier(c.name)}`]));
  const upserts = statementsOf(changed.map((r) => r.row), Object.keys(columns).length, 0).map((group) =>
    builder.insert(table).values(group)
      .onConflictDoUpdate({ target: key.map(([, c]) => c), set, setWhere: sql`excluded.${sql.identifier(table.builtAt.name)} >= ${table.builtAt}` })
      .toSQL());
  // A row-value IN, not an OR per row: SQLite caps an expression's depth at 100.
  const keyTuple = sql`(${sql.join(key.map(([, c]) => c), sql`, `)})`;
  const deletes = statementsOf(gone, key.length, 1).map((group) =>
    builder.delete(table)
      .where(and(lt(table.builtAt, builtAt), sql`${keyTuple} IN (VALUES ${sql.join(group.map((values) => sql`(${sql.join(values.map((x) => sql`${x}`), sql`, `)})`), sql`, `)})`))
      .toSQL());
  return { statements: [...upserts, ...deletes], written: changed.map((r) => r.source), deleted: gone };
}

/** Statements per Workflow step: one D1 batch (a transaction) each, its JSON within a few MB. */
const BATCH_STATEMENTS = 20;
const BATCH_BYTES = 4_000_000;

/** `statements` as D1 batches, in order. */
export const batches = (statements: readonly Statement[]): Statement[][] => pack(statements, BATCH_STATEMENTS, BATCH_BYTES);

/** The pages a publish changes: those of some sources, or every page. */
export type Changed = readonly SourceKey[] | "everything";

/** What a publish writes: its statements, the last recording its `builtAt` (when it read `live`), and the pages they change. */
export interface Delta {
  readonly statements: readonly Statement[];
  /**
   * Sources written or deleted, and every member of a carrier written: a carrier's name and logo show on its members' pages.
   * Every page when a name was: a phone's or modem's name shows on the pages of every source its platform has.
   */
  readonly changed: Changed;
}

type Tracked = "sources" | "carriers" | "names";

/** Every statement that brings D1 from `live` to `rows`. */
export async function delta(rows: Rows, live: Live): Promise<Delta> {
  const builtAt = live.readAt;
  const others = Object.keys(INDEX_TABLES).filter((n): n is Exclude<TableName, Tracked> => n in INDEX_TABLES && n !== "sources" && n !== "carriers" && n !== "names");
  const [sources, carriers, names, rest] = await Promise.all([
    tableDelta(INDEX_TABLES.sources, rows.sources, live.hashes.sources, builtAt),
    tableDelta(INDEX_TABLES.carriers, rows.carriers, live.hashes.carriers, builtAt),
    tableDelta(INDEX_TABLES.names, rows.names, live.hashes.names, builtAt),
    Promise.all(others.map((n) => tableDelta<Readonly<Record<string, unknown>>>(INDEX_TABLES[n], rows[n], live.hashes[n], builtAt))),
  ]);
  const recorded = builder.insert(meta).values({ key: "built_at", value: builtAt })
    .onConflictDoUpdate({ target: meta.key, set: { value: builtAt }, setWhere: sql`excluded.value > ${meta.value}` });
  const pages = new Set<SourceKey>([
    ...sources.written.map((r) => r.key),
    ...sources.deleted.map(([key]) => v.parse(sourceKeySchema, key)),
    ...carriers.written.flatMap((r) => r.carrier.members),
  ]);
  const renamed = names.written.length > 0 || names.deleted.length > 0;
  return {
    statements: [...[sources, carriers, names, ...rest].flatMap((t) => t.statements), recorded.toSQL()],
    changed: renamed ? "everything" : [...pages].sort(),
  };
}
