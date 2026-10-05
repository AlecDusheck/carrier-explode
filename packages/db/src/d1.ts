/** Reading the index in a Worker: typed queries over a D1 session, and the live hashes a publish diffs against. */

import { and, asc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as v from "valibot";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { labelField, labelSchema, type Label, type LabelFieldName, type LabelOrigin, type LabelSubject } from "@carrier-explode/schema/records";
import type {
  Carrier, CarrierModem, CarrierSummary, CountrySummary, DecoderFamily, Device, LegacyRoute, NamedSubject, Phone, PhoneStates, Platform, ReleaseChange,
  ReleasePlatform, ReleaseSummary, SourceKey, SourceKind, Timeline,
} from "@carrier-explode/schema/types";
import { PLATFORMS, SOURCE_KINDS } from "@carrier-explode/schema/types";
import type { Live } from "./delta.ts";
import type { ListedDevice } from "./schema.ts";
import { carriers, countries, devices, labels, legacy, meta, names, phones, phoneStates, releaseChanges, releases, sources } from "./schema.ts";
import { INDEX_TABLES, keyColumns, keyText, type TableName } from "./tables.ts";

export type IndexDb = DrizzleD1Database;

/** One session per request: reads go to the nearest replica, and stay in order within the request. */
export const indexDb = (d1: D1Database | D1DatabaseSession): IndexDb => drizzle(d1);

/** Both platforms, newest first. */
export async function releaseList(db: IndexDb): Promise<ReleaseSummary[]> {
  return (await db.select({ summary: releases.summary }).from(releases).orderBy(asc(releases.sort))).map((r) => r.summary);
}

/** A carrier, as lists and pictures name it. */
export interface ListedCarrier extends Pick<Carrier, "id" | "name" | "members"> {
  readonly iso: string | null;
  readonly updated: string | null;
}

const carrierName = sql<string>`json_extract(${carriers.carrier}, '$.name')`;

const listedCarrier = {
  id: carriers.id,
  name: carrierName,
  iso: carriers.iso,
  members: sql<string>`json_extract(${carriers.carrier}, '$.members')`.mapWith((s: string): readonly SourceKey[] => JSON.parse(s)),
  updated: sql<string | null>`json_extract(${carriers.summary}, '$.updated')`,
};

/** Values per lookup: D1 binds at most 100 parameters a statement, and a lookup may bind one more of its own. */
const VALUES_PER_LOOKUP = 99;

/** A lookup by many values, as several statements in parallel; each distinct value once. */
async function byChunks<V, R>(values: readonly V[], lookup: (some: V[]) => Promise<R[]>): Promise<R[]> {
  const unique = [...new Set(values)];
  const chunks = Array.from({ length: Math.ceil(unique.length / VALUES_PER_LOOKUP) }, (_, i) => unique.slice(i * VALUES_PER_LOOKUP, (i + 1) * VALUES_PER_LOOKUP));
  return (await Promise.all(chunks.map(lookup))).flat();
}

/** A source as lists show it, with its carrier. */
export interface ListedSource {
  readonly key: SourceKey;
  readonly platform: Platform;
  readonly kind: SourceKind;
  readonly name: string;
  readonly carrier: ListedCarrier;
}

const listed = (db: IndexDb) =>
  db.select({ key: sources.key, platform: sources.platform, kind: sources.kind, name: sources.name, carrier: listedCarrier }).from(sources)
    .innerJoin(carriers, eq(carriers.id, sources.carrier));

/** One platform's list of one kind, by name. */
export function sourceList(db: IndexDb, platform: Platform, kind: SourceKind): Promise<ListedSource[]> {
  return listed(db).where(and(eq(sources.platform, platform), eq(sources.kind, kind))).orderBy(asc(sources.name));
}

/** One platform's carriers in a country, by their carriers' country. */
export function countryCarriers(db: IndexDb, platform: Platform, iso: string): Promise<ListedSource[]> {
  return listed(db).where(and(eq(sources.platform, platform), eq(sources.kind, "carrier"), eq(carriers.iso, iso))).orderBy(asc(sources.name));
}

/** The countries a platform has carriers in, with their names: a list for a platform that ships no country files. */
export function carrierCountries(db: IndexDb, platform: Platform): Promise<Array<{ readonly iso: string; readonly name: string }>> {
  const name = sql<string>`json_extract(${countries.summary}, '$.name')`;
  return db.selectDistinct({ iso: countries.iso, name }).from(sources)
    .innerJoin(carriers, eq(carriers.id, sources.carrier)).innerJoin(countries, eq(countries.iso, carriers.iso))
    .where(and(eq(sources.platform, platform), eq(sources.kind, "carrier"))).orderBy(name);
}

/** The named sources the index has. */
export function listedSources(db: IndexDb, keys: readonly SourceKey[]): Promise<ListedSource[]> {
  return byChunks(keys, (some) => listed(db).where(inArray(sources.key, some)));
}

/** Every source the index has, by key. */
export async function sourceKeys(db: IndexDb): Promise<SourceKey[]> {
  return (await db.select({ key: sources.key }).from(sources).orderBy(asc(sources.key))).map((s) => s.key);
}

const LIST_PAIRS = PLATFORMS.flatMap((platform) => SOURCE_KINDS.map((kind) => ({ platform, kind })));

/** Every source the index has, by key, with its carrier's name: what Compare's boxes complete from. */
export function sourceBrands(db: IndexDb): Promise<Array<{ readonly key: SourceKey; readonly brand: string }>> {
  return db.select({ key: sources.key, brand: carrierName }).from(sources).innerJoin(carriers, eq(carriers.id, sources.carrier)).orderBy(asc(sources.key));
}

/** Which platforms have a list of which kind. */
export async function listedPlatforms(db: IndexDb): Promise<Array<{ readonly platform: Platform; readonly kind: SourceKind }>> {
  // One row probed per pair: a DISTINCT over sources reads every row.
  const listed = await Promise.all(LIST_PAIRS.map(async ({ platform, kind }) =>
    (await db.select({ key: sources.key }).from(sources).where(and(eq(sources.platform, platform), eq(sources.kind, kind))).limit(1)).length > 0));
  return LIST_PAIRS.filter((_, i) => listed[i]);
}

/** A source: its timeline, and the carrier document holding it. */
export interface SourceRow {
  readonly timeline: Timeline;
  readonly carrier: Carrier;
  readonly modems: readonly CarrierModem[];
}

/** Undefined when the index has no such source. */
export function sourceOf(db: IndexDb, key: SourceKey): Promise<SourceRow | undefined> {
  return db.select({ timeline: sources.timeline, carrier: carriers.carrier, modems: carriers.modems }).from(sources)
    .innerJoin(carriers, eq(carriers.id, sources.carrier))
    .where(eq(sources.key, key))
    .get();
}

export async function carrierSummaries(db: IndexDb): Promise<CarrierSummary[]> {
  const rows = await db.select({ summary: carriers.summary }).from(carriers).where(eq(carriers.kind, "carrier"));
  return rows.flatMap((r) => (r.summary === null ? [] : [r.summary]));
}

export async function countrySummaries(db: IndexDb): Promise<CountrySummary[]> {
  return (await db.select({ summary: countries.summary }).from(countries).orderBy(asc(countries.iso))).map((r) => r.summary);
}

export interface ListedChange {
  readonly change: ReleaseChange;
  /** Null for a source the index no longer has (one only older releases carried). */
  readonly carrier: ListedCarrier | null;
}

/** A release's changes, each with its source's carrier for its picture. */
export async function changesOf(db: IndexDb, platform: ReleasePlatform, release: string): Promise<ListedChange[]> {
  const rows = await db.select({ change: releaseChanges.change, carrier: listedCarrier, indexed: sources.key }).from(releaseChanges)
    .leftJoin(sources, eq(sources.key, releaseChanges.source))
    .leftJoin(carriers, eq(carriers.id, sources.carrier))
    .where(and(eq(releaseChanges.platform, platform), eq(releaseChanges.release, release)))
    .orderBy(asc(releaseChanges.source));
  return rows.map((r) => ({ change: r.change, carrier: r.indexed === null ? null : r.carrier }));
}

const phone = { code: phones.code, name: phones.name, platform: phones.platform, has5G: phones.has5G };

/** The current releases' phones, newest first. */
export function currentPhones(db: IndexDb): Promise<Phone[]> {
  return db.select(phone).from(phones).orderBy(asc(phones.sort));
}

/** What one phone reads from every carrier source of its platform. */
export function statesOn(db: IndexDb, device: string): Promise<Array<Pick<PhoneStates, "source" | "states">>> {
  return db.select({ source: phoneStates.source, states: phoneStates.states }).from(phoneStates).where(eq(phoneStates.device, device));
}

/** The names the index gives `codes`; a code it names nothing is absent. */
export async function namesOf(db: IndexDb, subject: NamedSubject, codes: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const rows = await byChunks(codes, (some) =>
    db.select({ code: names.code, name: names.name }).from(names).where(and(eq(names.subject, subject), inArray(names.code, some))));
  return new Map(rows.map((r) => [r.code, r.name]));
}

/** The code a name is: a Pixel's codename from the model name a phone reports. */
export async function codeNamed(db: IndexDb, subject: NamedSubject, name: string): Promise<string | undefined> {
  return (await db.select({ code: names.code }).from(names).where(and(eq(names.subject, subject), eq(names.name, name))).get())?.code;
}

/** One page of a list in its index's order: the rows after `after` (null: from the first), at most `take`. */
export interface After<K extends string | number> {
  readonly after: K | null;
  readonly take: number;
}

/** A page's place in its index: each lookup below reads about `take` rows, whatever the list's length. */
const past = <K extends string | number>(column: SQLiteColumn, page: After<K>): SQL | undefined => (page.after === null ? undefined : gt(column, page.after));

/** One platform's list of one kind, by name, a page at a time. */
export function sourcesAfter(db: IndexDb, platform: Platform, kind: SourceKind, page: After<string>): Promise<ListedSource[]> {
  return listed(db).where(and(eq(sources.platform, platform), eq(sources.kind, kind), past(sources.name, page))).orderBy(asc(sources.name)).limit(page.take);
}

/** Carriers (not country bundles), by id, a page at a time. */
export function carriersAfter(db: IndexDb, page: After<string>): Promise<ListedCarrier[]> {
  return db.select(listedCarrier).from(carriers).where(and(eq(carriers.kind, "carrier"), past(carriers.id, page))).orderBy(asc(carriers.id)).limit(page.take);
}

/** A carrier's document, named as the lists name it, and the modem configurations its SIMs select. */
export interface CarrierRow {
  readonly name: string;
  readonly carrier: Carrier;
  readonly modems: readonly CarrierModem[];
}

/** Undefined when the index has no such carrier; a country bundle's document is not one. */
export function carrierOf(db: IndexDb, id: string): Promise<CarrierRow | undefined> {
  return db.select({ name: carrierName, carrier: carriers.carrier, modems: carriers.modems }).from(carriers)
    .where(and(eq(carriers.kind, "carrier"), eq(carriers.id, id))).get();
}

export async function countriesAfter(db: IndexDb, page: After<string>): Promise<CountrySummary[]> {
  return (await db.select({ summary: countries.summary }).from(countries).where(past(countries.iso, page)).orderBy(asc(countries.iso)).limit(page.take))
    .map((r) => r.summary);
}

export async function countryOf(db: IndexDb, iso: string): Promise<CountrySummary | undefined> {
  return (await db.select({ summary: countries.summary }).from(countries).where(eq(countries.iso, iso)).get())?.summary;
}

/** A release and its place in the newest-first order, which a page resumes after. */
export interface SortedRelease {
  readonly sort: number;
  readonly summary: ReleaseSummary;
}

/** One platform's releases, newest first, a page at a time. */
export function releasesAfter(db: IndexDb, platform: ReleasePlatform, page: After<number>): Promise<SortedRelease[]> {
  return db.select({ sort: releases.sort, summary: releases.summary }).from(releases)
    .where(and(eq(releases.platform, platform), past(releases.sort, page))).orderBy(asc(releases.sort)).limit(page.take);
}

export async function releaseOf(db: IndexDb, platform: ReleasePlatform, id: string): Promise<ReleaseSummary | undefined> {
  return (await db.select({ summary: releases.summary }).from(releases).where(and(eq(releases.platform, platform), eq(releases.id, id))).get())?.summary;
}

/** A release's changes, by source, a page at a time. */
export async function changesAfter(db: IndexDb, platform: ReleasePlatform, release: string, page: After<string>): Promise<ReleaseChange[]> {
  return (await db.select({ change: releaseChanges.change }).from(releaseChanges)
    .where(and(eq(releaseChanges.platform, platform), eq(releaseChanges.release, release), past(releaseChanges.source, page)))
    .orderBy(asc(releaseChanges.source)).limit(page.take)).map((r) => r.change);
}

/** One platform's current phones, by code, a page at a time. */
export function phonesAfter(db: IndexDb, platform: ReleasePlatform, page: After<string>): Promise<Phone[]> {
  return db.select(phone).from(phones).where(and(eq(phones.platform, platform), past(phones.code, page))).orderBy(asc(phones.code)).limit(page.take);
}

export function phoneOf(db: IndexDb, code: string): Promise<Phone | undefined> {
  return db.select(phone).from(phones).where(eq(phones.code, code)).get();
}

/** What one phone reads from each carrier source, by source, a page at a time. */
export function statesAfter(db: IndexDb, device: string, page: After<string>): Promise<Array<Pick<PhoneStates, "source" | "states">>> {
  return db.select({ source: phoneStates.source, states: phoneStates.states }).from(phoneStates)
    .where(and(eq(phoneStates.device, device), past(phoneStates.source, page))).orderBy(asc(phoneStates.source)).limit(page.take);
}

/** The redirects whose prefix is one of `prefixes`. */
export async function legacyRoutes(db: IndexDb, prefixes: readonly string[]): Promise<LegacyRoute[]> {
  return prefixes.length === 0 ? [] : db.select({ from: legacy.src, to: legacy.dst }).from(legacy).where(inArray(legacy.src, [...prefixes]));
}

/** Every label, as a publish applies them. */
async function allLabels(db: IndexDb): Promise<Label[]> {
  const rows = await db.select({ subject: labels.subject, code: labels.code, field: labels.field, value: labels.value, origin: labels.origin, evidence: labels.evidence })
    .from(labels);
  return v.parse(v.array(labelSchema), rows);
}

/** Each table's row keys and hashes, the newest publish applied, and what a build reads from D1: what a publish diffs against and builds from. */
export async function liveIndex(db: IndexDb): Promise<Live> {
  // Before any read: a label or a device written after it is in the next publish.
  const readAt = new Date().toISOString();
  const read = async (name: TableName): Promise<readonly [TableName, Readonly<Record<string, string>>]> => {
    const table = INDEX_TABLES[name];
    const key = keyColumns(table);
    const rows = await db.select({ ...Object.fromEntries(key), hash: table.hash }).from(table);
    return [name, Object.fromEntries(rows.map((r) => [keyText(key, r), r.hash]))];
  };
  const tables = Object.keys(INDEX_TABLES).filter((n): n is TableName => n in INDEX_TABLES);
  const [hashes, built, held, records, labelled] = await Promise.all([
    Promise.all(tables.map(read)),
    db.select({ value: meta.value }).from(meta).where(eq(meta.key, "built_at")).get(),
    db.select({ key: sources.key, carrier: sources.carrier }).from(sources),
    deviceRecords(db),
    allLabels(db),
  ]);
  const of = new Map(hashes);
  const hashesOf = (name: TableName): Readonly<Record<string, string>> => of.get(name) ?? {};
  return {
    readAt,
    builtAt: built?.value ?? null,
    carriers: Object.fromEntries(held.map((s) => [s.key, s.carrier])),
    devices: records,
    labels: labelled,
    hashes: {
      releases: hashesOf("releases"), release_changes: hashesOf("release_changes"), carriers: hashesOf("carriers"), countries: hashesOf("countries"),
      sources: hashesOf("sources"), phone_states: hashesOf("phone_states"), phones: hashesOf("phones"), names: hashesOf("names"), legacy: hashesOf("legacy"),
    },
  };
}

/** Seven columns a row: 14 rows keep a statement within D1's 100 parameters. */
const LABELS_PER_STATEMENT = 14;

/** An origin's rank in a field's trust, as SQL: lower is more trusted. Inlined, not bound: the origins are LABEL_ORIGINS'. */
const rankOf = (trust: readonly LabelOrigin[], origin: SQL): SQL =>
  sql`CASE ${origin} ${sql.raw(trust.map((o, i) => `WHEN '${o}' THEN ${i}`).join(" "))} ELSE ${sql.raw(String(trust.length))} END`;

/**
 * Labels, each replacing what its subject's field holds unless that came from an origin the field trusts more. Each is
 * checked against its field first. A publish applies them; a writer requests one.
 */
export async function writeLabels(db: IndexDb, rows: readonly Label[], updated: string): Promise<void> {
  const checked = v.parse(v.array(labelSchema), rows);
  const byField = Map.groupBy(checked, (l) => `${l.subject}\u0000${l.field}`);
  const statements = [...byField.values()].flatMap((group) => {
    const [head] = group;
    if (head === undefined) return [];
    const { trust } = labelField(head);
    return Array.from({ length: Math.ceil(group.length / LABELS_PER_STATEMENT) }, (_, i) =>
      db.insert(labels).values(group.slice(i * LABELS_PER_STATEMENT, (i + 1) * LABELS_PER_STATEMENT).map((l) => ({ ...l, updated })))
        .onConflictDoUpdate({
          target: [labels.subject, labels.code, labels.field],
          set: { value: sql`excluded.value`, origin: sql`excluded.origin`, evidence: sql`excluded.evidence`, updated: sql`excluded.updated` },
          setWhere: sql`${rankOf(trust, sql`excluded.origin`)} <= ${rankOf(trust, sql`${labels.origin}`)}`,
        }));
  });
  const [first, ...rest] = statements;
  if (first !== undefined) await db.batch([first, ...rest]);
}

/** A feed's values for one field, written where they differ from what is stored: a check runs often and values change rarely. */
export async function syncLabels<S extends LabelSubject>(
  db: IndexDb, subject: S, field: LabelFieldName<S>, listed: ReadonlyArray<Pick<Label, "code" | "value">>, evidence: string, updated: string,
): Promise<number> {
  const held = new Map((await db.select({ code: labels.code, value: labels.value, origin: labels.origin }).from(labels)
    .where(and(eq(labels.subject, subject), eq(labels.field, field)))).map((r) => [r.code, r]));
  const changed = listed.filter((n) => {
    const h = held.get(n.code);
    return h === undefined || h.origin !== "feed" || h.value !== n.value;
  });
  await writeLabels(db, changed.map((n) => v.parse(labelSchema, { subject, field, code: n.code, value: n.value, origin: "feed", evidence })), updated);
  return changed.length;
}

/** Codes the index uses that no label names: the phones releases list, the carriers named only by a source's name, the modem families. */
export async function unnamed(db: IndexDb, subject: LabelSubject): Promise<string[]> {
  const named = sql`SELECT ${labels.code} FROM ${labels} WHERE ${labels.subject} = ${subject} AND ${labels.field} = 'name'`;
  const query = {
    device: sql`SELECT DISTINCT d.value AS code FROM ${releases}, json_each(json_extract(${releases.summary}, '$.devices')) d WHERE d.value NOT IN (${named})`,
    // A carrier whose index name is one of its sources' names has no name of its own. One named for a SIM
    // selector (20404GID1=2801) has nothing a search can find.
    carrier: sql`SELECT ${carriers.id} AS code FROM ${carriers} WHERE ${carriers.kind} = 'carrier' AND ${carriers.id} NOT LIKE '%=%'
      AND json_extract(${carriers.carrier}, '$.name') IN (SELECT ${sources.name} FROM ${sources} WHERE ${sources.carrier} = ${carriers.id})
      AND ${carriers.id} NOT IN (${named})`,
    modem: sql`SELECT DISTINCT json_extract(f.value, '$.code') AS code FROM ${releases}, json_each(json_extract(${releases.summary}, '$.modemFamilies')) f
      WHERE ${releases.platform} = 'ios' AND json_extract(f.value, '$.code') NOT IN (${named})`,
  } as const satisfies Record<LabelSubject, SQL>;
  const rows = await db.all<{ code: string }>(query[subject]);
  return rows.map((r) => r.code).sort();
}

const deviceColumns = { code: devices.code, family: devices.family, released: devices.released, boards: devices.boards };

/** Every device the feeds list, or one family's. */
export function deviceRecords(db: IndexDb, family?: DecoderFamily): Promise<Device[]> {
  const all = db.select(deviceColumns).from(devices);
  return family === undefined ? all : all.where(eq(devices.family, family));
}

/** Seven columns a row: 14 rows keep a statement within D1's 100 parameters. */
const DEVICES_PER_STATEMENT = 14;

/**
 * A feed's devices, written where they differ from what is stored. A device keeps the earliest release any check has seen,
 * so one whose first builds the feed has since dropped keeps its first day.
 */
export async function syncDevices(db: IndexDb, listed: readonly ListedDevice[], updated: string): Promise<number> {
  const held = new Map((await deviceRecords(db)).map((d) => [d.code, d]));
  const changed = listed.filter((d) => {
    const h = held.get(d.code);
    return h === undefined || d.released < h.released || h.family !== d.family || JSON.stringify(h.boards) !== JSON.stringify(d.boards);
  });
  const statements = Array.from({ length: Math.ceil(changed.length / DEVICES_PER_STATEMENT) }, (_, i) =>
    db.insert(devices).values(changed.slice(i * DEVICES_PER_STATEMENT, (i + 1) * DEVICES_PER_STATEMENT).map((d) => ({ ...d, updated })))
      .onConflictDoUpdate({
        target: devices.code,
        set: {
          family: sql`excluded.family`, boards: sql`excluded.boards`, updated: sql`excluded.updated`,
          // The evidence goes with the day: a later day leaves both.
          evidence: sql`CASE WHEN excluded.released < ${devices.released} THEN excluded.evidence ELSE ${devices.evidence} END`,
          released: sql`min(${devices.released}, excluded.released)`,
        },
      }));
  const [first, ...rest] = statements;
  if (first !== undefined) await db.batch([first, ...rest]);
  return changed.length;
}
