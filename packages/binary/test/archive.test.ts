/** packFiles and unpackFiles: deterministic zip archives. */

import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { compareUtf8, packFiles, unpackFiles } from "../src/index.ts";

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

const FILES: ReadonlyArray<readonly [string, Uint8Array]> = [
	["manifest.pb", text("m".repeat(500))],
	["confseqs/ab.pb", new Uint8Array([1, 2, 3])],
	["confseqs/Zz.pb", new Uint8Array()],
	["é.json", text("{}")],
	["names.json", text('{"5f3a91c2":["X"]}')],
];

describe("packFiles", () => {
	it("gives the same bytes whatever the insertion order", () => {
		const a = packFiles(new Map(FILES));
		const b = packFiles(new Map(FILES.toReversed()));
		expect(sha(a)).toBe(sha(b));
	});

	it("writes members in UTF-8 byte order and reads them back exactly", () => {
		const packed = packFiles(new Map(FILES));
		expect(Object.keys(unzipSync(packed))).toEqual(FILES.map(([n]) => n).toSorted(compareUtf8));
		expect(Object.keys(unzipSync(packed))).toEqual([
			"confseqs/Zz.pb",
			"confseqs/ab.pb",
			"manifest.pb",
			"names.json",
			"é.json",
		]);
		expect(unpackFiles(packed)).toEqual(new Map(FILES));
	});

	it("stores a fixed time and changes with any content byte", () => {
		const packed = packFiles(new Map(FILES));
		const dosDate = new DataView(packed.buffer, packed.byteOffset).getUint16(12, true);
		expect(dosDate).toBe((0 << 9) | (1 << 5) | 1);
		const changed = new Map(FILES);
		changed.set("confseqs/ab.pb", new Uint8Array([1, 2, 4]));
		expect(sha(packFiles(changed))).not.toBe(sha(packed));
	});

	it("refuses names it could not order or that are not files", () => {
		for (const name of ["", "dir/", "12"])
			expect(() => packFiles(new Map([[name, new Uint8Array()]]))).toThrow(/packFiles/);
	});
});
