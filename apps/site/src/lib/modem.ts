/** A neutral modem configuration (ModemConfig) as its view shows it, whatever the family. */

import type { ConfidenceOrUnknown } from "@carrier-explode/decode-qualcomm";
import {
	OWNER_SEPARATOR,
	type Certainty,
	type ModemConfig,
	type ModemItem,
	type ModemValue,
} from "@carrier-explode/schema/types";

/** The confidence markers the decoded iOS views use; "opaque" (the family names nothing) reads as unnamed. */
export const CONFIDENCE = {
	high: "high",
	medium: "med",
	low: "low",
	opaque: "unknown",
} as const satisfies Record<Certainty, ConfidenceOrUnknown>;

/** A value as one line of text, for filtering. */
export function valueText(v: ModemValue): string {
	switch (v.kind) {
		case "number":
			return String(v.value);
		case "text":
		case "xml":
			return v.value;
		case "bytes":
			return v.hex;
		case "flags":
			return v.values.join(" ");
		case "list":
			return v.values.map(valueText).join(", ");
		case "fields":
			return Object.entries(v.fields)
				.map(([k, x]) => `${k}=${valueText(x)}`)
				.join(" ");
	}
}

/** An item matches a filter on its id, name, description, label or value as written. */
export function itemMatches(item: ModemItem, query: string): boolean {
	const q = query.trim().toLowerCase();
	return (
		!q ||
		[item.id, item.name ?? "", item.description ?? "", item.label ?? "", valueText(item.value)].some((s) =>
			s.toLowerCase().includes(q),
		)
	);
}

/** A Shannon item's id is its name's CRC: worth a tooltip, not a line. */
export const hashedId = (item: ModemItem): boolean => item.id.startsWith("crc:");

/** The module an item belongs to, as its id or name states it: an EFS file's directory, a LID's owner, a Shannon name's first word; else the id's scheme (`nv`, `pri`). */
export function itemSection(item: ModemItem): string {
	const [scheme = "", rest = ""] = item.id.split(/:(.*)/s);
	switch (scheme) {
		case "efs":
			return `efs:${rest.slice(0, rest.lastIndexOf("/")) || "/"}`;
		case "lid":
			return item.description?.split(OWNER_SEPARATOR)[0] ?? scheme;
		case "crc":
			return item.name?.replace(/^!/, "").split(/[._]/)[0] ?? scheme;
		default:
			return scheme;
	}
}

/** An item's description without the section it leads with, which its heading already says. */
export function itemNote(item: ModemItem, section: string): string | null {
	return item.description?.startsWith(section + OWNER_SEPARATOR)
		? item.description.slice(section.length + OWNER_SEPARATOR.length)
		: item.description;
}

/** Items by section, sections by title. */
export function modemSections(
	items: readonly ModemItem[],
): readonly (readonly [string, readonly ModemItem[]])[] {
	return [...Map.groupBy(items, itemSection)].toSorted(([a], [b]) => a.localeCompare(b));
}

/** A decoder's notes, by the item each names (`efs:/mcfg_ftb: …`); `other` names none. */
function itemErrors(config: Pick<ModemConfig, "items" | "errors">): {
	readonly byItem: ReadonlyMap<string, readonly string[]>;
	readonly other: readonly string[];
} {
	const byItem = new Map<string, string[]>();
	const other: string[] = [];
	for (const error of config.errors) {
		const item = config.items.find((i) => error.startsWith(`${i.id}: `));
		if (item === undefined) other.push(error);
		else byItem.set(item.id, [...(byItem.get(item.id) ?? []), error]);
	}
	return { byItem, other };
}

/** A configuration without its items, as a page heads it. */
export interface ModemHead extends Omit<ModemConfig, "items" | "errors"> {
	/** How many settings it lists. */
	readonly listed: number;
	/** The decoder's notes naming no setting; a setting's own come with it. */
	readonly unplaced: readonly string[];
}

/** One setting as a configuration's view lists it: its section, and the decoder's notes on it. */
export interface ListedItem {
	readonly section: string;
	readonly item: ModemItem;
	readonly errors: readonly string[];
}

/** The settings a configuration lists, by section; an item holding just its name (a Galaxy MCFG's "ATC") says what the picker says. */
export function listedItems(config: Pick<ModemConfig, "items" | "errors" | "label">): readonly ListedItem[] {
	const { byItem } = itemErrors(config);
	const named = (x: ModemItem): boolean => x.value.kind === "text" && x.value.value === config.label;
	return modemSections(config.items.filter((x) => !named(x))).flatMap(([section, list]) =>
		list.map((item) => ({ section, item, errors: byItem.get(item.id) ?? [] })),
	);
}

export function modemHead({ items, errors, ...head }: ModemConfig): ModemHead {
	return {
		...head,
		listed: listedItems({ items, errors, label: head.label }).length,
		unplaced: itemErrors({ items, errors }).other,
	};
}

export interface SectionCount {
	readonly title: string;
	readonly count: number;
}

export const sectionCounts = (listed: readonly ListedItem[]): readonly SectionCount[] =>
	[...Map.groupBy(listed, (x) => x.section)].map(([title, xs]) => ({ title, count: xs.length }));

/** How many values an item's value draws. */
function drawn(v: ModemValue): number {
	switch (v.kind) {
		case "list":
			return v.values.reduce((n, x) => n + drawn(x), 0);
		case "fields":
			return Object.values(v.fields).reduce((n, x) => n + drawn(x), 0);
		case "flags":
			return v.values.length;
		default:
			return 1;
	}
}

/** What an item's own line weighs, in drawn values. */
const LINE = 10;

/** The drawn values a page holds at most, whatever its items hold; an item heavier than that is a page of its own. */
export const PAGE_VALUES = 1500;

/** One page of listed items, from `from`. */
export interface ModemItemPage {
	readonly items: readonly ListedItem[];
	/** Items the page's views read beside its own (a PLMN category's name), wherever they are listed. */
	readonly related: readonly ModemItem[];
	/** The section of the item before the page; null on the first. */
	readonly previous: string | null;
	/** Where the next page starts; null on the last. */
	readonly next: number | null;
}

/** A run of one section's items on a page. */
export interface SectionRun {
	readonly section: string;
	/** Whether the run starts its section, rather than going on from the page before. */
	readonly heads: boolean;
	readonly items: readonly ListedItem[];
}

export function sectionRuns(page: Pick<ModemItemPage, "items" | "previous">): readonly SectionRun[] {
	return [...Map.groupBy(page.items, (x) => x.section)].map(([section, items], i) => ({
		section,
		heads: i > 0 || section !== page.previous,
		items,
	}));
}

/** The listed items from `from` that fit one page, and where the next starts. */
export function itemPage(listed: readonly ListedItem[], from: number): Pick<ModemItemPage, "items" | "next"> {
	let end = from;
	let load = 0;
	for (const x of listed.slice(from)) {
		load += LINE + drawn(x.item.value);
		if (load > PAGE_VALUES && end > from) break;
		end++;
	}
	return { items: listed.slice(from, end), next: end < listed.length ? end : null };
}
