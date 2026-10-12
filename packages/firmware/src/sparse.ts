/** Android sparse images (system/core/libsparse): expanded to the raw image as they stream, the gaps they skip as zeros. */

import { concatBytes, u16le, u32le } from "@carrier-explode/binary";
import { Pull } from "./pull.ts";

export class SparseError extends Error {
	override name = "SparseError";
}

const MAGIC = 0xed26ff3a;
const RAW = 0xcac1;
const FILL = 0xcac2;
const DONT_CARE = 0xcac3;
const CRC32 = 0xcac4;

const isSparse = (b: Uint8Array): boolean => b.length >= 4 && u32le(b, 0) === MAGIC;

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
	const blocks = u32le(head, 16);
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
	if (offset !== blocks * blockSize)
		throw new SparseError(`chunks cover ${offset / blockSize} of ${blocks} blocks`);
}

/** An image as it streams, whole: a sparse one expanded to the raw image, any other as it is. */
export async function wholeImage(input: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
	const it = input[Symbol.asyncIterator]();
	const parts: Uint8Array[] = [];
	for (let held = 0, next = await it.next(); !next.done; next = await it.next()) {
		parts.push(next.value);
		held += next.value.length;
		if (held >= 28) break;
	}
	const head = concatBytes(parts);
	async function* all(): AsyncGenerator<Uint8Array> {
		yield head;
		for (let next = await it.next(); !next.done; next = await it.next()) yield next.value;
	}
	if (!isSparse(head)) {
		const rest: Uint8Array[] = [];
		for await (const part of all()) rest.push(part);
		return concatBytes(rest);
	}
	const out = new Uint8Array(u32le(head, 16) * u32le(head, 12));
	for await (const r of sparseRuns(all())) {
		if (r.offset + r.bytes.length > out.length)
			throw new SparseError(`a chunk runs past the image's ${out.length} bytes`);
		out.set(r.bytes, r.offset);
	}
	return out;
}
