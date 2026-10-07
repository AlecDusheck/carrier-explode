/** Sources: their copies, the timelines derived from them, their heads and what phones read from them. */

import { and, asc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import * as v from "valibot";

import type { phoneStates as derivePhoneStates, SourceCopy, TimelineEntry } from "@carrier-explode/schema";
import { defaultedSchema, sourceKeySchema } from "@carrier-explode/schema/records";
import {
	FEATURE_STATES,
	parseRuleKey,
	parseSourceKey,
	sourceKey,
	type Platform,
	type SourceKey,
	type SourceKind,
} from "@carrier-explode/schema/types";
import { every, jsonOf, qualified, type IndexDb, type Page } from "./db.ts";
import { carrierName, contains, givenName } from "./carriers.ts";
import {
	carriers,
	copies,
	entries,
	otaFiles,
	phoneStates,
	profiles,
	releases,
	routes,
	sims,
	sources,
} from "./schema.ts";
import { syncScope } from "./sync.ts";

export type OtaFileRow = typeof otaFiles.$inferSelect;
export type SourceRow = Omit<typeof sources.$inferSelect, "carrier">;
export type PhoneStatesRow = ReturnType<typeof derivePhoneStates>[number];

/** An OTA file as its unit's record states it. Returns whether it changed. */
export async function putOtaFile(db: IndexDb, file: OtaFileRow): Promise<boolean> {
	return (await syncScope(db, otaFiles, ["url"], eq(otaFiles.url, file.url), [file])).length > 0;
}

type Copied = Pick<typeof copies.$inferSelect, "source" | "line" | "sha" | "version">;

/** The copies one release record or one OTA file holds, as its unit's record states them. A release record covers `lines`: a Pixel's, its device's. */
export type Holding =
	| {
			readonly kind: "release";
			readonly id: string;
			readonly lines: readonly [string, ...string[]];
			readonly copies: readonly Copied[];
	  }
	| {
			readonly kind: "ota";
			readonly url: string;
			readonly copies: ReadonlyArray<Copied & { readonly os: readonly string[] }>;
	  };

const COPY_KEY = ["source", "line", "sha", "version", "originKind", "origin"] as const;

/** Writes a release record's or OTA file's copies, leaving the release's other lines as they are. Returns the sources whose copies changed. */
export async function syncCopies(db: IndexDb, holding: Holding): Promise<SourceKey[]> {
	const origin = holding.kind === "release" ? holding.id : holding.url;
	const ofOrigin = every(eq(copies.originKind, holding.kind), eq(copies.origin, origin));
	const written =
		holding.kind === "ota"
			? await syncScope(
					db,
					copies,
					COPY_KEY,
					ofOrigin,
					holding.copies.map((c) => ({ ...c, originKind: holding.kind, origin })),
				)
			: await syncScope(
					db,
					copies,
					COPY_KEY,
					every(ofOrigin, inArray(copies.line, [...holding.lines])),
					holding.copies.map((c) => {
						if (!holding.lines.includes(c.line))
							throw new Error(
								`${origin}: a copy of ${c.source} on line "${c.line}", which its record does not cover`,
							);
						return { ...c, originKind: holding.kind, origin, os: null };
					}),
				);
	return [...new Set(written.map((c) => c.source))].toSorted();
}

const releaseFields = {
	id: releases.id,
	version: releases.version,
	label: releases.label,
	released: releases.released,
	prerelease: releases.prerelease,
	sortKey: releases.sortKey,
};
const otaFields = {
	url: otaFiles.url,
	version: otaFiles.version,
	published: otaFiles.published,
	digests: otaFiles.digests,
};

/** A copy as schema's timeline reads it, with what a version page's "Shipped in" shows of its release or OTA file. */
export type OrderedCopy = SourceCopy &
	(
		| {
				readonly kind: "release";
				readonly release: Pick<typeof releases.$inferSelect, keyof typeof releaseFields>;
		  }
		| {
				readonly kind: "ota";
				readonly os: readonly string[];
				readonly file: Pick<OtaFileRow, keyof typeof otaFields>;
		  }
	);

/** Every copy of a source, for deriving its timeline and for a version page's "Shipped in". */
export async function copiesOf(db: IndexDb, source: SourceKey, platform: Platform): Promise<OrderedCopy[]> {
	const rows = await db
		.select({
			line: copies.line,
			sha: copies.sha,
			version: copies.version,
			kind: copies.originKind,
			origin: copies.origin,
			os: copies.os,
			release: releaseFields,
			file: otaFields,
		})
		.from(copies)
		.leftJoin(
			releases,
			and(
				eq(copies.originKind, "release"),
				sql`${releases.platform} = ${platform}`,
				eq(releases.id, copies.origin),
			),
		)
		.leftJoin(otaFiles, and(eq(copies.originKind, "ota"), eq(otaFiles.url, copies.origin)))
		.where(eq(copies.source, source))
		.orderBy(
			asc(copies.line),
			asc(copies.originKind),
			asc(copies.origin),
			asc(copies.sha),
			asc(copies.version),
		);
	return rows.map(({ line, sha, version, kind, origin, os, release, file }): OrderedCopy => {
		if (kind === "release" && release !== null) return { kind, line, sha, version, release };
		if (kind === "ota" && file !== null && os !== null) return { kind, line, sha, version, os, file };
		throw new Error(`${source}: a copy from ${kind} ${origin}, which the index has no row for`);
	});
}

/** A source's timeline as schema's sourceTimeline derived it, each entry ranked by its place on its line. Returns whether it changed. */
export async function syncEntries(
	db: IndexDb,
	source: SourceKey,
	timeline: readonly TimelineEntry[],
): Promise<boolean> {
	const placed = new Map<string, number>();
	const rows = timeline.map((e) => {
		const rank = placed.get(e.line) ?? 0;
		placed.set(e.line, rank + 1);
		return { ...e, source, rank };
	});
	return (
		(await syncScope(db, entries, ["source", "line", "slug"], eq(entries.source, source), rows)).length > 0
	);
}

/** A source's head as derived from its timeline, leaving its carrier to the link step. Returns whether it changed. */
export async function putSource(db: IndexDb, head: SourceRow): Promise<boolean> {
	const differs = sql`${sources.headSha} IS NOT excluded.head_sha OR ${sources.baseSha} IS NOT excluded.base_sha OR ${sources.updated} IS NOT excluded.updated OR ${sources.name} IS NOT excluded.name`;
	const written = await db
		.insert(sources)
		.values({ ...head, carrier: null })
		.onConflictDoUpdate({
			target: sources.key,
			set: { name: head.name, headSha: head.headSha, baseSha: head.baseSha, updated: head.updated },
			setWhere: differs,
		})
		.returning({ key: sources.key });
	return written.length > 0;
}

/** What the phones indexed releases list read from a source's head. Returns whether it changed. */
export async function syncPhoneStates(
	db: IndexDb,
	source: SourceKey,
	derived: readonly PhoneStatesRow[],
): Promise<boolean> {
	return (
		(
			await syncScope(
				db,
				phoneStates,
				["device", "source"],
				eq(phoneStates.source, source),
				derived.map((s) => ({ ...s, source })),
			)
		).length > 0
	);
}

/**
 * One routing table, whole: the SIM rules (schema's ruleKeys) it sends to each source of `platforms`, which it alone routes.
 * Returns the sources whose routes changed.
 */
export async function syncRoutes(
	db: IndexDb,
	platforms: readonly [Platform, ...Platform[]],
	routed: Readonly<Record<SourceKey, readonly string[]>>,
): Promise<SourceKey[]> {
	const rows = Object.entries(routed).flatMap(([key, matchers]) => {
		const ref = parseSourceKey(key);
		if (ref === undefined || !platforms.includes(ref.platform))
			throw new Error(`routes: ${key} is not a source of ${platforms.join(", ")}`);
		const unruled = matchers.find((m) => parseRuleKey(m) === undefined);
		if (unruled !== undefined) throw new Error(`routes: ${key}'s ${unruled} is no ruleKey`);
		return [...new Set(matchers)].map((matcher) => ({ source: sourceKey(ref), matcher }));
	});
	const ofPlatforms = sql`substr(${routes.source}, 1, instr(${routes.source}, ':') - 1) IN ${platforms}`;
	const written = await syncScope(db, routes, ["source", "matcher"], ofPlatforms, rows);
	return [...new Set(written.map((r) => r.source))].toSorted();
}

const memberKeys = v.pipe(jsonOf(v.array(sourceKeySchema)), v.readonly());

const listed = {
	key: sources.key,
	platform: sources.platform,
	kind: sources.kind,
	name: sources.name,
	headSha: sources.headSha,
	updated: sources.updated,
	carrier: sources.carrier,
	carrierName: sql<
		string | null
	>`CASE WHEN ${carriers.id} IS NULL THEN NULL ELSE ${carrierName(carriers.id, carriers.name)} END`,
	carrierNamed: sql<number>`(${givenName(carriers.id, carriers.name)} IS NOT NULL)`.mapWith(Boolean),
	/** Its head's own first country, never its carrier's, which another platform's source may have given it. */
	cc: sql<
		string | null
	>`(SELECT json_extract(p.iso, '$[0]') FROM ${profiles} p WHERE p.sha = ${qualified(sources, sources.headSha)})`,
	/** Every source of its carrier, by key; none without a carrier. */
	members:
		sql<string>`(SELECT json_group_array(o.key) FROM (SELECT o.key FROM ${sources} o WHERE o.carrier = ${qualified(sources, sources.carrier)} ORDER BY o.key) o)`.mapWith(
			(s: string) => v.parse(memberKeys, s),
		),
};

const listing = (db: IndexDb) =>
	db.select(listed).from(sources).leftJoin(carriers, eq(carriers.id, sources.carrier)).$dynamic();

/** A source as lists show it, with its carrier's name, country, members and newest change. */
export type ListedSource = Awaited<ReturnType<typeof listing>>[number];

/** Whether a source is in a country: its head names it, or its carrier is that country's. */
const inCountry = (iso: string): SQL =>
	sql`(${carriers.iso} = ${iso} OR EXISTS (SELECT 1 FROM ${profiles} p, json_each(p.iso) j WHERE p.sha = ${qualified(sources, sources.headSha)} AND j.value = ${iso}))`;

/** What a source list narrows to; a null field narrows nothing. */
export interface SourceFilter {
	/** Part of its native name or its carrier's name, in any case. */
	readonly q: string | null;
	readonly country: string | null;
}

export const EVERY_SOURCE: SourceFilter = { q: null, country: null };

/** One platform's sources of one kind, by name, a page at a time: lists, the sitemap, the compare picker and the API. */
export function sourceList(
	db: IndexDb,
	platform: Platform,
	kind: SourceKind,
	page: Page<string>,
	filter: SourceFilter = EVERY_SOURCE,
): Promise<ListedSource[]> {
	return listing(db)
		.where(
			every(
				eq(sources.platform, platform),
				eq(sources.kind, kind),
				page.after === null ? sql`1` : gt(sources.name, page.after),
				...(filter.country === null ? [] : [inCountry(filter.country)]),
				...(filter.q === null
					? []
					: [
							sql`(${contains(sources.name, filter.q)} OR (${carriers.id} IS NOT NULL AND ${contains(carrierName(carriers.id, carriers.name), filter.q)}))`,
						]),
			),
		)
		.orderBy(asc(sources.name))
		.limit(page.take);
}

/** A carrier's sources, by key, with their heads. */
export function carrierSources(db: IndexDb, carrier: string): Promise<SourceRow[]> {
	return db
		.select({
			key: sources.key,
			platform: sources.platform,
			kind: sources.kind,
			name: sources.name,
			headSha: sources.headSha,
			baseSha: sources.baseSha,
			updated: sources.updated,
		})
		.from(sources)
		.where(eq(sources.carrier, carrier))
		.orderBy(asc(sources.key));
}

/** What `devices` read from each of a carrier's sources, by source and device. */
export function carrierStates(
	db: IndexDb,
	carrier: string,
	devices: readonly string[],
): Promise<Array<typeof phoneStates.$inferSelect>> {
	return db
		.select({
			device: phoneStates.device,
			source: phoneStates.source,
			states: phoneStates.states,
			defaults: phoneStates.defaults,
		})
		.from(phoneStates)
		.innerJoin(sources, eq(sources.key, phoneStates.source))
		.where(every(eq(sources.carrier, carrier), inArray(phoneStates.device, [...devices])))
		.orderBy(asc(phoneStates.source), asc(phoneStates.device));
}

/** `unset`: the phone reads the source, and nothing in it or under it decides the feature. */
export const SCANNED_STATES = [...FEATURE_STATES, "unset"] as const;
export type ScannedState = (typeof SCANNED_STATES)[number];

/** What a feature scan narrows to; a null field narrows nothing. */
export interface FeatureFilter {
	readonly feature: string;
	/** At most one a platform, so each source has one row. */
	readonly devices: readonly string[];
	readonly country: string | null;
	readonly state: ScannedState | null;
}

const featureRowSchema = v.object({
	source: sourceKeySchema,
	device: v.string(),
	state: v.nullable(v.picklist(FEATURE_STATES)),
	defaulted: v.nullable(jsonOf(defaultedSchema)),
	carrier: v.nullable(v.string()),
	carrierName: v.nullable(v.string()),
});

/** A carrier source's state of one feature on one phone, and the layer under it that decided it. */
export type FeatureRow = v.InferOutput<typeof featureRowSchema>;

/** Each carrier source's state of one feature on the phones of `filter`, by source, a page at a time. */
export async function featureStates(
	db: IndexDb,
	filter: FeatureFilter,
	page: Page<SourceKey>,
): Promise<FeatureRow[]> {
	const at = `$."${filter.feature}"`;
	const state = sql`json_extract(${phoneStates.states}, ${at})`;
	const rows = await db
		.select({
			source: phoneStates.source,
			device: phoneStates.device,
			state: sql<string | null>`${state}`,
			defaulted: sql<string | null>`json_extract(${phoneStates.defaults}, ${at})`,
			carrier: sources.carrier,
			carrierName: sql<
				string | null
			>`CASE WHEN ${carriers.id} IS NULL THEN NULL ELSE ${carrierName(carriers.id, carriers.name)} END`,
		})
		.from(phoneStates)
		.innerJoin(sources, eq(sources.key, phoneStates.source))
		.leftJoin(carriers, eq(carriers.id, sources.carrier))
		.where(
			every(
				inArray(phoneStates.device, [...filter.devices]),
				page.after === null ? sql`1` : gt(phoneStates.source, page.after),
				...(filter.country === null ? [] : [inCountry(filter.country)]),
				...(filter.state === null
					? []
					: [filter.state === "unset" ? sql`${state} IS NULL` : sql`${state} = ${filter.state}`]),
			),
		)
		.orderBy(asc(phoneStates.source))
		.limit(page.take);
	return v.parse(v.array(featureRowSchema), rows);
}

/** Where a rule that selects a SIM comes from: the source's head claims it, or its platform's routing sends it there. */
export const RULE_VIAS = ["claimed", "routed"] as const;

const simRuleSchema = v.object({
	source: sourceKeySchema,
	matcher: v.string(),
	via: v.picklist(RULE_VIAS),
	carrier: v.nullable(v.string()),
	carrierName: v.nullable(v.string()),
});

/** A rule a source's head claims or its routing sends it, with the source's carrier. */
export type SimRuleRow = v.InferOutput<typeof simRuleSchema>;

/** Every rule on one MCC-MNC, and every ICCID-prefix route `iccid` starts with: what a SIM could select. */
export async function rulesOnPlmn(db: IndexDb, mccmnc: string, iccid: string | null): Promise<SimRuleRow[]> {
	// A key range, which an index serves: a qualified rule is `<mccmnc>|…`, and `}` follows `|`.
	const onPlmn = (matcher: SQL): SQL =>
		sql`(${matcher} = ${mccmnc} OR (${matcher} >= ${`${mccmnc}|`} AND ${matcher} < ${`${mccmnc}}`}))`;
	const byIccid =
		iccid === null
			? sql`0`
			: sql`(r.matcher >= 'iccid:' AND r.matcher < 'iccid;' AND substr(${iccid}, 1, length(r.matcher) - 6) = substr(r.matcher, 7))`;
	const rows = await db.all(sql`
    WITH matched AS (
      SELECT s.key AS source, m.matcher, 'claimed' AS via FROM ${sims} m JOIN ${sources} s ON s.head_sha = m.sha WHERE ${onPlmn(sql`m.matcher`)}
      UNION
      SELECT r.source, r.matcher, 'routed' FROM ${routes} r WHERE ${onPlmn(sql`r.matcher`)} OR ${byIccid}
    )
    SELECT x.source, x.matcher, x.via, s.carrier,
      CASE WHEN c.id IS NULL THEN NULL ELSE ${carrierName(sql`c.id`, sql`c.name`)} END AS carrierName
    FROM matched x JOIN ${sources} s ON s.key = x.source LEFT JOIN ${carriers} c ON c.id = s.carrier
    ORDER BY x.source, x.matcher, x.via`);
	return v.parse(v.array(simRuleSchema), rows);
}

/** The iPhone bundles Apple's manifest routes some PLMNs to: by the bare MCC-MNC, and only by a qualifier on it. */
export interface RoutedBundles {
	readonly bundles: readonly SourceKey<"ios">[];
	readonly mvnoBundles: readonly SourceKey<"ios">[];
}

const routedRowSchema = v.object({ group: v.string(), source: sourceKeySchema, bare: v.picklist([0, 1]) });

/** Each group's RoutedBundles, its PLMNs (MCC-MNC digits) taken together. */
export async function routedBundles(
	db: IndexDb,
	groups: Readonly<Record<string, readonly string[]>>,
): Promise<Record<string, RoutedBundles>> {
	const pairs = Object.entries(groups).flatMap(([group, plmns]) => plmns.map((p) => [group, p]));
	// A qualified rule is `<mccmnc>|…`, and `}` follows `|`: a key range, which routes_by_matcher serves.
	const rows = await db.all(sql`
    WITH g AS (SELECT json_extract(value, '$[0]') AS grp, json_extract(value, '$[1]') AS plmn FROM json_each(${JSON.stringify(pairs)}))
    SELECT DISTINCT g.grp AS "group", r.source, r.matcher = g.plmn AS bare
    FROM g JOIN ${routes} r ON r.matcher = g.plmn OR (r.matcher >= g.plmn || '|' AND r.matcher < g.plmn || '}')
    WHERE r.source >= 'ios:' AND r.source < 'ios;'
    ORDER BY r.source`);
	const out: Record<string, { bundles: Set<SourceKey<"ios">>; mvnos: Set<SourceKey<"ios">> }> = {};
	for (const r of v.parse(v.array(routedRowSchema), rows)) {
		const ref = parseSourceKey(r.source);
		if (ref?.platform !== "ios") throw new Error(`routes: ${r.source} is not an iOS source`);
		const g = (out[r.group] ??= { bundles: new Set(), mvnos: new Set() });
		(r.bare ? g.bundles : g.mvnos).add(sourceKey({ ...ref, platform: "ios" }));
	}
	return Object.fromEntries(
		Object.keys(groups).map((group) => {
			const { bundles, mvnos } = out[group] ?? { bundles: new Set(), mvnos: new Set() };
			return [group, { bundles: [...bundles], mvnoBundles: [...mvnos].filter((k) => !bundles.has(k)) }];
		}),
	);
}

/** The SIM rules (ruleKeys) the routing sends each of one platform's sources, by source and rule. */
export function platformRoutes(
	db: IndexDb,
	platform: Platform,
): Promise<Array<{ readonly source: SourceKey; readonly matcher: string }>> {
	return (
		db
			.select({ source: routes.source, matcher: routes.matcher })
			.from(routes)
			// A key range, which the primary key serves; LIKE is case-insensitive and would scan.
			.where(sql`${routes.source} >= ${`${platform}:`} AND ${routes.source} < ${`${platform};`}`)
			.orderBy(asc(routes.source), asc(routes.matcher))
	);
}

/** Every source of `platforms` some copy is of, by key: what re-deriving them derives. */
export async function sourceKeys(db: IndexDb, platforms: readonly Platform[]): Promise<SourceKey[]> {
	const rows = await db
		.selectDistinct({ key: copies.source })
		.from(copies)
		.where(inArray(sql`substr(${copies.source}, 1, instr(${copies.source}, ':') - 1)`, [...platforms]))
		.orderBy(asc(copies.source));
	return rows.map((r) => r.key);
}

/** A source header: the source, its carrier and its head's identity. */
export async function sourceOf(
	db: IndexDb,
	key: SourceKey,
): Promise<
	| (ListedSource & Pick<SourceRow, "baseSha"> & Pick<typeof profiles.$inferSelect, "display" | "iso">)
	| undefined
> {
	return db
		.select({ ...listed, baseSha: sources.baseSha, display: profiles.display, iso: profiles.iso })
		.from(sources)
		.leftJoin(carriers, eq(carriers.id, sources.carrier))
		.innerJoin(profiles, eq(profiles.sha, sources.headSha))
		.where(eq(sources.key, key))
		.get();
}

/** A source's timeline as schema ordered it: each line's entries, newest first. */
export function entriesOf(db: IndexDb, source: SourceKey): Promise<TimelineEntry[]> {
	return db
		.select({
			line: entries.line,
			slug: entries.slug,
			version: entries.version,
			sha: entries.sha,
			beta: entries.beta,
			changed: entries.changed,
			day: entries.day,
		})
		.from(entries)
		.where(eq(entries.source, source))
		.orderBy(asc(entries.line), asc(entries.rank));
}

/** What one phone reads from each carrier source, by source, a page at a time. */
export function statesOn(
	db: IndexDb,
	device: string,
	page: Page<SourceKey>,
): Promise<Array<Omit<typeof phoneStates.$inferSelect, "device">>> {
	return db
		.select({ source: phoneStates.source, states: phoneStates.states, defaults: phoneStates.defaults })
		.from(phoneStates)
		.where(
			every(
				eq(phoneStates.device, device),
				page.after === null ? sql`1` : gt(phoneStates.source, page.after),
			),
		)
		.orderBy(asc(phoneStates.source))
		.limit(page.take);
}
