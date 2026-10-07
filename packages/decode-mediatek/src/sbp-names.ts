/**
 * md1rom's SBP name tables: the SBP features, each a bit of the SBP LID that holds them as a byte array, then the SBP
 * data values, each a byte of another. Rows are (name pointer, index); the two row counts follow the second table.
 */

import { u32le } from "@carrier-explode/binary";
import { McfError } from "./errors.ts";
import type { ItemLayout, ItemWidth, LidGroup } from "./layout.ts";
import { romString } from "./rom-string.ts";

const ROW = 8;
const SBP_NAME = /^SBP_\w+$/;

/** The names of rows from `at` on, while each row's index is its position. */
function nameRun(rom: Uint8Array, at: number): string[] {
	const names: string[] = [];
	for (let o = at; o + ROW <= rom.length && u32le(rom, o + 4) === names.length; o += ROW) {
		const name = romString(rom, u32le(rom, o));
		if (name === undefined || !SBP_NAME.test(name)) break;
		names.push(name);
	}
	return names;
}

interface SbpNames {
	readonly features: readonly string[];
	readonly data: readonly string[];
}

function readSbpNames(rom: Uint8Array): SbpNames {
	for (let at = 0; at + 2 * ROW <= rom.length; at += 4) {
		if (u32le(rom, at + 4) !== 0 || u32le(rom, at + ROW + 4) !== 1) continue;
		const features = nameRun(rom, at);
		const dataAt = at + features.length * ROW;
		const data = nameRun(rom, dataAt);
		const countsAt = dataAt + data.length * ROW;
		if (
			data.length > 0 &&
			countsAt + ROW <= rom.length &&
			u32le(rom, countsAt) === features.length &&
			u32le(rom, countsAt + 4) === data.length
		) {
			return { features, data };
		}
	}
	throw new McfError("layout", 0, "no SBP name tables in the modem image");
}

interface ByteArray {
	readonly lid: number;
	readonly base: number;
}

/** The one SBP LID holding an array of `count` single bytes: a table's bits or bytes as a whole. */
function byteArray(
	items: readonly ItemLayout[],
	isSbp: (lid: number) => boolean,
	count: number,
	what: string,
): ByteArray {
	const found = items.filter(({ lid, width, formula }) => {
		const [term, ...more] = formula ?? [];
		return (
			isSbp(lid) &&
			width.unit === "byte" &&
			width.size === 1 &&
			more.length === 0 &&
			term?.kind === "array" &&
			term.stride === 1 &&
			term.counts.length === 1 &&
			term.counts[0] === count
		);
	});
	const [only, ...others] = found;
	if (only === undefined || others.length > 0)
		throw new McfError("layout", 0, `${found.length} SBP LIDs hold ${count} bytes of ${what}`);
	return { lid: only.lid, base: only.byteOffset };
}

function nameAt(names: readonly string[], index: number, item: ItemLayout): string {
	const name = names[index];
	if (name === undefined)
		throw new McfError(
			"layout",
			0,
			`item ${item.itemId} of LID 0x${item.lid.toString(16)} is past its SBP name table`,
		);
	return name;
}

/** A field narrower than its data byte is named by its bits too. */
function dataFieldName(name: string, width: Extract<ItemWidth, { unit: "bit" }>, item: ItemLayout): string {
	const { size, bitOffset } = width;
	if (bitOffset + size > 8)
		throw new McfError("layout", 0, `item ${item.itemId} spills out of SBP data byte ${name}`);
	if (size === 8) return name;
	return size === 1 ? `${name} bit ${bitOffset}` : `${name} bits ${bitOffset}-${bitOffset + size - 1}`;
}

/** Names, by item id, the bit fields of the SBP feature and data LIDs. */
export function sbpItemNames(
	rom: Uint8Array,
	items: readonly ItemLayout[],
	lidGroups: readonly LidGroup[],
): ReadonlyMap<number, string> {
	const { features, data } = readSbpNames(rom);
	const sbp = lidGroups.filter((g) => g.name === "SBP");
	const isSbp = (lid: number): boolean => sbp.some((g) => g.first <= lid && lid <= g.last);
	const featureBytes = byteArray(items, isSbp, Math.ceil(features.length / 8), "features");
	const dataBytes = byteArray(items, isSbp, data.length, "data");
	const names = new Map<number, string>();
	for (const item of items) {
		const { width } = item;
		if (width.unit !== "bit") continue;
		if (item.lid === featureBytes.lid) {
			if (width.size !== 1)
				throw new McfError("layout", 0, `SBP feature item ${item.itemId} is ${width.size} bits wide`);
			names.set(
				item.itemId,
				nameAt(features, (item.byteOffset - featureBytes.base) * 8 + width.bitOffset, item),
			);
		} else if (item.lid === dataBytes.lid) {
			names.set(
				item.itemId,
				dataFieldName(nameAt(data, item.byteOffset - dataBytes.base, item), width, item),
			);
		}
	}
	return names;
}
