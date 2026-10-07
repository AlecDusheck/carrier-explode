import { describe, expect, it } from "vitest";

import { collect, tarEntries } from "../src/galaxy/tar.ts";

/** A ustar header for `name` of `size` bytes, its size in octal. */
function header(name: string, size: number): Uint8Array {
	const h = new Uint8Array(512);
	h.set(new TextEncoder().encode(name), 0);
	h.set(new TextEncoder().encode(size.toString(8).padStart(11, "0")), 124);
	return h;
}

const padded = (body: Uint8Array): Uint8Array => {
	const out = new Uint8Array(Math.ceil(body.length / 512) * 512);
	out.set(body);
	return out;
};

/** The tar in pieces of `piece` bytes, as a stream hands it over. */
async function* pieces(tar: Uint8Array, piece: number): AsyncGenerator<Uint8Array> {
	for (let at = 0; at < tar.length; at += piece) yield tar.subarray(at, at + piece);
}

describe("tarEntries", () => {
	const a = Uint8Array.from({ length: 700 }, (_, i) => i % 251);
	const b = new TextEncoder().encode("optics");
	const tar = new Uint8Array([
		...header("cache.img.lz4", a.length),
		...padded(a),
		...header("optics.img.lz4", b.length),
		...padded(b),
		...new Uint8Array(1024),
	]);

	it("reads each entry's body across stream pieces, and skips a body left unread", async () => {
		const got: Array<[string, number, Uint8Array | null]> = [];
		for await (const e of tarEntries(pieces(tar, 300)))
			got.push([e.name, e.size, e.name === "optics.img.lz4" ? await collect(e.body) : null]);
		expect(got).toEqual([
			["cache.img.lz4", 700, null],
			["optics.img.lz4", 6, b],
		]);
	});

	it("fails on a tar cut short inside a body", async () => {
		const cut = tar.subarray(0, 512 + 100);
		await expect(
			(async () => {
				for await (const e of tarEntries(pieces(cut, 64))) await collect(e.body);
			})(),
		).rejects.toThrow(/ended 600 bytes into its body/);
	});
});
