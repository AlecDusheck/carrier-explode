/**
 * The index in D1: what pages list, link and show, written only by a publish (./delta.ts, ./apply.ts). Every row
 * carries the hash of its values and the builtAt of the publish that wrote it: a publish writes only rows whose hash
 * changed, and never over a row a later publish wrote. ../migrations is generated from this file and applied by hand
 * (`generate`, then `migrate` or `migrate:local`); the apps never migrate.
 */

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { LabelOrigin, LabelSubject } from "@carrier-explode/schema/records";
import type {
  Carrier, CarrierModem, CarrierSummary, CountrySummary, DecoderFamily, Device, FeatureState, NamedSubject, Platform, ReleaseChange, ReleasePlatform, ReleaseSummary,
  SourceKey, SourceKind, Timeline,
} from "@carrier-explode/schema/types";

const written = {
  hash: text().notNull(),
  builtAt: text("built_at").notNull(),
};

export const releases = sqliteTable("releases", {
  platform: text().$type<ReleasePlatform>().notNull(),
  id: text().notNull(),
  /** Newest first. */
  sort: integer().notNull(),
  summary: text({ mode: "json" }).$type<ReleaseSummary>().notNull(),
  ...written,
}, (t) => [primaryKey({ columns: [t.platform, t.id] }), index("releases_by_sort").on(t.platform, t.sort)]);

export const releaseChanges = sqliteTable("release_changes", {
  platform: text().$type<ReleasePlatform>().notNull(),
  release: text().notNull(),
  source: text().$type<SourceKey>().notNull(),
  change: text({ mode: "json" }).$type<ReleaseChange>().notNull(),
  ...written,
}, (t) => [primaryKey({ columns: [t.platform, t.release, t.source] })]);

export const carriers = sqliteTable("carriers", {
  id: text().primaryKey(),
  /** A country bundle's document is a carrier of kind "country", which the carrier lists leave out. */
  kind: text().$type<Exclude<SourceKind, "default">>().notNull(),
  iso: text(),
  carrier: text({ mode: "json" }).$type<Carrier>().notNull(),
  modems: text({ mode: "json" }).$type<readonly CarrierModem[]>().notNull(),
  /** A carrier's; null for a country's. */
  summary: text({ mode: "json" }).$type<CarrierSummary>(),
  ...written,
}, (t) => [index("carriers_by_kind").on(t.kind, t.iso), index("carriers_by_id").on(t.kind, t.id)]);

export const countries = sqliteTable("countries", {
  iso: text().primaryKey(),
  summary: text({ mode: "json" }).$type<CountrySummary>().notNull(),
  ...written,
});

export const sources = sqliteTable("sources", {
  key: text().$type<SourceKey>().primaryKey(),
  platform: text().$type<Platform>().notNull(),
  kind: text().$type<SourceKind>().notNull(),
  name: text().notNull(),
  carrier: text().notNull(),
  timeline: text({ mode: "json" }).$type<Timeline>().notNull(),
  ...written,
}, (t) => [index("sources_by_list").on(t.platform, t.kind, t.name), index("sources_by_carrier").on(t.carrier)]);

export const phoneStates = sqliteTable("phone_states", {
  device: text().notNull(),
  source: text().$type<SourceKey>().notNull(),
  states: text({ mode: "json" }).$type<Readonly<Record<string, FeatureState>>>().notNull(),
  ...written,
}, (t) => [primaryKey({ columns: [t.device, t.source] })]);

export const phones = sqliteTable("phones", {
  code: text().primaryKey(),
  platform: text().$type<ReleasePlatform>().notNull(),
  name: text().notNull(),
  /** Newest first. */
  sort: integer().notNull(),
  has5G: integer("has_5g", { mode: "boolean" }).notNull(),
  ...written,
});

export const names = sqliteTable("names", {
  subject: text().$type<NamedSubject>().notNull(),
  code: text().notNull(),
  name: text().notNull(),
  ...written,
}, (t) => [primaryKey({ columns: [t.subject, t.code] }), index("names_by_name").on(t.subject, t.name)]);

export const legacy = sqliteTable("legacy", {
  /** A v1 path prefix. */
  src: text().primaryKey(),
  dst: text().notNull(),
  ...written,
});

/**
 * What the feeds, people and the labels Workflow say over the data, one value per subject, code and field (schema's
 * LABEL_FIELDS). Read only by a publish, which applies them: pages read the index.
 */
export const labels = sqliteTable("labels", {
  subject: text().$type<LabelSubject>().notNull(),
  code: text().notNull(),
  field: text().notNull(),
  value: text().notNull(),
  origin: text().$type<LabelOrigin>().notNull(),
  /** The page a feed, a person or the model read it from. */
  evidence: text(),
  updated: text().notNull(),
}, (t) => [primaryKey({ columns: [t.subject, t.code, t.field] })]);

/** The devices the feeds list, as they list them: written by the feed checks, read by publishes, and for Apple's boards by normalize and pages. Names and corrections are labels. */
export const devices = sqliteTable("devices", {
  /** A Pixel's codename, an Apple product type. */
  code: text().primaryKey(),
  family: text().$type<DecoderFamily>().notNull(),
  /** The earliest the feed has given: a check never moves it later. */
  released: text().notNull(),
  /** Apple's board configs (`D93AP`); none for a Pixel. */
  boards: text({ mode: "json" }).$type<readonly string[]>().notNull(),
  /** The feed it was read from. */
  evidence: text().notNull(),
  updated: text().notNull(),
});

/** A device as a feed check lists it, with the page its release day was read from. */
export type ListedDevice = Device & Pick<typeof devices.$inferSelect, "evidence">;

/** `built_at`: the newest publish applied whole. */
export const meta = sqliteTable("meta", {
  key: text().primaryKey(),
  value: text().notNull(),
});
