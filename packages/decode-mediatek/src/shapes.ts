/** What reading a config's values needs of its build's item table: the shapes and names of its items and the owners of their LIDs. */

import type { McfItemRecord } from "./items.ts";
import type { ItemTable } from "./layout.ts";

export const ITEM_UNITS = ["byte", "bit"] as const;
type ItemUnit = (typeof ITEM_UNITS)[number];

/** LID, element size in `unit`s, unit, array index count. */
export type ItemShape = readonly [lid: number, size: number, unit: ItemUnit, depth: number];

/** Keyed by item id and LID in decimal, as JSON keys. */
export interface ItemShapes {
	readonly items: Readonly<Record<string, ItemShape>>;
	/** The firmware module owning each LID (`IMS`, `ERRC`) that a range names. */
	readonly owners: Readonly<Record<string, string>>;
	/** Of the items the table names. */
	readonly names: Readonly<Record<string, string>>;
}

const arrayDepth = (item: ItemTable["items"][number]): number =>
	(item.formula ?? []).reduce((n, t) => n + (t.kind === "array" ? t.counts.length : 0), 0);

/** The table cut down to the items `records` set; one the table lacks is left out, and its values stay bytes. */
export function shapesFor(table: ItemTable, records: readonly McfItemRecord[]): ItemShapes {
	const wanted = new Set(records.map((r) => r.itemId));
	const items = table.items.filter((i) => wanted.has(i.itemId));
	const owners = new Map<number, string>();
	for (const { lid } of items) {
		const group = table.lidGroups.find((g) => g.first <= lid && lid <= g.last);
		if (group) owners.set(lid, group.name);
	}
	return {
		items: Object.fromEntries(
			items.map((i) => [i.itemId, [i.lid, i.width.size, i.width.unit, arrayDepth(i)] satisfies ItemShape]),
		),
		owners: Object.fromEntries(owners),
		names: Object.fromEntries(
			items.flatMap((i) => {
				const name = table.names.get(i.itemId);
				return name === undefined ? [] : [[i.itemId, name]];
			}),
		),
	};
}

/** The item's shape when the table holds it in this LID. */
export function shapeOf(shapes: ItemShapes, itemId: number, lid: number): ItemShape | undefined {
	const shape = shapes.items[itemId];
	return shape?.[0] === lid ? shape : undefined;
}

/** The item's name when the table names it and holds it in this LID. */
export function nameOf(shapes: ItemShapes, itemId: number, lid: number): string | undefined {
	return shapeOf(shapes, itemId, lid) === undefined ? undefined : shapes.names[itemId];
}
