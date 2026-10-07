// The XZ decoder against XZ Utils 5.8.3 (`xz -c`), one fixture per stream option: default (CRC-64), -9e with CRC-32,
// other lc/lp/pb with no check, and several blocks with SHA-256. Noise input makes LZMA2 store uncompressed chunks.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { decodeXz, XzError } from "../src/xz.ts";

const fixture = (name: string): Uint8Array =>
	new Uint8Array(readFileSync(new URL(`./fixtures/xz/${name}.xz`, import.meta.url)));
const enc = new TextEncoder();

function xzInput(): Uint8Array {
	let x = 1;
	const parts: Uint8Array[] = [];
	for (let i = 0; i < 3000; i++)
		parts.push(enc.encode(`line ${i % 97} carrier ${(i * 7) % 13} value=${i}\n`));
	parts.push(Uint8Array.from({ length: 20000 }, () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) >>> 24));
	for (let i = 0; i < 2000; i++) parts.push(enc.encode(`apn${i % 5}.example tmobile ${i % 3}\n`));
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
	return out;
}

describe("decodeXz", () => {
	const input = xzInput();

	it.each(["default", "crc32", "props", "blocks"])("decodes xz's %s stream byte for byte", (name) => {
		expect(Buffer.from(decodeXz(fixture(name), input.length)).equals(Buffer.from(input))).toBe(true);
	});

	it("refuses a wrong size and a corrupted block", () => {
		expect(() => decodeXz(fixture("default"), input.length + 1)).toThrow(XzError);
		const bad = fixture("default");
		bad[200] = (bad[200] ?? 0) ^ 0xff;
		expect(() => decodeXz(bad, input.length)).toThrow();
	});
});
