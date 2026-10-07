// linked.lz4: `lz4 --content-size -B4 -BD` (lz4 1.10, linked 64 KiB blocks) over the text plain() builds.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { Lz4Error } from "@carrier-explode/binary";
import { decodeLz4, decodeLz4Stream, isSparse, SparseError, sparseRuns, unsparse } from "../src/index.ts";

/** `bytes` in pieces of `size`: what a network stream hands over. */
async function* pieces(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
	for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
	const parts: Uint8Array[] = [];
	for await (const p of chunks) parts.push(p);
	return new Uint8Array(Buffer.concat(parts));
}

const plain = (): Uint8Array => {
	let s = "";
	for (let i = 0; i < 4000; i++) s += `<key>Entry${i % 97}</key><integer>${i % 13}</integer>\n`;
	return new TextEncoder().encode(s);
};

describe("decodeLz4", () => {
	it("decodes a frame whose matches reach back across linked blocks", () => {
		const frame = new Uint8Array(readFileSync(new URL("./fixtures/linked.lz4", import.meta.url)));
		expect(Buffer.from(decodeLz4(frame)).equals(Buffer.from(plain()))).toBe(true);
	});

	it("decodes the same frame as it streams, in any size of piece", async () => {
		const frame = new Uint8Array(readFileSync(new URL("./fixtures/linked.lz4", import.meta.url)));
		for (const size of [1, 7, 4096, frame.length])
			expect(
				Buffer.from(await collect(decodeLz4Stream(pieces(frame, size)))).equals(Buffer.from(plain())),
			).toBe(true);
	});

	it("refuses what is not a frame, or is cut short", () => {
		expect(() => decodeLz4(new Uint8Array(16))).toThrow(Lz4Error);
		const frame = new Uint8Array(readFileSync(new URL("./fixtures/linked.lz4", import.meta.url)));
		expect(() => decodeLz4(frame.subarray(0, frame.length - 100))).toThrow();
	});
});

/** A sparse image of 4-byte blocks from [type, blocks, body] chunks. */
function sparse(blocks: number, chunks: Array<[number, number, number[]]>): Uint8Array {
	const out: number[] = [];
	const u16 = (n: number): void => {
		out.push(n & 0xff, n >> 8);
	};
	const u32 = (n: number): void => {
		out.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24);
	};
	u32(0xed26ff3a);
	u16(1);
	u16(0);
	u16(28);
	u16(12);
	u32(4);
	u32(blocks);
	u32(chunks.length);
	u32(0);
	for (const [type, count, body] of chunks) {
		u16(type);
		u16(0);
		u32(count);
		u32(12 + body.length);
		out.push(...body);
	}
	return new Uint8Array(out);
}

describe("unsparse", () => {
	it("lays out raw, fill and don't-care chunks, skipping a CRC chunk", () => {
		const img = sparse(4, [
			[0xcac1, 1, [1, 2, 3, 4]],
			[0xcac2, 2, [9, 8, 7, 6]],
			[0xcac3, 1, []],
			[0xcac4, 0, [0, 0, 0, 0]],
		]);
		expect(isSparse(img)).toBe(true);
		expect([...unsparse(img)]).toEqual([1, 2, 3, 4, 9, 8, 7, 6, 9, 8, 7, 6, 0, 0, 0, 0]);
	});

	it("streams the same image as runs at their offsets, skipping what it does not hold", async () => {
		const img = sparse(4, [
			[0xcac1, 1, [1, 2, 3, 4]],
			[0xcac2, 2, [9, 8, 7, 6]],
			[0xcac3, 1, []],
			[0xcac4, 0, [0, 0, 0, 0]],
		]);
		const runs: Array<[number, number[]]> = [];
		for await (const r of sparseRuns(pieces(img, 5))) runs.push([r.offset, [...r.bytes]]);
		expect(runs).toEqual([
			[0, [1, 2, 3, 4]],
			[4, [9, 8, 7, 6, 9, 8, 7, 6]],
		]);
	});

	it("refuses chunks that do not cover the image", () => {
		expect(() => unsparse(sparse(4, [[0xcac1, 1, [1, 2, 3, 4]]]))).toThrow(SparseError);
	});
});
