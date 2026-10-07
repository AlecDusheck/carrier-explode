/**
 * The config item registry in the modem firmware (`modem.bin`): every item's name, element type and element
 * count. Confseqs key items by the CRC-32 of the name; no file in carrierconfig holds the names.
 */

import { crc32, latin1, u32le } from "@carrier-explode/binary";
import { ShannonFormatError } from "./wire.ts";

/** Element types, as the registry names them. */
export const ITEM_TYPES = [
	"u8",
	"s8",
	"u16",
	"s16",
	"u32",
	"s32",
	"u64",
	"s64",
	"bool",
	"uint",
	"char",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** Bytes per element. */
export const ITEM_TYPE_SIZES = {
	u8: 1,
	s8: 1,
	u16: 2,
	s16: 2,
	u32: 4,
	s32: 4,
	u64: 8,
	s64: 8,
	bool: 4,
	uint: 4,
	char: 1,
} as const satisfies Readonly<Record<ItemType, number>>;

export interface ItemDef {
	readonly name: string;
	readonly type: ItemType;
	/** Elements one confseq value holds at most: the count over the copies, rounded down. */
	readonly capacity: number;
}

const isItemType = (s: string): s is ItemType => ITEM_TYPES.some((t) => t === s);
const MAX_TYPE_NAME = Math.max(...ITEM_TYPES.map((t) => t.length));

/** The image's table of contents: 32-byte entries of a 12-byte name, then file offset, load address, size, CRC and index. */
const TOC_ENTRY = 0x20;
const TOC_NAME = 12;

interface Segment {
	readonly offset: number;
	readonly address: number;
	readonly end: number;
}

/** A piece of MAIN and its file offset. */
interface Piece {
	readonly at: number;
	readonly bytes: Uint8Array;
}

function tocMain(toc: Uint8Array): Segment {
	for (let at = 0; at + TOC_ENTRY <= toc.length; at += TOC_ENTRY) {
		if (latin1(toc.subarray(at, at + TOC_NAME)).replace(/\0+$/, "") !== "MAIN") continue;
		const offset = u32le(toc, at + 12);
		return { offset, address: u32le(toc, at + 16), end: offset + u32le(toc, at + 20) };
	}
	throw new ShannonFormatError("modem image: no MAIN segment in its table of contents");
}

/** The chunks' bytes that fall in MAIN, with their file offsets. */
async function* clip(chunks: AsyncIterable<Uint8Array>, main: Segment): AsyncGenerator<Piece> {
	let at = 0;
	for await (const chunk of chunks) {
		if (at >= main.end) return;
		const from = Math.max(main.offset, at);
		const to = Math.min(main.end, at + chunk.length);
		if (from < to) yield { at: from, bytes: chunk.subarray(from - at, to - at) };
		at += chunk.length;
	}
}

/** MAIN, as the table of contents at the head of the image places it, and its bytes as they stream past. */
async function mainSegment(
	image: AsyncIterable<Uint8Array>,
): Promise<{ readonly main: Segment; readonly pieces: AsyncIterable<Piece> }> {
	const it = image[Symbol.asyncIterator]();
	const head: Uint8Array[] = [];
	let have = 0;
	const headBytes = async (n: number): Promise<Uint8Array> => {
		while (have < n) {
			const next = await it.next();
			if (next.done) break;
			head.push(next.value);
			have += next.value.length;
		}
		const out = new Uint8Array(have);
		head.reduce((at, p) => (out.set(p, at), at + p.length), 0);
		return out.subarray(0, Math.min(n, have));
	};
	const sized = await headBytes(24);
	const main = tocMain(await headBytes(sized.length < 24 ? 0 : u32le(sized, 20)));
	async function* chunks(): AsyncGenerator<Uint8Array> {
		yield* head;
		for (let next = await it.next(); !next.done; next = await it.next()) yield next.value;
	}
	return { main, pieces: clip(chunks(), main) };
}

/** Each piece with the `keep` bytes before it in front, so a scan can look back across chunk seams. */
async function* overlapped(pieces: AsyncIterable<Piece>, keep: number): AsyncGenerator<Piece> {
	let carry = new Uint8Array();
	for await (const p of pieces) {
		const bytes = new Uint8Array(carry.length + p.bytes.length);
		bytes.set(carry);
		bytes.set(p.bytes, carry.length);
		yield { at: p.at - carry.length, bytes };
		carry = bytes.slice(Math.max(0, bytes.length - keep));
	}
}

const printable = (x: number): boolean => x >= 0x20 && x < 0x7f;
const MAX_NAME = 256;

/**
 * Registry entries are 16 bytes: name pointer, element size, a word of copies (bits 0-7), element count over
 * all copies (8-23) and a flag (24-31, set only on calibration items), then a pointer to the type's name.
 */
const ENTRY = 16;
/** Fewer entries in a row are some other table. */
const MIN_REGISTRY = 1000;
const ENTRY_SIZES: ReadonlySet<number> = new Set(Object.values(ITEM_TYPE_SIZES));

/** A registry entry as it points at its name. */
interface Entry {
	readonly name: number;
	readonly type: ItemType;
	readonly capacity: number;
}

interface Named extends Omit<Entry, "name"> {
	readonly name: Uint8Array;
}

/** Records in a row shaped like entries, from file offset `start`. */
interface Records {
	readonly start: number;
	readonly records: Uint8Array[];
}

/** A run of entries, read before the names they point at are known. */
type Run = readonly Entry[];

/**
 * What one pass over MAIN finds: the type names' addresses, and every run of at least MIN_REGISTRY records shaped like
 * entries (4-byte aligned). Item names may come before or after the registry, so they wait for a second pass.
 */
async function scan(
	pieces: AsyncIterable<Piece>,
	main: Segment,
): Promise<{ readonly types: ReadonlyMap<number, ItemType>; readonly runs: readonly Records[] }> {
	const types = new Map<number, ItemType>();
	const size = main.end - main.offset;
	const inMain = (address: number): boolean => address >= main.address && address - main.address < size;
	const shaped = (b: Uint8Array, o: number): boolean => {
		if (!ENTRY_SIZES.has(u32le(b, o + 4))) return false;
		const shape = u32le(b, o + 8);
		return (shape & 0xff) !== 0 && shape >>> 24 <= 1 && inMain(u32le(b, o)) && inMain(u32le(b, o + 12));
	};
	/** Per 16-byte phase, the records in a row so far. */
	const open: (Records | undefined)[] = [undefined, undefined, undefined, undefined];
	const runs: Records[] = [];
	const close = (phase: number): void => {
		const run = open[phase];
		if (run !== undefined && run.records.length >= MIN_REGISTRY) runs.push(run);
		open[phase] = undefined;
	};
	let lastNul = -1;
	let nextRecord = main.offset;
	let nextNul = main.offset;
	for await (const p of overlapped(pieces, ENTRY)) {
		const end = p.at + p.bytes.length;
		for (let j = p.bytes.indexOf(0, nextNul - p.at); j >= 0; j = p.bytes.indexOf(0, j + 1)) {
			const at = p.at + j;
			const length = at - lastNul - 1;
			if (lastNul >= 0 && length >= 1 && length <= MAX_TYPE_NAME) {
				const name = latin1(p.bytes.subarray(j - length, j));
				if (isItemType(name)) types.set(main.address + lastNul + 1 - main.offset, name);
			}
			lastNul = at;
		}
		nextNul = end;
		for (; nextRecord + ENTRY <= end; nextRecord += 4) {
			const phase = ((nextRecord - main.offset) / 4) % 4;
			const o = nextRecord - p.at;
			if (!shaped(p.bytes, o)) close(phase);
			else (open[phase] ??= { start: nextRecord, records: [] }).records.push(p.bytes.slice(o, o + ENTRY));
		}
	}
	for (let phase = 0; phase < 4; phase++) close(phase);
	return { types, runs: runs.toSorted((a, b) => a.start - b.start) };
}

/** The runs of entries whose type pointers name a type of their element size. */
function typed({ records }: Records, types: ReadonlyMap<number, ItemType>): Run[] {
	const runs: Entry[][] = [[]];
	for (const r of records) {
		const type = types.get(u32le(r, 12));
		const shape = u32le(r, 8);
		if (type === undefined || u32le(r, 4) !== ITEM_TYPE_SIZES[type]) runs.push([]);
		else
			runs
				.at(-1)
				?.push({ name: u32le(r, 0), type, capacity: Math.floor(((shape >>> 8) & 0xffff) / (shape & 0xff)) });
	}
	return runs.filter((r) => r.length >= MIN_REGISTRY);
}

/** The NUL-terminated printable string at each of `addresses`, where there is one. */
async function cStrings(
	pieces: AsyncIterable<Piece>,
	main: Segment,
	addresses: ReadonlySet<number>,
): Promise<ReadonlyMap<number, Uint8Array>> {
	const starts = [...addresses].map((a) => main.offset + a - main.address).toSorted((a, b) => a - b);
	/** The printable bytes read so far of each string not yet ended. */
	const reading = new Map<number, number[]>();
	const found = new Map<number, Uint8Array>();
	let next = 0;
	for await (const p of pieces) {
		const end = p.at + p.bytes.length;
		for (let s = starts[next]; s !== undefined && s < end; s = starts[++next]) reading.set(s, []);
		for (const [start, bytes] of reading) {
			for (let at = Math.max(start, p.at); at < end; at++) {
				const b = p.bytes[at - p.at] ?? 0;
				if (printable(b) && bytes.length <= MAX_NAME) {
					bytes.push(b);
					continue;
				}
				if (b === 0 && bytes.length > 0)
					found.set(main.address + start - main.offset, Uint8Array.from(bytes));
				reading.delete(start);
				break;
			}
		}
	}
	return found;
}

/**
 * Each item the registry defines, by the CRC-32 of its name. `image` opens the image as a stream; it is read twice,
 * the second time for the names, and never held whole.
 */
export async function itemTable(
	image: () => AsyncIterable<Uint8Array>,
): Promise<ReadonlyMap<number, ItemDef>> {
	const first = await mainSegment(image());
	const { types, runs } = await scan(first.pieces, first.main);
	const candidates = runs.flatMap((r) => typed(r, types));
	const second = await mainSegment(image());
	const names = await cStrings(
		second.pieces,
		second.main,
		new Set(candidates.flatMap((run) => run.map((e) => e.name))),
	);

	let best: Named[] = [];
	for (const run of candidates) {
		let current: Named[] = [];
		for (const e of run) {
			const name = names.get(e.name);
			if (name !== undefined) current.push({ name, type: e.type, capacity: e.capacity });
			if (current.length > best.length) best = current;
			if (name === undefined) current = [];
		}
	}
	if (best.length < MIN_REGISTRY)
		throw new ShannonFormatError(`modem image: no item registry of ${MIN_REGISTRY} entries`);

	const table = new Map<number, ItemDef>();
	for (const e of best) {
		const hash = crc32(e.name);
		const def = { name: latin1(e.name), type: e.type, capacity: e.capacity };
		const other = table.get(hash);
		if (other !== undefined && other.name !== def.name)
			throw new ShannonFormatError(`item registry: ${other.name} and ${def.name} share CRC-32 ${hash}`);
		table.set(hash, def);
	}
	return table;
}
