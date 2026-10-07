/** Android sparse images (system/core/libsparse): expanded to the raw image, the gaps they skip as zeros, whole or as they stream. */

import { u16le, u32le } from "@carrier-explode/binary";
import { Pull } from "./pull.ts";

export class SparseError extends Error {
	override name = "SparseError";
}

const MAGIC = 0xed26ff3a;
const RAW = 0xcac1;
const FILL = 0xcac2;
const DONT_CARE = 0xcac3;
const CRC32 = 0xcac4;

export const isSparse = (b: Uint8Array): boolean => b.length >= 4 && u32le(b, 0) === MAGIC;

export function unsparse(src: Uint8Array): Uint8Array {
	if (!isSparse(src)) throw new SparseError("not an Android sparse image");
	if (u16le(src, 4) !== 1) throw new SparseError(`sparse format ${u16le(src, 4)}.${u16le(src, 6)}`);
	const fileHeader = u16le(src, 8);
	const chunkHeader = u16le(src, 10);
	const blockSize = u32le(src, 12);
	const blocks = u32le(src, 16);
	const chunks = u32le(src, 20);
	const out = new Uint8Array(blocks * blockSize);
	let i = fileHeader;
	let block = 0;
	for (let c = 0; c < chunks; c++) {
		const type = u16le(src, i);
		const count = u32le(src, i + 4);
		const total = u32le(src, i + 8);
		const body = src.subarray(i + chunkHeader, i + total);
		const at = block * blockSize;
		const length = count * blockSize;
		if (type !== CRC32 && at + length > out.length)
			throw new SparseError(`chunk ${c} runs past the image's ${blocks} blocks`);
		switch (type) {
			case RAW:
				if (body.length !== length)
					throw new SparseError(`raw chunk ${c} holds ${body.length} bytes for ${count} blocks`);
				out.set(body, at);
				break;
			case FILL:
				for (let k = 0; k < length; k += 4) out.set(body.subarray(0, 4), at + k);
				break;
			case DONT_CARE:
			case CRC32:
				break;
			default:
				throw new SparseError(`chunk ${c} has type ${type.toString(16)}`);
		}
		if (type !== CRC32) block += count;
		i += total;
	}
	if (block !== blocks) throw new SparseError(`chunks cover ${block} of ${blocks} blocks`);
	return out;
}

/** A run of the raw image: `bytes` at `offset`. */
export interface SparseRun {
	readonly offset: number;
	readonly bytes: Uint8Array;
}

/** Runs handed out at once: a raw chunk can be gigabytes. */
const RUN = 1 << 20;

/** A sparse image's data as it streams, in runs of at most a MiB; what it skips (zeros, CRCs) yields nothing. */
export async function* sparseRuns(input: AsyncIterable<Uint8Array>): AsyncGenerator<SparseRun> {
	const p = new Pull(input[Symbol.asyncIterator]());
	const head = await p.take(28);
	if (!isSparse(head)) throw new SparseError("not an Android sparse image");
	const fileHeader = u16le(head, 8);
	const chunkHeader = u16le(head, 10);
	const blockSize = u32le(head, 12);
	const chunks = u32le(head, 20);
	await p.take(fileHeader - 28);
	let offset = 0;
	for (let c = 0; c < chunks; c++) {
		const h = await p.take(chunkHeader);
		const type = u16le(h, 0);
		const length = u32le(h, 4) * blockSize;
		let body = u32le(h, 8) - chunkHeader;
		switch (type) {
			case RAW:
				if (body !== length) throw new SparseError(`raw chunk ${c} holds ${body} bytes for ${length}`);
				for (let done = 0; done < length;) {
					const n = Math.min(RUN, length - done);
					yield { offset: offset + done, bytes: await p.take(n) };
					done += n;
				}
				break;
			case FILL: {
				const word = await p.take(4);
				body -= 4;
				for (let done = 0; done < length;) {
					const n = Math.min(RUN, length - done);
					const run = new Uint8Array(n);
					for (let k = 0; k < n; k += 4) run.set(word, k);
					yield { offset: offset + done, bytes: run };
					done += n;
				}
				break;
			}
			case DONT_CARE:
			case CRC32:
				break;
			default:
				throw new SparseError(`chunk ${c} has type ${type.toString(16)}`);
		}
		if (type !== RAW && body > 0) await p.take(body);
		if (type !== CRC32) offset += length;
	}
}
