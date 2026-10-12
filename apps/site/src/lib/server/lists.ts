/** The lists on the left: one platform's sources of one kind; for a platform with no country files, the countries of carriers. */

import {
	carrierCountries,
	carrierList,
	platformRoutes,
	sourceList,
	type ListedSource,
	type Page,
	type ShownCarrier,
} from "@carrier-explode/db";
import { countryName, isUnnamedRule } from "@carrier-explode/schema";
import {
	listPath,
	PLATFORMS,
	shipsKind,
	SOURCE_KINDS,
	sourceOf,
	sourcePath,
	type Platform,
	type SourceKey,
	type SourceKind,
} from "@carrier-explode/schema/types";
import { LIST_PAGE, type ListGuessQuery, type ListPageQuery } from "#lib/api/schemas.ts";
import { keyRules, type SelectionRule } from "#lib/settings.ts";
import { OTHER_RULES } from "#lib/android/naming.ts";
import { fold, repeated } from "#lib/names.ts";
import type { Picture } from "#lib/types.ts";
import { sha256Hex } from "@carrier-explode/binary";
import { cached, perRequest } from "./cache";
import { env } from "cloudflare:workers";
import { db, everyPage, indexVersion } from "./db";
import { brandOf, pictureOf } from "./pictures";

/** A row of a list: what the pane shows and links to. */
export interface ListRow {
	readonly path: string;
	readonly name: string;
	/** What people call the carrier: `AT&T` for ATT_US. */
	readonly brand: string;
	readonly picture: Picture;
	readonly cc: ListedSource["cc"];
	/** YYYY-MM-DD the source last changed on its platform; null when nothing dates it. */
	readonly updated: string | null;
}

/** A row that is a source the index has. */
export interface ListEntry extends ListRow {
	readonly key: SourceKey;
	readonly platform: Platform;
	/** Named only by the SIM rule that selects it (a part of a Pixel's others.pb): no carrier, so listed apart. */
	readonly ruleOnly: boolean;
	/** The carrier's id, when linked. */
	readonly carrier: string | null;
	/** What tells it from the others of its list with its brand: their country, or, sharing that too, its name; null when its brand is its own. */
	readonly tag: string | null;
}

/** What a source chip shows: its link, picture and brand. */
export type ChipEntry = Pick<ListEntry, "key" | "path" | "brand" | "picture" | "tag">;

/** One platform's sources of one kind, by name. */
async function sourcesOf(platform: Platform, kind: SourceKind): Promise<ListedSource[]> {
	const d = await db();
	return everyPage(
		(page: Page<string>) => sourceList(d, platform, kind, page),
		(s) => s.name,
	);
}

export const carriers = perRequest(async (): Promise<ShownCarrier[]> =>
	cached(`carriers:v1:${await indexVersion()}`, async () => {
		const d = await db();
		return everyPage(
			(page: Page<string>) => carrierList(d, page),
			(c) => c.id,
		);
	}),
);

type Untagged = Omit<ListEntry, "tag">;

function entryOf(s: ListedSource): Untagged {
	const ref = sourceOf(s.key);
	return {
		key: s.key,
		path: sourcePath(ref),
		platform: s.platform,
		name: s.name,
		brand: brandOf(ref, s.carrierName, s.cc),
		picture: pictureOf(ref, s),
		cc: s.cc,
		updated: s.updated,
		ruleOnly: isUnnamedRule(ref, s.carrierNamed),
		carrier: s.carrier,
	};
}

function tagged(entries: readonly Untagged[]): ListEntry[] {
	const brands = repeated(entries, (e) => e.brand);
	const local = repeated(entries, (e) => `${e.brand}\n${e.cc ?? ""}`);
	return entries.map((e) => ({
		...e,
		tag: !brands.has(e.brand)
			? null
			: e.cc !== null && !local.has(`${e.brand}\n${e.cc}`)
				? e.cc.toUpperCase()
				: e.name,
	}));
}

export const getList = perRequest(async (platform: Platform, kind: SourceKind): Promise<ListEntry[]> =>
	cached(`list:v3:${platform}:${kind}:${await indexVersion()}`, async () =>
		tagged((await sourcesOf(platform, kind)).map(entryOf)),
	),
);

/** One platform's carriers: its carrier sources, those named only by a SIM rule left out. */
export const getCarriers = perRequest(async (platform: Platform): Promise<ListEntry[]> =>
	(await getList(platform, "carrier")).filter((e) => !e.ruleOnly),
);

/** The page of a platform's carrier sources named only by a SIM rule: others.pb's, on a Pixel. */
const othersPath = (platform: Platform): string => `${listPath(platform, "carrier")}/others.pb`;

/** The pane's row for a platform's SIM-rule sources, when it has any. */
async function othersRow(platform: Platform): Promise<ListRow[]> {
	if (!(await getList(platform, "carrier")).some((e) => e.ruleOnly)) return [];
	const brand = OTHER_RULES;
	return [
		{
			path: othersPath(platform),
			name: "others.pb",
			brand,
			picture: { kind: "initials", brand },
			cc: null,
			updated: null,
		},
	];
}

/** A source named only by a SIM rule, with the rules the routing sends it. */
export type RuleSource = ListEntry & { readonly rules: readonly SelectionRule[] };

const ruleSources = perRequest(async (platform: Platform): Promise<RuleSource[]> =>
	cached(`rule-sources:v2:${platform}:${await indexVersion()}`, async () => {
		const [list, routed] = await Promise.all([
			getList(platform, "carrier"),
			db().then((d) => platformRoutes(d, platform)),
		]);
		const bySource = Map.groupBy(routed, (r) => r.source);
		const ruleOnly = list.filter((e) => e.ruleOnly);
		// oxlint-disable-next-line oxc/no-map-spread -- the entries are the request cache's; assigning to them would change it.
		return ruleOnly.map((e) => ({
			...e,
			rules: keyRules((bySource.get(e.key) ?? []).map((r) => r.matcher)),
		}));
	}),
);

/** A platform's sources named only by a SIM rule, in `iso` when given, each with its routed rules. */
export const getRuleSources = async (platform: Platform, iso: string | null): Promise<RuleSource[]> =>
	(await ruleSources(platform)).filter((e) => iso === null || e.cc === iso);

/** A country as a row: its page lists the platform's carriers there. */
const countryRow =
	(platform: Platform) =>
	(iso: string): ListRow => ({
		path: `${listPath(platform, "country")}/${iso}`,
		name: iso,
		brand: countryName(iso) ?? iso,
		picture: { kind: "flag", cc: iso },
		cc: iso,
		updated: null,
	});

/** The pane's list: the platform's sources of `kind`; for countries on a platform that ships no country files, the countries its carriers are in. */
const getListRows = perRequest(async (platform: Platform, kind: SourceKind): Promise<ListRow[]> =>
	kind === "country" && !shipsKind(platform, "country")
		? (await carrierCountries(await db(), platform))
				.map(countryRow(platform))
				.toSorted((a, b) => a.brand.localeCompare(b.brand))
		: kind === "carrier"
			? [...(await getCarriers(platform)), ...(await othersRow(platform))]
			: getList(platform, kind),
);

/** A row as its list draws it; `withCode` when another row has its brand and country (att_us, att5g_us), so it also says its file name. */
interface ListedRow extends ListRow {
	readonly withCode: boolean;
}

export interface ListPage {
	/** Where its rows start among those that match. */
	readonly from: number;
	readonly rows: readonly ListedRow[];
	/** How many rows match the search. */
	readonly matched: number;
}

const twinKey = (r: ListRow): string => `${r.brand} ${r.cc}`;
const newestFirst = (a: ListRow, b: ListRow): number =>
	(b.updated ?? "").localeCompare(a.updated ?? "") ||
	a.brand.localeCompare(b.brand) ||
	a.name.localeCompare(b.name);

/** A row with what a search looks in: its name and brand, folded; the brand too, so "China Mobile" finds CMCC_cn. */
interface Searchable {
	readonly row: ListedRow;
	readonly text: string;
}

type ListOrders = Readonly<Record<ListPageQuery["sort"], readonly Searchable[]>>;

function ordersOf(rows: readonly ListRow[]): ListOrders {
	const twins = repeated(rows, twinKey);
	const byName = rows.map((r): Searchable => ({
		row: {
			path: r.path,
			name: r.name,
			brand: r.brand,
			picture: r.picture,
			cc: r.cc,
			updated: r.updated,
			withCode: twins.has(twinKey(r)),
		},
		text: `${fold(r.name)}\n${fold(r.brand)}`,
	}));
	return { name: byName, newest: byName.toSorted((a, b) => newestFirst(a.row, b.row)) };
}

let derived: { readonly version: string; readonly lists: Map<string, ListOrders> } | null = null;

/** A list in each order, derived once per isolate and index version, so a page only filters and slices. */
async function listOrders(platform: Platform, kind: SourceKind): Promise<ListOrders> {
	const version = await indexVersion();
	if (derived?.version !== version) derived = { version, lists: new Map() };
	const { lists } = derived;
	const key = `${platform}:${kind}`;
	const held = lists.get(key);
	if (held) return held;
	const made = ordersOf(await getListRows(platform, kind));
	lists.set(key, made);
	return made;
}

const finds = (q: string): ((s: Searchable) => boolean) => {
	const f = fold(q);
	return (s) => s.row.cc === q || (f !== "" && s.text.includes(f));
};

const opens = (path: string, at: string): boolean => at === path || at.startsWith(`${path}/`);

export const listSize = async (platform: Platform, kind: SourceKind): Promise<number> =>
	(await getListRows(platform, kind)).length;

/** The brand a list's search starts at: the visitor's network's carrier, or their country; null when the list has neither. */
export async function listGuess(g: ListGuessQuery): Promise<string | null> {
	const GUESSED = {
		carrier: (r) => g.carrier !== null && r.brand === g.carrier,
		country: (r) => g.country !== null && r.cc === g.country,
		default: () => false,
	} as const satisfies Record<SourceKind, (r: ListRow) => boolean>;
	return (await getListRows(g.platform, g.kind)).find(GUESSED[g.kind])?.brand ?? null;
}

export async function listPage(a: ListPageQuery): Promise<ListPage> {
	const rows = (await listOrders(a.platform, a.kind))[a.sort];
	const q = a.q.trim().toLowerCase();
	const matching = q === "" ? rows : rows.filter(finds(q));
	const { reach } = a;
	const open = reach === null ? -1 : matching.findIndex((s) => opens(s.row.path, reach));
	// The open row is scrolled to the list's bottom edge, so the window ends at it: LIST_WINDOW rows fill the tallest sidebar.
	const size = a.from === null && open >= 0 ? env.LIST_WINDOW : LIST_PAGE;
	const from = a.from ?? (open < 0 ? 0 : Math.max(0, Math.min(open + 1 - size, matching.length - size)));
	return {
		from,
		rows: matching.slice(from, from + size).map((s) => s.row),
		matched: matching.length,
	};
}

/** A platform's carriers in one country, by brand. */
export const getCountryCarriers = perRequest(async (platform: Platform, iso: string): Promise<ListEntry[]> =>
	(await getCarriers(platform))
		.filter((e) => e.cc === iso)
		.toSorted((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name)),
);

/** The entries of `keys` the index has, as their lists tag them; cached by the set, so a page reads its few entries and not their whole lists. */
export async function listEntries(keys: readonly SourceKey[]): Promise<ReadonlyMap<SourceKey, ListEntry>> {
	const wanted = [...new Set(keys)].toSorted();
	const set = await sha256Hex(new TextEncoder().encode(wanted.join("\n")));
	const held = await cached(`list-entries:v3:${set}:${await indexVersion()}`, async () => {
		const lists = Map.groupBy(wanted.map(sourceOf), (r) => `${r.platform}:${r.kind}`);
		const all = await Promise.all(
			[...lists.values()].flatMap(([r]) => (r === undefined ? [] : [getList(r.platform, r.kind)])),
		);
		const asked = new Set(wanted);
		return all.flat().filter((e) => asked.has(e.key));
	});
	return new Map(held.map((e) => [e.key, e]));
}

export const chipOf = (e: ListEntry): ChipEntry => ({
	key: e.key,
	path: e.path,
	brand: e.brand,
	picture: e.picture,
	tag: e.tag,
});

/** The chips of `keys` the index has, in their order. */
export async function chipEntries(keys: readonly SourceKey[]): Promise<ChipEntry[]> {
	const entries = await listEntries(keys);
	return keys.flatMap((k) => {
		const e = entries.get(k);
		return e === undefined ? [] : [chipOf(e)];
	});
}

/** Each list that has entries. */
const kindsHeld = perRequest(
	async (): Promise<Array<{ readonly platform: Platform; readonly kind: SourceKind }>> =>
		cached(`lists:v1:${await indexVersion()}`, async () => {
			const d = await db();
			const lists = PLATFORMS.flatMap((platform) =>
				SOURCE_KINDS.filter((kind) => shipsKind(platform, kind)).map((kind) => ({ platform, kind })),
			);
			const held = await Promise.all(
				lists.map(
					async (l) => (await sourceList(d, l.platform, l.kind, { after: null, take: 1 })).length > 0,
				),
			);
			return lists.filter((_, i) => held[i]);
		}),
);

const allEntries = async (): Promise<ListEntry[]> =>
	(await Promise.all((await kindsHeld()).map((l) => getList(l.platform, l.kind)))).flat();

export const allSourceKeys = async (): Promise<SourceKey[]> => (await allEntries()).map((e) => e.key);

/** Every source with its carrier's name and picture, by key. */
export const allSourceBrands = perRequest(
	async (): Promise<Array<Pick<ListEntry, "key" | "brand" | "picture">>> =>
		cached(`source-brands:v3:${await indexVersion()}`, async () =>
			(await allEntries()).map((e) => ({ key: e.key, brand: e.brand, picture: e.picture })),
		),
);

/** The platforms each kind of list has entries on; a platform with carriers but no country files lists its carriers' countries. */
export const listPlatforms = perRequest(async (): Promise<ReadonlyMap<SourceKind, ReadonlySet<Platform>>> => {
	const out = new Map<SourceKind, Set<Platform>>();
	const add = (kind: SourceKind, platform: Platform): void =>
		void out.set(kind, (out.get(kind) ?? new Set()).add(platform));
	for (const { platform, kind } of await kindsHeld()) add(kind, platform);
	for (const platform of out.get("carrier") ?? [])
		if (!shipsKind(platform, "country")) add("country", platform);
	return out;
});
