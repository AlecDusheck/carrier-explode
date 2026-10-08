/**
 * The index's tables: facts per content sha or per unit, per-source derivations and the carrier link.
 * ../migrations is generated from this file and applied by hand; the apps never migrate.
 */

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type { LinkRule, ProfileFacts, ReleaseChange, SourceCopy } from "@carrier-explode/schema";
import type { LabelOrigin, LabelSubject } from "@carrier-explode/schema/records";
import type {
	Defaulted,
	Digests,
	FeatureState,
	ModemKind,
	Platform,
	ReleasePlatform,
	SourceKey,
	SourceKind,
} from "@carrier-explode/schema/types";

/** Phones a feed lists: a Pixel by codename, an Apple device by product type, a Galaxy by model. */
export const devices = sqliteTable(
	"devices",
	{
		code: text().primaryKey(),
		platform: text().$type<ReleasePlatform>().notNull(),
		/** The earliest day the feeds have given: a check never moves it later. */
		released: text().notNull(),
		/** Apple's board configs (`D93AP`), which bundles name per-phone files by; none elsewhere. */
		boards: text({ mode: "json" }).$type<readonly string[]>().notNull(),
		/** Null until the index step has read the device's newest release. */
		has5g: integer("has_5g", { mode: "boolean" }),
	},
	// Covering: a platform's devices are read from the index alone.
	(t) => [index("devices_list").on(t.platform, t.code, t.released, t.boards, t.has5g)],
);

export const labels = sqliteTable(
	"labels",
	{
		subject: text().$type<LabelSubject>().notNull(),
		code: text().notNull(),
		field: text().notNull(),
		value: text().notNull(),
		origin: text().$type<LabelOrigin>().notNull(),
		/** The page the value was read from; a person's may cite none. */
		evidence: text(),
	},
	(t) => [primaryKey({ columns: [t.subject, t.code, t.field] })],
);

/** The day the labels Workflow last searched for a code's field and found no page that gives it. */
export const labelMisses = sqliteTable(
	"label_misses",
	{
		subject: text().$type<LabelSubject>().notNull(),
		code: text().notNull(),
		field: text().notNull(),
		/** YYYY-MM-DD. */
		searched: text().notNull(),
	},
	(t) => [primaryKey({ columns: [t.subject, t.code, t.field] })],
);

/** People's corrections to SIM linking: `link` joins two sources, `split` keeps them apart. */
export const links = sqliteTable(
	"links",
	{
		a: text().$type<SourceKey>().notNull(),
		b: text().$type<SourceKey>().notNull(),
		rule: text().$type<LinkRule["rule"]>().notNull(),
		why: text().notNull(),
	},
	(t) => [primaryKey({ columns: [t.a, t.b] })],
);

export const releases = sqliteTable(
	"releases",
	{
		platform: text().$type<ReleasePlatform>().notNull(),
		id: text().notNull(),
		version: text().notNull(),
		/** iOS only: `27.2 beta 2`. */
		label: text(),
		/** YYYY-MM-DD. */
		released: text(),
		/** iOS only. */
		prerelease: integer({ mode: "boolean" }),
		/** Android only: YYYY-MM. */
		patch: text(),
		/** Newest first. */
		devices: text({ mode: "json" }).$type<readonly string[]>().notNull(),
		sourceCount: integer("source_count").notNull(),
		/** Orders a platform's releases oldest to newest, from the release's own fields. */
		sortKey: text("sort_key").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.platform, t.id] }),
		// Covering: a list page is read from the index alone, newest first.
		index("releases_list").on(
			t.platform,
			t.sortKey,
			t.id,
			t.version,
			t.label,
			t.released,
			t.prerelease,
			t.patch,
			t.devices,
			t.sourceCount,
		),
		check(
			"releases_header",
			sql`(${t.platform} = 'ios') = (${t.label} IS NOT NULL) AND (${t.platform} = 'ios') = (${t.prerelease} IS NOT NULL)
    AND (${t.platform} = 'android') = (${t.patch} IS NOT NULL)`,
		),
	],
);

/** How many facts messages each platform has had: a delayed settle message derives only if none came after its own. */
export const factsWritten = sqliteTable("facts_written", {
	platform: text().$type<ReleasePlatform>().primaryKey(),
	messages: integer().notNull(),
});

/** A modem a release ships, by its name in the release: an iOS package's, an Android firmware label. */
export const modems = sqliteTable(
	"modems",
	{
		platform: text().$type<ReleasePlatform>().notNull(),
		release: text().notNull(),
		name: text().notNull(),
		/** An iOS generation (`Mav25`), an Android vendor. */
		family: text().notNull(),
		devices: text({ mode: "json" }).$type<readonly string[]>().notNull(),
		/** The iOS package's sha, bytes and format, as its release record states them. */
		package: text(),
		size: integer(),
		kind: text().$type<ModemKind>(),
	},
	(t) => [
		primaryKey({ columns: [t.platform, t.release, t.name, t.devices] }),
		// Covering: a release's modems and their families are read from the index alone.
		index("modems_families").on(t.platform, t.release, t.name, t.devices, t.family),
		check(
			"modems_package",
			sql`(${t.platform} = 'ios') = (${t.package} IS NOT NULL)
    AND (${t.package} IS NULL) = (${t.size} IS NULL) AND (${t.package} IS NULL) = (${t.kind} IS NULL)`,
		),
	],
);

/** A modem configuration a device's modem (modems.devices) carries in a release. */
export const modemConfigs = sqliteTable(
	"modem_configs",
	{
		platform: text().$type<ReleasePlatform>().notNull(),
		release: text().notNull(),
		device: text().notNull(),
		label: text().notNull(),
		sha: text().notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.platform, t.release, t.device, t.label] }),
		// Covering: a device's configurations in a release are read from the index alone.
		index("modem_configs_by_device").on(t.platform, t.release, t.device, t.label, t.sha),
	],
);

export const otaFiles = sqliteTable("ota_files", {
	url: text().primaryKey(),
	sha: text().notNull(),
	version: text().notNull(),
	/** YYYY-MM-DD, when the feed says. */
	published: text(),
	digests: text({ mode: "json" }).$type<Digests>().notNull(),
});

/** A copy of a source's content on one line, from a release (`origin`: its id) or an OTA file (`origin`: its url). */
export const copies = sqliteTable(
	"copies",
	{
		source: text().$type<SourceKey>().notNull(),
		/** A Pixel's codename, an Apple model; empty on Apple's main line. */
		line: text().notNull(),
		sha: text().notNull(),
		/** The bundle or carrier-settings version this copy states: identical bytes reappear under new versions. */
		version: text().notNull(),
		originKind: text("origin_kind").$type<SourceCopy["kind"]>().notNull(),
		origin: text().notNull(),
		/** The OS versions an OTA file is listed for. */
		os: text({ mode: "json" }).$type<readonly string[]>(),
	},
	(t) => [
		primaryKey({ columns: [t.source, t.line, t.sha, t.version, t.originKind, t.origin] }),
		index("copies_by_origin").on(t.originKind, t.origin, t.source),
		check(
			"copies_origin",
			sql`${t.originKind} IN ('release', 'ota') AND (${t.originKind} = 'ota' OR ${t.os} IS NULL)`,
		),
	],
);

/** One distinct content of a source on one line. */
export const entries = sqliteTable(
	"entries",
	{
		source: text().$type<SourceKey>().notNull(),
		line: text().notNull(),
		/** Its place on its line as schema's timeline orders it, newest 0. */
		rank: integer().notNull(),
		slug: text().notNull(),
		version: text().notNull(),
		sha: text().notNull(),
		/** Only ever in betas. */
		beta: integer({ mode: "boolean" }).notNull(),
		/** Differs from the next older entry on its line. */
		changed: integer({ mode: "boolean" }).notNull(),
		/** YYYY-MM-DD the content first shipped; null when nothing carrying it is dated. */
		day: text(),
	},
	(t) => [
		primaryKey({ columns: [t.source, t.line, t.slug] }),
		uniqueIndex("entries_by_rank").on(t.source, t.line, t.rank),
	],
);

export const sources = sqliteTable(
	"sources",
	{
		key: text().$type<SourceKey>().primaryKey(),
		platform: text().$type<Platform>().notNull(),
		kind: text().$type<SourceKind>().notNull(),
		name: text().notNull(),
		headSha: text("head_sha").notNull(),
		/** The base profile (a Pixel build's default.pb) the newest phone reads the head over; null without one. */
		baseSha: text("base_sha"),
		/** YYYY-MM-DD the source last changed; null when nothing dates it. */
		updated: text(),
		/** Null until the link step has run, and for a country bundle. */
		carrier: text(),
	},
	// Covering: a list page and a carrier's members are read from the index alone, in its order.
	(t) => [
		index("sources_list_page").on(t.platform, t.kind, t.name, t.key, t.headSha, t.updated, t.carrier),
		index("sources_carrier_members").on(t.carrier, t.key, t.name),
	],
);

export const carriers = sqliteTable(
	"carriers",
	{
		id: text().primaryKey(),
		/** The data's name for it; null when no member displays one, so the labels Workflow names it. */
		name: text(),
		/** Lower-case ISO 3166 alpha-2. */
		iso: text(),
	},
	(t) => [index("carriers_by_iso").on(t.iso)],
);

/** How a release changed a source against its platform's previous release. */
export const changes = sqliteTable(
	"changes",
	{
		platform: text().$type<ReleasePlatform>().notNull(),
		release: text().notNull(),
		source: text().$type<SourceKey>().notNull(),
		kind: text().$type<ReleaseChange["kind"]>().notNull(),
		fromLine: text("from_line"),
		fromSlug: text("from_slug"),
		toLine: text("to_line"),
		toSlug: text("to_slug"),
	},
	(t) => [
		primaryKey({ columns: [t.platform, t.release, t.source] }),
		check(
			"changes_ends",
			sql`(${t.kind} = 'added') = (${t.fromSlug} IS NULL) AND (${t.kind} = 'removed') = (${t.toSlug} IS NULL)
    AND (${t.fromLine} IS NULL) = (${t.fromSlug} IS NULL) AND (${t.toLine} IS NULL) = (${t.toSlug} IS NULL)`,
		),
	],
);

/** What one phone an indexed release lists reads from one carrier source's head. */
export const phoneStates = sqliteTable(
	"phone_states",
	{
		device: text().notNull(),
		source: text().$type<SourceKey>().notNull(),
		states: text({ mode: "json" }).$type<Readonly<Record<string, FeatureState>>>().notNull(),
		/** What of each state the carrier leaves unset which layer under it decided. */
		defaults: text({ mode: "json" }).$type<Readonly<Record<string, Defaulted>>>().notNull(),
	},
	(t) => [primaryKey({ columns: [t.device, t.source] }), index("phone_states_by_source").on(t.source)],
);

/** A normalized object's identity, written once per sha with its sims. */
export const profiles = sqliteTable("profiles", {
	sha: text().primaryKey(),
	/** The schema (its kind's FACTS_SCHEMA) its rows were read under. */
	schema: integer().notNull(),
	kind: text().$type<ProfileFacts["kind"]>().notNull(),
	display: text(),
	iso: text({ mode: "json" }).$type<readonly string[]>().notNull(),
	/** Its kind's ProfileFacts radio. */
	radio: text({ mode: "json" }).$type<ProfileFacts["radio"]>().notNull(),
});

/** The SIM rules (matcherKey) a profile claims, or a modem configuration's selection. */
export const sims = sqliteTable(
	"sims",
	{
		sha: text().notNull(),
		matcher: text().notNull(),
	},
	(t) => [primaryKey({ columns: [t.sha, t.matcher] }), index("sims_by_matcher").on(t.matcher)],
);

/** The SIM rules (ruleKeys) a platform's current routing sends to a source: Apple's OTA manifest, the newest Pixel build's carrier_list.pb. */
export const routes = sqliteTable(
	"routes",
	{
		source: text().$type<SourceKey>().notNull(),
		matcher: text().notNull(),
	},
	(t) => [primaryKey({ columns: [t.source, t.matcher] }), index("routes_by_matcher").on(t.matcher)],
);

/**
 * The raw leaves of each source's head only, so a head move writes just the leaves that differ: `key` as the file states
 * it (`apns[0].apn`), `path` with array indexes as `[*]`.
 */
export const settings = sqliteTable(
	"settings",
	{
		source: text().$type<SourceKey>().notNull(),
		file: text().notNull(),
		key: text().notNull(),
		path: text().notNull(),
		/** Canonical JSON. */
		value: text().notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.source, t.file, t.key] }),
		index("settings_by_path").on(t.file, t.path, t.value, t.source),
	],
);

/** Each base profile's leaves, as `settings` holds a head's: what a source leaves unset, read through its base_sha. */
export const baseSettings = sqliteTable(
	"base_settings",
	{
		sha: text().notNull(),
		file: text().notNull(),
		key: text().notNull(),
		path: text().notNull(),
		/** Canonical JSON. */
		value: text().notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.sha, t.file, t.key] }),
		index("base_settings_by_path").on(t.file, t.path, t.sha),
	],
);

/** The concept values of each source's head. */
export const concepts = sqliteTable(
	"concepts",
	{
		source: text().$type<SourceKey>().notNull(),
		concept: text().notNull(),
		/** Canonical JSON: a state, a value, or null when the file leaves it unset. */
		value: text().notNull(),
	},
	(t) => [primaryKey({ columns: [t.source, t.concept] })],
);
