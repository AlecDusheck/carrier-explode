/** A modem configuration of any platform as its view reads it: a head, its sections, and its settings a page at a time. */

import { error } from "@sveltejs/kit";
import type { ModemConfig } from "@carrier-explode/schema/types";
import type { ModemConfigRef, ModemItemsQuery, ModemPageQuery } from "#lib/api/schemas.ts";
import { itemRefs } from "#lib/components/values/modem/model.ts";
import {
	itemMatches,
	itemPage,
	listedItems,
	sectionCounts,
	type ListedItem,
	type ModemItemPage,
	type SectionCount,
} from "#lib/modem.ts";
import { storedConfig } from "./android/modems";
import { getModemConfig } from "./apple/bundle";

async function configOf(ref: ModemConfigRef): Promise<ModemConfig> {
	if (ref.kind === "stored") return storedConfig(ref.sha);
	const config = await getModemConfig(ref, ref.path);
	if (config === null) error(404, `${ref.path} is not a modem configuration.`);
	return config;
}

async function matching({
	ref,
	filter,
}: ModemItemsQuery): Promise<{ config: ModemConfig; listed: readonly ListedItem[] }> {
	const config = await configOf(ref);
	return { config, listed: listedItems(config).filter((x) => itemMatches(x.item, filter)) };
}

/** The sections holding settings that match the filter, with how many each holds. */
export async function getModemSections(q: ModemItemsQuery): Promise<readonly SectionCount[]> {
	return sectionCounts((await matching(q)).listed);
}

/** One page of the settings that match the filter, in one section or all, from the `from`th. */
export async function getModemItems(q: ModemPageQuery): Promise<ModemItemPage> {
	const { config, listed: all } = await matching(q);
	const listed = q.section === null ? all : all.filter((x) => x.section === q.section);
	const { items, next } = itemPage(listed, q.from);
	const refs = new Set(items.flatMap((x) => itemRefs(x.item)));
	return {
		items,
		related: config.items.filter((x) => x.name !== null && refs.has(x.name)),
		previous: listed[q.from - 1]?.section ?? null,
		next,
	};
}
