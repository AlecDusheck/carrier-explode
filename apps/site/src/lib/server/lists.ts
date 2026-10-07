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
import { keyRules, type SelectionRule } from "#lib/settings.ts";
import { OTHER_RULES } from "#lib/android/naming.ts";
import { repeated } from "#lib/names.ts";
import type { Picture } from "#lib/types.ts";
import { perRequest } from "./cache";
import { db, everyPage } from "./db";
import { brandOf, pictureOf } from "./pictures";

/** A row of a list: what the pane shows and links to. */
export interface ListRow {
	readonly path: string;
	readonly name: string;
	/** What people call the carrier: `AT&T` for ATT_US. */
	readonly brand: string;
	readonly picture: Picture;
	readonly cc: string | undefined;
	/** YYYY-MM-DD the source last changed on its platform; null when nothing dates it. */
	readonly updated: string | null;
}

/** A row that is a source the index has. */
export interface ListEntry extends ListRow {
	readonly key: SourceKey;
	readonly platform: Platform;
	/** Named only by the SIM rule that selects it (a part of a Pixel's others.pb): no carrier, so listed apart. */
	readonly ruleOnly: boolean;
	/** What tells it from the others of its list with its brand: their country, or, sharing that too, its name; null when its brand is its own. */
	readonly tag: string | null;
}

/** What a source chip shows: its link, picture and brand. */
export type ChipEntry = Pick<ListEntry, "key" | "path" | "brand" | "picture" | "tag">;

/** One platform's sources of one kind, by name. */
const sourcesOf = perRequest(async (platform: Platform, kind: SourceKind): Promise<ListedSource[]> => {
	const d = await db();
	return everyPage(
		(page: Page<string>) => sourceList(d, platform, kind, page),
		(s) => s.name,
	);
});

export const carriers = perRequest(async (): Promise<ShownCarrier[]> => {
	const d = await db();
	return everyPage(
		(page: Page<string>) => carrierList(d, page),
		(c) => c.id,
	);
});

type Untagged = Omit<ListEntry, "tag">;

function entryOf(s: ListedSource): Untagged {
	const ref = sourceOf(s.key);
	const pictured =
		s.carrier === null || s.carrierName === null
			? null
			: { id: s.carrier, name: s.carrierName, members: s.members };
	return {
		key: s.key,
		path: sourcePath(ref),
		platform: s.platform,
		name: s.name,
		brand: brandOf(ref, s.carrierName, s.cc),
		picture: pictureOf(ref, pictured, s.cc),
		cc: s.cc ?? undefined,
		updated: s.updated,
		ruleOnly: isUnnamedRule(ref, s.carrierNamed),
	};
}

function tagged(entries: readonly Untagged[]): ListEntry[] {
	const brands = repeated(entries, (e) => e.brand);
	const local = repeated(entries, (e) => `${e.brand}\n${e.cc ?? ""}`);
	return entries.map((e) => ({
		...e,
		tag: !brands.has(e.brand)
			? null
			: e.cc !== undefined && !local.has(`${e.brand}\n${e.cc}`)
				? e.cc.toUpperCase()
				: e.name,
	}));
}

export const getList = perRequest(async (platform: Platform, kind: SourceKind): Promise<ListEntry[]> =>
	tagged((await sourcesOf(platform, kind)).map(entryOf)),
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
			cc: undefined,
			updated: null,
		},
	];
}

/** A source named only by a SIM rule, with the rules the routing sends it. */
export type RuleSource = ListEntry & { readonly rules: readonly SelectionRule[] };

const ruleSources = perRequest(async (platform: Platform): Promise<RuleSource[]> => {
	const [list, routed] = await Promise.all([
		getList(platform, "carrier"),
		db().then((d) => platformRoutes(d, platform)),
	]);
	const bySource = Map.groupBy(routed, (r) => r.source);
	const ruleOnly = list.filter((e) => e.ruleOnly);
	// oxlint-disable-next-line oxc/no-map-spread -- the entries are the request cache's; assigning to them would change it.
	return ruleOnly.map((e) => ({ ...e, rules: keyRules((bySource.get(e.key) ?? []).map((r) => r.matcher)) }));
});

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
export const getListRows = perRequest(async (platform: Platform, kind: SourceKind): Promise<ListRow[]> =>
	kind === "country" && !shipsKind(platform, "country")
		? (await carrierCountries(await db(), platform))
				.map(countryRow(platform))
				.toSorted((a, b) => a.brand.localeCompare(b.brand))
		: kind === "carrier"
			? [...(await getCarriers(platform)), ...(await othersRow(platform))]
			: getList(platform, kind),
);

/** A platform's carriers in one country, by brand. */
export const getCountryCarriers = perRequest(async (platform: Platform, iso: string): Promise<ListEntry[]> =>
	(await getCarriers(platform))
		.filter((e) => e.cc === iso)
		.toSorted((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name)),
);

/** The entries of `keys` the index has, as their lists tag them. */
export async function listEntries(keys: readonly SourceKey[]): Promise<ReadonlyMap<SourceKey, ListEntry>> {
	const lists = Map.groupBy(keys.map(sourceOf), (r) => `${r.platform}:${r.kind}`);
	const held = await Promise.all(
		[...lists.values()].flatMap(([r]) => (r === undefined ? [] : [getList(r.platform, r.kind)])),
	);
	const wanted = new Set(keys);
	return new Map(held.flat().flatMap((e) => (wanted.has(e.key) ? [[e.key, e] as const] : [])));
}

/** Each list that has entries. */
const kindsHeld = perRequest(
	async (): Promise<Array<{ readonly platform: Platform; readonly kind: SourceKind }>> => {
		const d = await db();
		const lists = PLATFORMS.flatMap((platform) =>
			SOURCE_KINDS.filter((kind) => shipsKind(platform, kind)).map((kind) => ({ platform, kind })),
		);
		const held = await Promise.all(
			lists.map(async (l) => (await sourceList(d, l.platform, l.kind, { after: null, take: 1 })).length > 0),
		);
		return lists.filter((_, i) => held[i]);
	},
);

export const allSourceKeys = perRequest(async (): Promise<SourceKey[]> =>
	(await Promise.all((await kindsHeld()).map((l) => sourcesOf(l.platform, l.kind)))).flat().map((s) => s.key),
);

/** Every source with its carrier's name, by key. */
export const allSourceBrands = perRequest(
	async (): Promise<Array<{ readonly key: SourceKey; readonly brand: string }>> =>
		(await Promise.all((await kindsHeld()).map((l) => getList(l.platform, l.kind))))
			.flat()
			.map((e) => ({ key: e.key, brand: e.brand })),
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
