/** LZ4 frames (the lz4 tool's format: Samsung's *.img.lz4), decoded whole or as they stream. Blocks may be linked or independent. */

import { concatBytes, decodeLz4Into, Lz4Error, u32le } from "@carrier-explode/binary";
import { Pull } from "./pull.ts";

const MAGIC = 0x184d2204;
/** Skippable frames carry metadata decoders pass over. */
const SKIPPABLE = (magic: number): boolean => (magic & 0xfffffff0) === 0x184d2a50;
/** A block size's high bit: the block is stored as is. */
const STORED = 2 ** 31;

/** A frame's content, which its header must state the size of (lz4 --content-size, as Samsung writes them). */
export function decodeLz4(src: Uint8Array): Uint8Array {
	const parts: Uint8Array[] = [];
	let i = 0;
	while (i < src.length) {
		const magic = u32le(src, i);
		if (SKIPPABLE(magic)) {
			i += 8 + u32le(src, i + 4);
			continue;
		}
		if (magic !== MAGIC) throw new Lz4Error(`not an LZ4 frame at ${i}: magic ${magic.toString(16)}`);
		const flg = src[i + 4] ?? 0;
		if (flg >> 6 !== 1) throw new Lz4Error(`LZ4 frame version ${flg >> 6}`);
		const blockChecksums = (flg & 0x10) !== 0;
		const hasSize = (flg & 0x08) !== 0;
		const contentChecksum = (flg & 0x04) !== 0;
		const hasDict = (flg & 0x01) !== 0;
		if (!hasSize) throw new Lz4Error("an LZ4 frame without its content size");
		if (hasDict) throw new Lz4Error("an LZ4 frame that needs a dictionary");
		const size = u32le(src, i + 6) + u32le(src, i + 10) * 2 ** 32;
		if (!Number.isSafeInteger(size)) throw new Lz4Error(`an LZ4 content size of ${size}`);
		const out = new Uint8Array(size);
		let o = 0;
		i += 6 + 8 + 1;
		for (;;) {
			const word = u32le(src, i);
			i += 4;
			if (word === 0) break;
			const stored = word >= STORED;
			const n = stored ? word - STORED : word;
			if (i + n > src.length) throw new Lz4Error("a block runs past the input");
			if (stored) {
				out.set(src.subarray(i, i + n), o);
				o += n;
			} else {
				o = decodeLz4Into(src.subarray(i, i + n), out, o);
			}
			i += n + (blockChecksums ? 4 : 0);
		}
		if (contentChecksum) i += 4;
		if (o !== size) throw new Lz4Error(`an LZ4 frame decoded to ${o} bytes, not its stated ${size}`);
		parts.push(out);
	}
	const [only, ...rest] = parts;
	if (only === undefined) throw new Lz4Error("no LZ4 frame");
	if (rest.length) throw new Lz4Error(`${parts.length} LZ4 frames; one image is one frame`);
	return only;
}

/** A linked block's matches reach back at most this far. */
const WINDOW = 65536;

/** One LZ4 frame decoded as it streams, block by block, keeping the window linked blocks reach into. */
export async function* decodeLz4Stream(input: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
	const p = new Pull(input[Symbol.asyncIterator]());
	// Magic, FLG and BD; then the content size when FLG says, and the header checksum.
	const head = await p.take(6);
	if (u32le(head, 0) !== MAGIC) throw new Lz4Error(`not an LZ4 frame: magic ${u32le(head, 0).toString(16)}`);
	const flg = head[4] ?? 0;
	if (flg >> 6 !== 1) throw new Lz4Error(`LZ4 frame version ${flg >> 6}`);
	if (flg & 0x01) throw new Lz4Error("an LZ4 frame that needs a dictionary");
	const blockChecksums = (flg & 0x10) !== 0;
	await p.take((flg & 0x08 ? 8 : 0) + 1);
	const maxBlock = [0, 0, 0, 0, 65536, 262144, 1048576, 4194304][((head[5] ?? 0) >> 4) & 7] ?? 0;
	if (maxBlock === 0) throw new Lz4Error(`LZ4 block size code ${((head[5] ?? 0) >> 4) & 7}`);
	let window: Uint8Array = new Uint8Array(0);
	for (;;) {
		const word = u32le(await p.take(4), 0);
		if (word === 0) return;
		const stored = word >= STORED;
		const n = stored ? word - STORED : word;
		const block = await p.take(n);
		if (blockChecksums) await p.take(4);
		let out: Uint8Array;
		if (stored) out = block.slice();
		else {
			const room = new Uint8Array(window.length + maxBlock);
			room.set(window);
			const end = decodeLz4Into(block, room, window.length);
			out = room.slice(window.length, end);
		}
		yield out;
		const joined = window.length ? concatBytes([window, out]) : out;
		window = joined.length > WINDOW ? joined.slice(joined.length - WINDOW) : joined;
	}
}
