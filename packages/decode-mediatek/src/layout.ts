/**
 * The modem firmware's own item table (md1rom): where each MCF item id lives in its LID record, its width, and the
 * array formula that places its elements; the table naming the module that owns each LID range; and the SBP items' names.
 */

import { latin1, u16le, u32le, u8, view } from "@carrier-explode/binary";
import { McfError } from "./errors.ts";
import { romString } from "./rom-string.ts";
import { sbpItemNames } from "./sbp-names.ts";

/** One `[counts](base,stride)` array, or a fixed byte offset, of an item's formula. */
export type FormulaTerm =
	| {
			readonly kind: "array";
			readonly counts: readonly number[];
			readonly base: number;
			readonly stride: number;
	  }
	| { readonly kind: "offset"; readonly bytes: number };

export type ItemWidth =
	| { readonly unit: "byte"; readonly size: number }
	| { readonly unit: "bit"; readonly size: number; readonly bitOffset: number };

export interface ItemLayout {
	readonly itemId: number;
	readonly lid: number;
	/** Of element 0, from the record start. */
	readonly byteOffset: number;
	readonly width: ItemWidth;
	/** Null for a scalar. */
	readonly formula: readonly FormulaTerm[] | null;
}

/** LIDs `first`..`last` belong to the firmware module `name`. */
export interface LidGroup {
	readonly first: number;
	readonly last: number;
	readonly name: string;
}

export interface ItemTable {
	readonly items: readonly ItemLayout[];
	readonly lidGroups: readonly LidGroup[];
	/** By item id, the names md1rom gives: those of the SBP features and data values only. */
	readonly names: ReadonlyMap<number, string>;
}

const ITEM_ROW = 16;
const FORMULA_ROW = 48;
const NO_BIT = 0xffff;
const GROUP_ROW = 20;

const ARRAY_TERM = /^\[(\d+(?:,\d+)*)\]\((\d+),(\d+)\)$/;
const FORMULA_TEXT = /^[[\]()\d,+]+$/;

function parseFormula(text: string, offset: number): FormulaTerm[] {
	return text.split("+").map((term): FormulaTerm => {
		if (/^\d+$/.test(term)) return { kind: "offset", bytes: Number(term) };
		const m = ARRAY_TERM.exec(term);
		if (!m?.[1] || m[2] === undefined || m[3] === undefined)
			throw new McfError("layout", offset, `formula term "${term}" is not [n](base,stride)`);
		return { kind: "array", counts: m[1].split(",").map(Number), base: Number(m[2]), stride: Number(m[3]) };
	});
}

/** Byte offset of element 0. */
const formulaOrigin = (terms: readonly FormulaTerm[]): number =>
	terms.reduce((n, t) => n + (t.kind === "array" ? t.base : t.bytes), 0);

/** The formula row at `at`: an item id, then its formula as a NUL-padded string. */
function formulaAt(
	rom: Uint8Array,
	at: number,
): { readonly itemId: number; readonly text: string } | undefined {
	if (at < 0 || at + FORMULA_ROW > rom.length) return undefined;
	const field = rom.subarray(at + 4, at + FORMULA_ROW);
	const end = field.indexOf(0);
	if (end <= 0 || field.subarray(end).some((x) => x !== 0)) return undefined;
	const text = latin1(field.subarray(0, end));
	return FORMULA_TEXT.test(text) && ARRAY_TERM.test(text.split("+")[0] ?? "")
		? { itemId: u32le(rom, at), text }
		: undefined;
}

/** The longest run of formula rows; the item table ends where it starts. */
function formulaRun(rom: Uint8Array): {
	readonly start: number;
	readonly rows: { readonly itemId: number; readonly text: string }[];
} {
	const text = latin1(rom);
	let best: { start: number; rows: { readonly itemId: number; readonly text: string }[] } = {
		start: -1,
		rows: [],
	};
	for (const m of text.matchAll(/\[\d+(?:,\d+)*\]\(\d+,\d+\)[[\]()\d,+]*\0/g)) {
		let start = m.index - 4;
		if (start <= best.start + best.rows.length * FORMULA_ROW || !formulaAt(rom, start)) continue;
		while (formulaAt(rom, start - FORMULA_ROW)) start -= FORMULA_ROW;
		const rows = [];
		for (let at = start, row = formulaAt(rom, at); row; at += FORMULA_ROW, row = formulaAt(rom, at))
			rows.push(row);
		if (rows.length > best.rows.length) best = { start, rows };
	}
	if (best.start < 0) throw new McfError("layout", 0, "no item formula table in the modem image");
	return best;
}

interface ItemRow {
	readonly itemId: number;
	readonly lid: number;
	readonly byteOffset: number;
	readonly bitOffset: number;
	readonly size: number;
	readonly isBits: number;
	readonly isArray: number;
}

const itemRowAt = (rom: Uint8Array, at: number): ItemRow => ({
	itemId: u32le(rom, at),
	lid: u32le(rom, at + 4),
	byteOffset: u16le(rom, at + 8),
	bitOffset: u16le(rom, at + 10),
	size: u16le(rom, at + 12),
	isBits: u8(rom, at + 14),
	isArray: u8(rom, at + 15),
});

/** Rows ascending by item id, each flag 0 or 1 and the bit flag set exactly when a bit offset is. */
const plausibleRow = (r: ItemRow, next: ItemRow | undefined): boolean =>
	(next === undefined || r.itemId < next.itemId) &&
	r.isArray <= 1 &&
	r.isBits === (r.bitOffset === NO_BIT ? 0 : 1) &&
	r.size > 0;

function itemRows(rom: Uint8Array, end: number): ItemRow[] {
	const rows: ItemRow[] = [];
	for (let at = end - ITEM_ROW; at >= 0; at -= ITEM_ROW) {
		const r = itemRowAt(rom, at);
		if (!plausibleRow(r, rows[0])) break;
		rows.unshift(r);
	}
	return rows;
}

/** Rows of (name pointer, first LID, last LID, two words not read), starting at LIDs 0x0-0x3f then 0x40-0x7f. */
function lidGroups(rom: Uint8Array): LidGroup[] {
	const words = view(rom);
	const word = (at: number): number => words.getUint32(at, true);
	for (let start = 0; start + 2 * GROUP_ROW <= rom.length; start += 4) {
		if (
			word(start + 4) !== 0 ||
			word(start + 8) !== 0x3f ||
			word(start + 24) !== 0x40 ||
			word(start + 28) !== 0x7f
		)
			continue;
		const groups: LidGroup[] = [];
		for (let at = start; at + GROUP_ROW <= rom.length; at += GROUP_ROW) {
			const name = romString(rom, u32le(rom, at));
			const first = u32le(rom, at + 4);
			const last = u32le(rom, at + 8);
			if (name === undefined || last < first) break;
			groups.push({ first, last, name });
		}
		if (groups.length > 2) return groups;
	}
	throw new McfError("layout", 0, "no LID group table in the modem image");
}

/** Reads md1rom's item, LID group and SBP name tables, checking each item's formula against its row. */
export function readItemTable(rom: Uint8Array): ItemTable {
	const formulas = formulaRun(rom);
	const rows = itemRows(rom, formulas.start);
	const arrays = rows.filter((r) => r.isArray === 1);
	if (arrays.length !== formulas.rows.length) {
		throw new McfError(
			"layout",
			formulas.start,
			`${arrays.length} array items but ${formulas.rows.length} formulas`,
		);
	}
	const formulaOf = new Map<number, FormulaTerm[]>();
	formulas.rows.forEach((f, i) => {
		const at = formulas.start + i * FORMULA_ROW;
		if (arrays[i]?.itemId !== f.itemId)
			throw new McfError("layout", at, `formula ${i} is for item ${f.itemId}, not the ${i}th array item`);
		formulaOf.set(f.itemId, parseFormula(f.text, at));
	});
	const items = rows.map((r): ItemLayout => {
		const formula = formulaOf.get(r.itemId) ?? null;
		if (formula !== null && formulaOrigin(formula) !== r.byteOffset) {
			throw new McfError(
				"layout",
				formulas.start,
				`item ${r.itemId}: formula places element 0 off its byte offset ${r.byteOffset}`,
			);
		}
		const width: ItemWidth = r.isBits
			? { unit: "bit", size: r.size, bitOffset: r.bitOffset }
			: { unit: "byte", size: r.size };
		return { itemId: r.itemId, lid: r.lid, byteOffset: r.byteOffset, width, formula };
	});
	const groups = lidGroups(rom);
	return { items, lidGroups: groups, names: sbpItemNames(rom, items, groups) };
}
