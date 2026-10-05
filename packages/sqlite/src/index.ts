/** A read-only SQLite file reader: tables and their rows, with no Node APIs. */

import { type Pager, tableCells } from "./btree.ts";
import { slice, SqliteError, u8, u16, u32 } from "./bytes.ts";
import { decodeRecord, type SqlValue } from "./record.ts";
import { type TableColumns, tableColumns } from "./schema.ts";

export { SqliteError } from "./bytes.ts";
export type { SqlValue } from "./record.ts";

/** Header byte 56's text encodings, in order from 1. */
const TEXT_ENCODINGS = ["utf-8", "utf-16le", "utf-16be"] as const;

/** What a typed column may hold, each with the check a stored value must pass. */
const KINDS = {
  integer: (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v),
  // REAL affinity stores integral values as integers, so both read as numbers.
  real: (v: unknown): v is number => typeof v === "number",
  text: (v: unknown): v is string => typeof v === "string",
  blob: (v: unknown): v is Uint8Array => v instanceof Uint8Array,
} as const;
type ColumnKind = keyof typeof KINDS;
const isKind = (s: string): s is ColumnKind => Object.hasOwn(KINDS, s);
type KindValue<K extends ColumnKind> = (typeof KINDS)[K] extends (v: unknown) => v is infer T ? T : never;

/** A typed table's columns: each one's kind, with `?` when it may be NULL. */
export type ColumnSpec = Readonly<Record<string, ColumnKind | `${ColumnKind}?`>>;
type ValueOf<K extends ColumnKind | `${ColumnKind}?`> = K extends `${infer B extends ColumnKind}?` ? KindValue<B> | null
  : K extends ColumnKind ? KindValue<K> : never;
export type RowOf<S extends ColumnSpec> = { readonly [C in keyof S]: ValueOf<S[C]> };

export type Row = Readonly<Record<string, SqlValue>>;

interface Sqlite {
  rows(table: string): Iterable<Row>;
  /** Only the spec's columns, each checked against its kind. */
  rows<S extends ColumnSpec>(table: string, spec: S): Iterable<RowOf<S>>;
}

const MAGIC = "SQLite format 3\0";

function pager(bytes: Uint8Array): Pager {
  if (new TextDecoder().decode(slice(bytes, 0, 16)) !== MAGIC) throw new SqliteError("not an SQLite 3 file");
  const raw = u16(bytes, 16);
  const pageSize = raw === 1 ? 65536 : raw;
  if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) throw new SqliteError(`page size ${raw}`);
  if (bytes.length % pageSize !== 0) throw new SqliteError(`${bytes.length} bytes is not a whole number of ${pageSize}-byte pages`);
  return { bytes, pageSize, usable: pageSize - u8(bytes, 20), pageCount: bytes.length / pageSize };
}

function encodingOf(bytes: Uint8Array): (typeof TEXT_ENCODINGS)[number] {
  const e = TEXT_ENCODINGS[u32(bytes, 56) - 1];
  if (!e) throw new SqliteError(`text encoding ${u32(bytes, 56)}`);
  return e;
}

interface TableShape extends TableColumns {
  readonly rootPage: number;
}

/** sqlite_schema's columns: type, name, tbl_name, rootpage, sql. */
const SCHEMA_SPEC = { type: "text", name: "text", tbl_name: "text", rootpage: "integer", sql: "text?" } as const satisfies ColumnSpec;
const SCHEMA_SHAPE: TableShape = { rootPage: 1, columns: Object.keys(SCHEMA_SPEC), rowidColumn: undefined };

export function openSqlite(bytes: Uint8Array): Sqlite {
  const p = pager(bytes);
  const decoder = new TextDecoder(encodingOf(bytes));
  const text = (b: Uint8Array): string => decoder.decode(b);

  function* records(name: string, shape: TableShape): Generator<Row, void, undefined> {
    for (const cell of tableCells(p, shape.rootPage)) {
      const values = decodeRecord(cell.payload, text);
      // Records written before an ALTER TABLE ADD COLUMN are shorter; none of the files read here have one.
      if (values.length !== shape.columns.length) {
        throw new SqliteError(`${name} row ${cell.rowid} has ${values.length} values for ${shape.columns.length} columns`);
      }
      if (shape.rowidColumn !== undefined) {
        const id = Number(cell.rowid);
        values[shape.rowidColumn] = Number.isSafeInteger(id) ? id : cell.rowid;
      }
      yield Object.fromEntries(shape.columns.map((c, i) => [c, values[i] ?? null]));
    }
  }

  function* typed<S extends ColumnSpec>(name: string, shape: TableShape, spec: S): Generator<RowOf<S>, void, undefined> {
    const entries = Object.entries(spec).map(([column, kind]) => {
      const nullable = kind.endsWith("?");
      const base = nullable ? kind.slice(0, -1) : kind;
      if (!isKind(base)) throw new SqliteError(`column kind ${kind}`);
      if (!shape.columns.includes(column)) throw new SqliteError(`${name} has no column ${column}`);
      return { column, kind, nullable, check: KINDS[base] };
    });
    for (const row of records(name, shape)) {
      for (const { column, kind, nullable, check } of entries) {
        const v = row[column] ?? null;
        if (!(v === null ? nullable : check(v))) {
          throw new SqliteError(`${name}.${column} holds ${v === null ? "NULL" : typeof v}, not ${kind}`);
        }
      }
      // Every column of the spec was checked against its kind above.
      yield Object.fromEntries(entries.map(({ column }) => [column, row[column] ?? null])) as RowOf<S>;
    }
  }

  const schemaRows = [...typed("sqlite_schema", SCHEMA_SHAPE, SCHEMA_SPEC)];
  // The ordinary tables; indexes, views and triggers are left out.
  const tables = schemaRows.flatMap((r) =>
    r.type === "table" && r.sql !== null
      ? [{ name: r.name, rootPage: r.rootpage, sql: r.sql }]
      : []);

  function rowsOf(table: string): Iterable<Row>;
  function rowsOf<S extends ColumnSpec>(table: string, spec: S): Iterable<RowOf<S>>;
  function rowsOf<S extends ColumnSpec>(table: string, spec?: S): Iterable<Row> | Iterable<RowOf<S>> {
    const t = tables.find((x) => x.name === table);
    if (!t) throw new SqliteError(`no table ${table}`);
    if (/^\s*CREATE\s+VIRTUAL\b/i.test(t.sql)) throw new SqliteError(`${table} is a virtual table`);
    const shape = { rootPage: t.rootPage, ...tableColumns(t.sql) };
    return spec ? typed(table, shape, spec) : records(table, shape);
  }

  return { rows: rowsOf };
}
