/** Carriers: linked from sources' head identities by the link step, read by carrier and country pages. */

import { and, asc, eq, gt, inArray, isNotNull, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import * as v from "valibot";

import {
	identifies,
	membersByPrimacy,
	modemFamilyName,
	type Linked,
	type linkCarriers,
	type LinkRule,
} from "@carrier-explode/schema";
import { sourceKeySchema } from "@carrier-explode/schema/records";
import {
	PLATFORMS,
	RELEASE_PLATFORMS,
	shipsKind,
	type Platform,
	type SourceKey,
} from "@carrier-explode/schema/types";
import { diff, every, jsonOf, qualified, run, type IndexDb, type Page } from "./db.ts";
import { upserts } from "./sync.ts";
import { labelled } from "./labels.ts";
import {
	carriers,
	links,
	modemConfigs,
	modems,
	profiles,
	releases,
	routes,
	sims,
	sources,
} from "./schema.ts";

/** A carrier's name as pages show it: a person's label on it, else the data's, else a feed's or model's, else its first source's name. */
export const carrierName = (
	id: SQLWrapper,
	name: SQLWrapper,
): SQL<string> => sql<string>`coalesce(${givenName(id, name)},
  (SELECT ${sources.name} FROM ${sources} WHERE ${sources.carrier} = ${id} ORDER BY ${sources.key} LIMIT 1), ${id})`;

/** A carrier's name when a label or the data gives one, before carrierName falls back to a member's file name. */
export const givenName = (id: SQLWrapper, name: SQLWrapper): SQL<string | null> =>
	labelled("carrier", "name", id, name);

/** What linking reads of a source: its head's identity, the SIM rules its platform's routing sends it, and its carrier. */
export type HeadIdentity = Parameters<typeof linkCarriers>[0][number];

const grouped = (
	rows: ReadonlyArray<{ readonly key: string; readonly matcher: string }>,
): Map<string, string[]> => {
	const out = new Map<string, string[]>();
	for (const r of rows) out.set(r.key, [...(out.get(r.key) ?? []), r.matcher]);
	return out;
};

/** The head identities of the sources `of` selects, or of every source. */
async function identities(db: IndexDb, of: SQL | undefined): Promise<HeadIdentity[]> {
	const [heads, claimed, routed] = await Promise.all([
		db
			.select({ key: sources.key, carrier: sources.carrier, display: profiles.display, iso: profiles.iso })
			.from(sources)
			.innerJoin(profiles, eq(profiles.sha, sources.headSha))
			.where(of)
			.orderBy(asc(sources.key)),
		db
			.select({ key: sources.key, matcher: sims.matcher })
			.from(sources)
			.innerJoin(sims, eq(sims.sha, sources.headSha))
			.where(of)
			.orderBy(asc(sims.matcher)),
		db
			.select({ key: routes.source, matcher: routes.matcher })
			.from(routes)
			.innerJoin(sources, eq(sources.key, routes.source))
			.where(of)
			.orderBy(asc(routes.matcher)),
	]);
	const simsOf = grouped(claimed),
		routesOf = grouped(routed);
	return heads.map((h) =>
		Object.assign(h, { sims: simsOf.get(h.key) ?? [], routes: routesOf.get(h.key) ?? [] }),
	);
}

/** Every source's head identity, for the link step. */
export const headIdentities = (db: IndexDb): Promise<HeadIdentity[]> => identities(db, undefined);

/** A carrier's sources as linking ranks them: each platform's primary first. */
export const carrierMembers = async (db: IndexDb, id: string): Promise<SourceKey[]> =>
	membersByPrimacy(await identities(db, eq(sources.carrier, id)));

/** People's link and split rules. */
export function linkRules(db: IndexDb): Promise<LinkRule[]> {
	return db.select().from(links);
}

/** Writes only the carriers and source carriers that changed, and deletes carriers nothing links any more. Returns the changed ids. */
export async function writeLinked(db: IndexDb, linked: Linked): Promise<string[]> {
	const [held, assigned] = await Promise.all([
		db.select().from(carriers),
		db.select({ key: sources.key, carrier: sources.carrier }).from(sources),
	]);
	const { put, gone } = diff(held, linked.carriers, (c) => c.id);
	const moved = assigned.flatMap((s) => {
		const carrier = linked.members[s.key] ?? null;
		return carrier === s.carrier ? [] : [{ key: s.key, carrier, was: s.carrier }];
	});
	const goneIds = JSON.stringify(gone.map((c) => c.id));
	const movedTo = JSON.stringify(moved.map((s) => [s.key, s.carrier]));
	await run(db, [
		...(gone.length
			? [db.delete(carriers).where(sql`${carriers.id} IN (SELECT value FROM json_each(${goneIds}))`)]
			: []),
		...upserts(db, carriers, ["id"], ["name", "iso"], put),
		...(moved.length
			? [
					db.run(
						sql`UPDATE ${sources} SET carrier = json_extract(m.value, '$[1]') FROM json_each(${movedTo}) m WHERE ${qualified(sources, sources.key)} = json_extract(m.value, '$[0]')`,
					),
				]
			: []),
	]);
	const ids = [...put, ...gone]
		.map((c) => c.id)
		.concat(moved.flatMap((s) => [s.carrier, s.was].filter((c) => c !== null)));
	return [...new Set(ids)].toSorted();
}

/** A carrier as lists show it, with the platforms its sources ship on and the newest day any changed. */
const summary = {
	id: carriers.id,
	name: carrierName(carriers.id, carriers.name),
	iso: carriers.iso,
	platforms: sql<string>`json_group_array(DISTINCT ${sources.platform})`.mapWith((s: string) =>
		v.parse(jsonOf(v.array(v.picklist(PLATFORMS))), s).toSorted(),
	),
	updated: sql<string | null>`max(${sources.updated})`,
};

const summaries = (db: IndexDb) =>
	db.select(summary).from(carriers).innerJoin(sources, eq(sources.carrier, carriers.id)).$dynamic();

export type ShownCarrier = Awaited<ReturnType<typeof summaries>>[number];

/** What a carrier list narrows to; a null field narrows nothing. */
export interface CarrierFilter {
	/** Part of its name or id, or of any of its sources' native names, in any case. */
	readonly q: string | null;
	readonly country: string | null;
	/** Carriers with a source on it. */
	readonly platform: Platform | null;
}

export const EVERY_CARRIER: CarrierFilter = { q: null, country: null, platform: null };

/** Whether `text` holds `q`, in any case; instr, so `%` and `_` in `q` are plain characters. */
export const contains = (text: SQLWrapper, q: string): SQL => sql`instr(lower(${text}), lower(${q})) > 0`;

function carrierWhere(filter: CarrierFilter): SQL[] {
	const id = qualified(carriers, carriers.id);
	const member = (condition: SQL): SQL =>
		sql`EXISTS (SELECT 1 FROM ${sources} o WHERE o.carrier = ${id} AND ${condition})`;
	return [
		...(filter.country === null ? [] : [eq(carriers.iso, filter.country)]),
		...(filter.platform === null ? [] : [member(sql`o.platform = ${filter.platform}`)]),
		...(filter.q === null
			? []
			: [
					sql`(${contains(carrierName(id, qualified(carriers, carriers.name)), filter.q)} OR ${contains(id, filter.q)} OR ${member(contains(sql`o.name`, filter.q))})`,
				]),
	];
}

/** Carriers by id, a page at a time. */
export function carrierList(
	db: IndexDb,
	page: Page<string>,
	filter: CarrierFilter = EVERY_CARRIER,
): Promise<ShownCarrier[]> {
	return summaries(db)
		.where(and(...(page.after === null ? [] : [gt(carriers.id, page.after)]), ...carrierWhere(filter)))
		.groupBy(carriers.id)
		.orderBy(asc(carriers.id))
		.limit(page.take);
}

/** A carrier and its sources. */
export async function carrierOf(
	db: IndexDb,
	id: string,
): Promise<(ShownCarrier & { readonly members: readonly SourceKey[] }) | undefined> {
	const [carrier, members] = await Promise.all([
		summaries(db).where(eq(carriers.id, id)).groupBy(carriers.id).get(),
		db.select({ key: sources.key }).from(sources).where(eq(sources.carrier, id)).orderBy(asc(sources.key)),
	]);
	return carrier === undefined ? undefined : { ...carrier, members: members.map((m) => m.key) };
}

/** A country's carriers, by name. */
export function countryCarriers(db: IndexDb, iso: string): Promise<ShownCarrier[]> {
	return summaries(db).where(eq(carriers.iso, iso)).groupBy(carriers.id).orderBy(asc(summary.name));
}

const countrySchema = v.object({
	iso: v.string(),
	carriers: v.number(),
	sources: jsonOf(v.array(sourceKeySchema)),
});

/** A country: how many carriers it has, and the country bundles that name it. */
export type ShownCountry = v.InferOutput<typeof countrySchema>;

/** The platforms that ship country bundles, so the lookup is by sources_list_page. */
const COUNTRY_PLATFORMS = PLATFORMS.filter((p) => shipsKind(p, "country"));

/** Countries whose iso fits `which`, by iso, at most `take`: the carriers' and the country bundles', grouped. */
async function countries(db: IndexDb, which: SQL, take: number): Promise<ShownCountry[]> {
	const rows = await db.all(sql`
    WITH named AS (
      SELECT ${carriers.iso} AS iso, NULL AS source FROM ${carriers} WHERE ${carriers.iso} IS NOT NULL
      UNION ALL
      SELECT j.value, ${sources.key} FROM ${sources} JOIN ${profiles} ON ${profiles.sha} = ${sources.headSha}, json_each(${profiles.iso}) j
      WHERE ${inArray(sources.platform, COUNTRY_PLATFORMS)} AND ${sources.kind} = 'country'
    )
    SELECT iso, count(*) - count(source) AS carriers, json_group_array(source) FILTER (WHERE source IS NOT NULL) AS sources
    FROM named WHERE ${which} GROUP BY iso ORDER BY iso LIMIT ${take}`);
	return v.parse(v.array(countrySchema), rows);
}

/** The countries one platform's carrier sources are in, by iso: the country list of a platform that ships no country bundles. */
export async function carrierCountries(db: IndexDb, platform: Platform): Promise<string[]> {
	const iso = sql<string | null>`json_extract(${profiles.iso}, '$[0]')`;
	const rows = await db
		.selectDistinct({ iso })
		.from(sources)
		.innerJoin(profiles, eq(profiles.sha, sources.headSha))
		.where(every(eq(sources.platform, platform), eq(sources.kind, "carrier"), isNotNull(iso)))
		.orderBy(asc(iso));
	return rows.flatMap((r) => r.iso ?? []);
}

/** Countries by iso, a page at a time. */
export function countryList(db: IndexDb, page: Page<string>): Promise<ShownCountry[]> {
	return countries(db, page.after === null ? sql`1` : sql`iso > ${page.after}`, page.take);
}

/** One country; undefined when no carrier or country bundle names it. */
export async function countryOf(db: IndexDb, iso: string): Promise<ShownCountry | undefined> {
	const [country] = await countries(db, sql`iso = ${iso}`, 1);
	return country;
}

const shippedModemSchema = v.pipe(
	v.object({
		platform: v.picklist(RELEASE_PLATFORMS),
		release: v.string(),
		firmware: v.string(),
		modem: v.string(),
		label: v.string(),
		sha: v.string(),
		family: v.string(),
		familyLabel: v.nullable(v.string()),
		devices: jsonOf(v.array(v.string())),
		matchers: jsonOf(v.array(v.string())),
	}),
	v.transform(({ familyLabel, ...c }) => ({
		...c,
		familyName: modemFamilyName(c.platform, c.family, familyLabel),
	})),
);

/**
 * A configuration of the firmware in a device's newest build that ships a modem, with the SIM rules that select it.
 * `modem` tells the release's modems of one firmware apart: their devices, as the release lists them.
 */
export type ShippedModemConfig = v.InferOutput<typeof shippedModemSchema>;

/** A modem configuration a carrier's SIMs select, with its firmware's family, named, and devices. */
export type CarrierModemConfig = Omit<ShippedModemConfig, "modem" | "matchers">;

/** Every shipped configuration, by platform, firmware, label and modem: the same for every carrier, so read once for all. */
export async function shippedModemConfigs(db: IndexDb): Promise<ShippedModemConfig[]> {
	const rows = await db.all(sql`
    WITH shipped AS (
      SELECT d.platform, d.release, d.name AS firmware, d.family, d.devices AS modem, j.value AS device, r.sort_key,
        max(r.sort_key) OVER (PARTITION BY d.platform, j.value) AS newest
      FROM ${modems} d, json_each(d.devices) j
      JOIN ${releases} r ON r.platform = d.platform AND r.id = d.release
    ),
    current AS MATERIALIZED (
      SELECT s.platform, s.release, s.firmware, s.family, s.modem, min(s.device) AS device, json_group_array(s.device) AS devices FROM shipped s
      WHERE s.sort_key = s.newest
      GROUP BY s.platform, s.release, s.firmware, s.modem
    )
    SELECT c.platform, c.release, c.firmware, c.modem, m.label, m.sha, c.family, ${labelled("modem", "name", sql`c.family`)} AS familyLabel, c.devices,
      (SELECT json_group_array(s.matcher) FROM ${sims} s WHERE s.sha = m.sha) AS matchers
    FROM current c CROSS JOIN ${modemConfigs} m ON m.platform = c.platform AND m.release = c.release AND m.device = c.device
    ORDER BY c.platform, c.firmware, m.label, c.modem`);
	return v.parse(v.array(shippedModemSchema), rows);
}

/**
 * The shipped configurations whose selection shares a SIM rule with the carrier's heads or routes; failing any, those
 * selected by the whole of one of its MCC-MNCs.
 */
export const carrierModemConfigs = async (
	db: IndexDb,
	id: string,
	shipped: readonly ShippedModemConfig[],
): Promise<CarrierModemConfig[]> =>
	claimedBy(
		shipped,
		await rulesOf(
			db,
			sql`SELECT ${sims.matcher} AS matcher FROM ${sources} JOIN ${sims} ON ${sims.sha} = ${sources.headSha} WHERE ${sources.carrier} = ${id}
      UNION
      SELECT ${routes.matcher} FROM ${sources} JOIN ${routes} ON ${routes.source} = ${sources.key} WHERE ${sources.carrier} = ${id}`,
		),
	);

/** carrierModemConfigs for one source's own rules: its head's and its routes', not its linked carrier's other platforms'. */
export const sourceModemConfigs = async (
	db: IndexDb,
	key: SourceKey,
	shipped: readonly ShippedModemConfig[],
): Promise<CarrierModemConfig[]> =>
	claimedBy(
		shipped,
		await rulesOf(
			db,
			sql`SELECT ${sims.matcher} AS matcher FROM ${sources} JOIN ${sims} ON ${sims.sha} = ${sources.headSha} WHERE ${sources.key} = ${key}
      UNION
      SELECT ${routes.matcher} FROM ${routes} WHERE ${routes.source} = ${key}`,
		),
	);

const ruleRows = v.array(v.object({ matcher: v.string() }));

/** A test SIM's rule a carrier lists (Samsung packs list 00101) selects no configuration of its. */
const rulesOf = async (db: IndexDb, rules: SQL): Promise<string[]> =>
	v.parse(ruleRows, await db.all(rules)).flatMap((r) => (identifies(r.matcher) ? [r.matcher] : []));

const modemOf = (c: ShippedModemConfig): string =>
	JSON.stringify([c.platform, c.release, c.firmware, c.modem]);

/** What a claimed rule, or the bare MCC-MNC it qualifies, selects; where a claimed rule selects one of a modem's configurations, only those. */
function claimedBy(shipped: readonly ShippedModemConfig[], claimed: readonly string[]): CarrierModemConfig[] {
	const exact = new Set(claimed);
	const selecting = new Set([...claimed, ...claimed.map((m) => m.slice(0, (m + "|").indexOf("|")))]);
	const isExact = (c: ShippedModemConfig): boolean => c.matchers.some((m) => exact.has(m));
	const matched = shipped.filter((c) => c.matchers.some((m) => selecting.has(m)));
	const exactModems = new Set(matched.filter(isExact).map(modemOf));
	return matched
		.filter((c) => isExact(c) || !exactModems.has(modemOf(c)))
		.map(({ modem: _modem, matchers: _matchers, ...c }) => c);
}
