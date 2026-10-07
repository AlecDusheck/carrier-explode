/** Table B-trees: interior and leaf table pages, and the overflow chains of large payloads. */

import { slice, u16be, u32be, u8 } from "@carrier-explode/binary";
import { sizeVarint, SqliteError, varint } from "./bytes.ts";

export interface Pager {
	readonly bytes: Uint8Array;
	readonly pageSize: number;
	/** The page size less the bytes reserved at the end of each page. */
	readonly usable: number;
	readonly pageCount: number;
}

export interface Cell {
	readonly rowid: bigint;
	readonly payload: Uint8Array;
}

const INTERIOR_TABLE = 0x05;
const LEAF_TABLE = 0x0d;

function page(p: Pager, n: number): Uint8Array {
	if (n < 1 || n > p.pageCount) throw new SqliteError(`page ${n} is outside the file's ${p.pageCount} pages`);
	return slice(p.bytes, (n - 1) * p.pageSize, p.pageSize);
}

/** Page 1 starts with the 100-byte file header; its B-tree header follows. */
const headerOffset = (n: number): number => (n === 1 ? 100 : 0);

function overflowed(p: Pager, local: Uint8Array, total: number, first: number): Uint8Array {
	const out = new Uint8Array(total);
	out.set(local);
	let at = local.length;
	const seen = new Set<number>();
	for (let next = first; at < total;) {
		if (next === 0) throw new SqliteError(`overflow chain ends ${total - at} bytes early`);
		if (seen.has(next)) throw new SqliteError(`overflow chain loops at page ${next}`);
		seen.add(next);
		const pg = page(p, next);
		const take = Math.min(p.usable - 4, total - at);
		out.set(slice(pg, 4, take), at);
		at += take;
		next = u32be(pg, 0);
	}
	return out;
}

/** How much of a table-leaf payload of `size` bytes stays on the page (SQLite file format §1.6). */
function localSize(usable: number, size: number): number {
	const max = usable - 35;
	if (size <= max) return size;
	const min = Math.floor(((usable - 12) * 32) / 255) - 23;
	const k = min + ((size - min) % (usable - 4));
	return k <= max ? k : min;
}

function leafCell(p: Pager, pg: Uint8Array, at: number): Cell {
	const size = sizeVarint(pg, at);
	const rowid = varint(pg, size.next);
	const local = localSize(p.usable, size.value);
	const here = slice(pg, rowid.next, local);
	const payload =
		local === size.value ? here : overflowed(p, here, size.value, u32be(pg, rowid.next + local));
	return { rowid: BigInt.asIntN(64, rowid.value), payload };
}

/** Every row of the table rooted at `root`, in rowid order. */
export function* tableCells(p: Pager, root: number): Generator<Cell, void, undefined> {
	const stack = [root];
	const seen = new Set<number>();
	for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
		if (seen.has(n)) throw new SqliteError(`B-tree page ${n} is reached twice`);
		seen.add(n);
		const pg = page(p, n);
		const h = headerOffset(n);
		const type = u8(pg, h);
		const cells = u16be(pg, h + 3);
		if (type === LEAF_TABLE) {
			for (let i = 0; i < cells; i++) yield leafCell(p, pg, u16be(pg, h + 8 + 2 * i));
		} else if (type === INTERIOR_TABLE) {
			// Pushed right-most first so the left-most child is visited next.
			stack.push(u32be(pg, h + 8));
			for (let i = cells - 1; i >= 0; i--) stack.push(u32be(pg, u16be(pg, h + 12 + 2 * i)));
		} else {
			throw new SqliteError(`page ${n} has B-tree type 0x${type.toString(16)}, not a table page`);
		}
	}
}
