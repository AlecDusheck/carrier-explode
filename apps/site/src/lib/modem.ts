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
export function itemErrors(config: Pick<ModemConfig, "items" | "errors">): {
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
