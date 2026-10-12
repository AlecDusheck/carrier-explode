/** LZ4 frames (the lz4 tool's format: Samsung's *.img.lz4), decoded as they stream. Blocks may be linked or independent. */

import { decodeLz4Into, Lz4Error, u32le } from "@carrier-explode/binary";
import { Pull } from "./pull.ts";

const MAGIC = 0x184d2204;
/** A block size's high bit: the block is stored as is. */
const STORED = 2 ** 31;

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
		const room = new Uint8Array(window.length + maxBlock);
		room.set(window);
		if (stored) room.set(block, window.length);
		const end = stored ? window.length + n : decodeLz4Into(block, room, window.length);
		// A slice, not a view: a consumer holding blocks would otherwise hold each one's window and spare room too.
		yield stored ? block : room.slice(window.length, end);
		window = room.slice(Math.max(0, end - WINDOW), end);
	}
}
