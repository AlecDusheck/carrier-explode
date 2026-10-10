/** Normalized objects' identity rows, once per sha; each source head's settings and concepts; and the scans over them. */

import { and, asc, eq, gte, lt, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import * as v from "valibot";

import {
	CONFIG_RADIOS,
	FACTS_SCHEMA,
	perPhone,
	type BoardRadios,
	type ConfigRadio,
	type HeadRows,
	type ProfileFacts,
	type RarityFile,
	type RarityThresholds,
} from "@carrier-explode/schema";
import { sourceKeySchema } from "@carrier-explode/schema/records";
import {
	type FeatureState,
	type Platform,
	type SourceKey,
	type SourceKind,
} from "@carrier-explode/schema/types";
import { every, jsonOf, qualified, run, type IndexDb } from "./db.ts";
import {
	baseSettings,
	concepts,
	entries,
	phoneStates,
	profiles,
	routes,
	settings,
	sims,
	sources,
} from "./schema.ts";
import { inserts, syncScope } from "./sync.ts";

const among = (shas: readonly string[]): SQL =>
	sql`${profiles.sha} IN (SELECT value FROM json_each(${JSON.stringify(shas)}))`;

/** The shas of `shas` the index has no rows for, or rows read under an older schema than their kind's. */
export async function missingProfiles(db: IndexDb, shas: readonly string[]): Promise<string[]> {
	const wanted = [...new Set(shas)];
	if (wanted.length === 0) return [];
	const held = await db
		.select({ sha: profiles.sha })
		.from(profiles)
		.where(
			and(
				among(wanted),
				or(
					and(eq(profiles.kind, "settings"), gte(profiles.schema, FACTS_SCHEMA.settings)),
					and(eq(profiles.kind, "modem"), gte(profiles.schema, FACTS_SCHEMA.modem)),
				),
			),
		);
	const have = new Set(held.map((p) => p.sha));
	return wanted.filter((s) => !have.has(s));
}

/** The radio of each of `shas`, whose rows of `kind` putProfiles has written. */
async function radiosOf(
	db: IndexDb,
	kind: ProfileFacts["kind"],
	shas: readonly string[],
): Promise<unknown[]> {
	const wanted = [...new Set(shas)];
	if (wanted.length === 0) return [];
	const rows = await db
		.select({ radio: profiles.radio })
		.from(profiles)
		.where(and(among(wanted), eq(profiles.kind, kind)));
	if (rows.length !== wanted.length)
		throw new Error(`${wanted.length - rows.length} of ${wanted.length} ${kind} profiles have no row`);
	return rows.map((r) => r.radio);
}

const boardRadiosSchema = v.record(v.string(), v.picklist(["nr", "lte"]));

/** What each of the settings profiles `shas` says of the boards its override files name. */
export async function boardRadiosOf(db: IndexDb, shas: readonly string[]): Promise<BoardRadios[]> {
	return (await radiosOf(db, "settings", shas)).map((r) => v.parse(boardRadiosSchema, r));
}

/** Each of the modem configurations `shas`' radio, its base's layers included. */
export async function configRadiosOf(db: IndexDb, shas: readonly string[]): Promise<ConfigRadio[]> {
	return (await radiosOf(db, "modem", shas)).map((r) => v.parse(v.picklist(CONFIG_RADIOS), r));
}

/** Each object's rows in place of any it had, in one transaction: a sha with a `profiles` row is complete. */
export async function putProfiles(db: IndexDb, facts: readonly ProfileFacts[]): Promise<void> {
	const shas = JSON.stringify(facts.map((f) => f.sha));
	await run(db, [
		...[sims, profiles].map((table) =>
			db.delete(table).where(sql`${table.sha} IN (SELECT value FROM json_each(${shas}))`),
		),
		...inserts(
			db,
			sims,
			facts.flatMap((f) => f.sims.map((matcher) => ({ sha: f.sha, matcher }))),
		),
		...inserts(db, profiles, facts),
	]);
}

/** A source's head's settings and concepts, writing only the leaves that differ from its previous head's. Returns whether any did. */
export async function syncHeadRows(db: IndexDb, source: SourceKey, rows: HeadRows): Promise<boolean> {
	const written = await Promise.all([
		syncScope(
			db,
			settings,
			["source", "file", "key"],
			eq(settings.source, source),
			rows.settings.map((s) => ({ ...s, source })),
		),
		syncScope(
			db,
			concepts,
			["source", "concept"],
			eq(concepts.source, source),
			rows.concepts.map((c) => ({ ...c, source })),
		),
	]);
	return written.some((w) => w.length > 0);
}

/** The SIM rules a profile or modem configuration claims, and those its platform's routing sends its source: "selected by". */
export async function selectedBy(
	db: IndexDb,
	sha: string,
	source: SourceKey,
): Promise<{ readonly claimed: readonly string[]; readonly routed: readonly string[] }> {
	const [claimed, routed] = await Promise.all([
		db.select({ matcher: sims.matcher }).from(sims).where(eq(sims.sha, sha)).orderBy(asc(sims.matcher)),
		db
			.select({ matcher: routes.matcher })
			.from(routes)
			.where(eq(routes.source, source))
			.orderBy(asc(routes.matcher)),
	]);
	return { claimed: claimed.map((r) => r.matcher), routed: routed.map((r) => r.matcher) };
}

/** A group of sources rarity and scans compare within. */
export interface Group {
	readonly platform: Platform;
	readonly kind: SourceKind;
}

/** Whether a source key is of `group`: its sources' keys are a range, `ios:carrier:` up to `ios:carrier;`. */
const keyInGroup = (key: SQLWrapper, group: Group): SQL =>
	every(gte(key, `${group.platform}:${group.kind}:`), lt(key, `${group.platform}:${group.kind};`));

/** Where a scanned source's leaves at a path come from: its head, the base profile it is read over, or nowhere. */
export const SCAN_HELD = ["own", "default", "absent"] as const;
export type ScanHeld = (typeof SCAN_HELD)[number];

export interface ScannedSource {
	readonly source: SourceKey;
	/** Its head's version; null where the index has no entry for it. */
	readonly version: string | null;
	readonly held: ScanHeld;
	/** Each leaf at the path: none when absent. */
	readonly leaves: ReadonlyArray<{ readonly key: string; readonly value: string }>;
}

const leavesBySource = (
	rows: ReadonlyArray<{ readonly source: SourceKey; readonly key: string; readonly value: string }>,
): Map<SourceKey, ScannedSource["leaves"]> =>
	new Map(
		[...Map.groupBy(rows, (r) => r.source)].map(([source, of]) => [
			source,
			of.map(({ key, value }) => ({ key, value })),
		]),
	);

/**
 * Each head of a group, with its version and its leaves at one path of one file: its own, else its base_sha's (the
 * default.pb its newest phone reads it over): the scan dialog.
 */
export async function scanSetting(
	db: IndexDb,
	group: Group,
	file: string,
	path: string,
): Promise<ScannedSource[]> {
	const version = sql<
		string | null
	>`(SELECT ${entries.version} FROM ${entries} WHERE ${qualified(entries, entries.source)} = ${qualified(sources, sources.key)} AND ${qualified(entries, entries.sha)} = ${qualified(sources, sources.headSha)}
    ORDER BY ${qualified(entries, entries.rank)} LIMIT 1)`;
	const ofGroup = every(eq(sources.platform, group.platform), eq(sources.kind, group.kind));
	const [heads, own, base] = await Promise.all([
		db.select({ source: sources.key, version }).from(sources).where(ofGroup).orderBy(asc(sources.key)),
		db
			.select({ source: settings.source, key: settings.key, value: settings.value })
			.from(sources)
			.innerJoin(
				settings,
				every(eq(settings.source, sources.key), eq(settings.file, file), eq(settings.path, path)),
			)
			.where(ofGroup)
			.orderBy(asc(settings.key)),
		db
			.select({ source: sources.key, key: baseSettings.key, value: baseSettings.value })
			.from(sources)
			.innerJoin(
				baseSettings,
				every(
					eq(baseSettings.sha, sources.baseSha),
					eq(baseSettings.file, file),
					eq(baseSettings.path, path),
				),
			)
			.where(ofGroup)
			.orderBy(asc(baseSettings.key)),
	]);
	const owned = leavesBySource(own);
	const based = leavesBySource(base);
	return heads.map(({ source, version: at }): ScannedSource => {
		const mine = owned.get(source);
		if (mine !== undefined) return { source, version: at, held: "own", leaves: mine };
		const under = based.get(source);
		return under === undefined
			? { source, version: at, held: "absent", leaves: [] }
			: { source, version: at, held: "default", leaves: under };
	});
}

/** A base profile's leaves, by its sha. Returns whether it wrote any. */
export async function putBaseRows(db: IndexDb, sha: string, rows: HeadRows["settings"]): Promise<boolean> {
	return (
		(
			await syncScope(
				db,
				baseSettings,
				["sha", "file", "key"],
				eq(baseSettings.sha, sha),
				rows.map((r) => ({ ...r, sha })),
			)
		).length > 0
	);
}

/** One source head's concepts that are not per phone, and its states on `device`; null when the phone does not read it. */
export async function headConcepts(
	db: IndexDb,
	source: SourceKey,
	device: string,
): Promise<{
	readonly values: ReadonlyArray<{ readonly concept: string; readonly value: string }>;
	readonly states: Readonly<Record<string, FeatureState>> | null;
}> {
	const [values, states] = await Promise.all([
		db
			.select({ concept: concepts.concept, value: concepts.value })
			.from(concepts)
			.where(eq(concepts.source, source))
			.orderBy(asc(concepts.concept)),
		db
			.select({ states: phoneStates.states })
			.from(phoneStates)
			.where(every(eq(phoneStates.source, source), eq(phoneStates.device, device))),
	]);
	return { values, states: states[0]?.states ?? null };
}

/**
 * What each source of a group reads for one concept. A per-phone concept comes from `device`'s phone states, with the
 * layer that decided what the carrier leaves unset (JSON); any other from each source's head.
 */
export function scanConcept(
	db: IndexDb,
	group: Group,
	concept: string,
	device: string,
): Promise<
	Array<{
		readonly source: SourceKey;
		readonly value: string;
		readonly defaulted: string | null;
	}>
> {
	const inGroup = every(eq(sources.platform, group.platform), eq(sources.kind, group.kind));
	if (!perPhone(group.kind, concept)) {
		return db
			.select({ source: sources.key, value: concepts.value, defaulted: sql<null>`NULL` })
			.from(sources)
			.innerJoin(concepts, every(eq(concepts.source, sources.key), eq(concepts.concept, concept)))
			.where(inGroup)
			.orderBy(asc(sources.key));
	}
	const at = `$."${concept}"`;
	return db
		.select({
			source: sources.key,
			value: sql<string>`json_quote(json_extract(${phoneStates.states}, ${at}))`,
			defaulted: sql<string | null>`json_extract(${phoneStates.defaults}, ${at})`,
		})
		.from(phoneStates)
		.innerJoin(sources, eq(sources.key, phoneStates.source))
		.where(every(inGroup, eq(phoneStates.device, device)))
		.orderBy(asc(sources.key));
}

const found = {
	path: v.string(),
	holders: v.number(),
	of: v.number(),
	/** The other heads holding it. */
	with: v.pipe(
		jsonOf(v.array(sourceKeySchema)),
		v.transform((keys) => keys.toSorted()),
	),
};
/** `value`: the source's own, canonical JSON; a rare key's several values (an array path's) as one array, in order. */
const rareSchema = v.object({ rare: v.picklist(["key", "value"]), value: v.string(), ...found });

/** A setting in a source's main file at most a few sources of its group share: a key almost nobody sets, or a value almost nobody picks. */
export type RareSetting = v.InferOutput<typeof rareSchema>;

/**
 * The rare settings of `source`'s head in its group's main file, but for the keys that only identify it: for each of its
 * (path, value) pairs, the heads of its group holding it, rarest first.
 */
export async function rareSettings(
	db: IndexDb,
	source: SourceKey,
	group: Group,
	judged: RarityFile,
	t: RarityThresholds,
): Promise<RareSetting[]> {
	return v.parse(v.array(rareSchema), await db.all(rarityQuery(source, group, judged, t)));
}

/**
 * The rarity query, apart so its plan can be checked. A group's heads are its sources' key range, which settings_by_path
 * ends in, so counting a (path, value)'s holders stops past maxSharers; only a rare value's path is counted in full.
 */
export function rarityQuery(
	source: SourceKey,
	group: Group,
	{ file, identity }: RarityFile,
	t: RarityThresholds,
): SQL {
	const over = t.maxSharers + 1;
	return sql`
    WITH size AS (
      SELECT count(*) AS of FROM ${sources} WHERE ${keyInGroup(sources.key, group)}
        AND EXISTS (SELECT 1 FROM ${settings} s WHERE s.source = ${sources.key} AND s.file = ${file})
    ),
    -- No path held by the group has more distinct values and still counts as a setting.
    cap AS (
      SELECT max(${t.maxDistinctFloor}, of * 1.0 / ${t.holdersPerDistinct}) AS values_at_most FROM size
    ),
    own AS (
      -- The unary + keeps SQLite off settings_by_path, whose (file) prefix would read every source's file.
      SELECT DISTINCT s.path, s.value FROM ${settings} s WHERE s.source = ${source} AND +s.file = ${file}
        AND substr(s.path, 1, min(instr(s.path || '.', '.'), instr(s.path || '[', '[')) - 1) NOT IN (SELECT value FROM json_each(${JSON.stringify(identity)}))
    ),
    rare_keys AS MATERIALIZED (
      SELECT o.path FROM (SELECT DISTINCT path FROM own) o, size WHERE size.of >= ${t.minGroupForRareKey}
        AND (SELECT count(*) FROM (SELECT DISTINCT s.source FROM ${settings} s WHERE s.file = ${file} AND s.path = o.path AND ${keyInGroup(sql`s.source`, group)} LIMIT ${over})) <= ${t.maxSharers}
    ),
    few AS MATERIALIZED (
      SELECT o.path, o.value FROM own o WHERE o.path NOT IN (SELECT path FROM rare_keys)
        AND (SELECT count(*) FROM (SELECT DISTINCT s.source FROM ${settings} s WHERE s.file = ${file} AND s.path = o.path AND s.value = o.value AND ${keyInGroup(sql`s.source`, group)} LIMIT ${over})) <= ${t.maxSharers}
    ),
    held AS (
      SELECT DISTINCT s.source, s.path, s.value FROM ${settings} s
      WHERE s.file = ${file} AND s.path IN (
        SELECT path FROM rare_keys
        UNION
        SELECT f.path FROM (SELECT DISTINCT path FROM few) f, cap
        WHERE (SELECT count(*) FROM (SELECT DISTINCT s.value FROM ${settings} s WHERE s.file = ${file} AND s.path = f.path AND ${keyInGroup(sql`s.source`, group)}
          LIMIT (SELECT cast(values_at_most AS integer) + 1 FROM cap))) <= cap.values_at_most
      ) AND ${keyInGroup(sql`s.source`, group)}
    ),
    paths AS (
      SELECT path, count(DISTINCT source) AS present, count(DISTINCT value) AS distinct_values,
        json_group_array(DISTINCT source) FILTER (WHERE source <> ${source}) AS sharers
      FROM held GROUP BY path
    ),
    found AS (
      SELECT 'key' AS rare, p.path,
        (SELECT CASE count(*) WHEN 1 THEN max(v.value) ELSE json_group_array(json(v.value)) END FROM (
          SELECT s.value FROM ${settings} s WHERE s.source = ${source} AND s.file = ${file} AND s.path = p.path ORDER BY s.key
        ) v) AS value,
        p.present AS holders, p.sharers AS sharers
      FROM paths p WHERE p.path IN (SELECT path FROM rare_keys)
      UNION ALL
      SELECT 'value', f.path, f.value, count(*), json_group_array(h.source) FILTER (WHERE h.source <> ${source})
      FROM few f JOIN paths p ON p.path = f.path JOIN held h ON h.path = f.path AND h.value = f.value
      WHERE p.present >= ${t.minHolders} AND p.distinct_values <= max(${t.maxDistinctFloor}, p.present * 1.0 / ${t.holdersPerDistinct})
      GROUP BY f.path, f.value
    ),
    ranked AS (
      SELECT *, row_number() OVER (
        PARTITION BY substr(path, 1, min(instr(path || '.', '.'), instr(path || '[', '[')) - 1)
        ORDER BY holders, length(path), path, value) - 1 AS before
      FROM found
    )
    SELECT rare, path, value, holders, size.of AS of, coalesce(sharers, '[]') AS "with" FROM ranked, size
    WHERE before < CASE rare WHEN 'value' THEN ${t.valuesPerTop} ELSE ${t.keysPerTop} END
    ORDER BY holders, length(path), path, value LIMIT ${t.keep}`;
}
