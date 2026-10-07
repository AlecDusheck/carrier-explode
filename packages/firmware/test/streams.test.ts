// File streams against whole reads, and an R2 object as a source, in a local R2 (wrangler's simulator).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { R2Bucket } from "@cloudflare/workers-types";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	bytesSource,
	openFilesystem,
	r2Source,
	R2ReadError,
	SourceRangeError,
	type Filesystem,
} from "../src/index.ts";

const fixture = (name: string): Uint8Array => {
	const bytes = readFileSync(join(import.meta.dirname, "fixtures", name));
	return new Uint8Array(name.endsWith(".gz") ? gunzipSync(bytes) : bytes);
};

async function streamed(fs: Filesystem, path: string): Promise<Uint8Array> {
	const parts: Uint8Array[] = [];
	for await (const p of fs.readStream(path)) parts.push(p);
	return new Uint8Array(Buffer.concat(parts));
}

async function files(fs: Filesystem, dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const e of await fs.readdir(dir)) {
		const path = dir ? `${dir}/${e.name}` : e.name;
		if (e.kind === "dir") out.push(...(await files(fs, path)));
		else if (e.kind === "file") out.push(path);
	}
	return out;
}

const IMAGES = [
	"android/product.ext4.gz",
	"android/product.erofs.gz",
	"android/product-chunked.erofs.gz",
	"android/product-lz4.erofs.gz",
	"erofs-compact.img",
	"erofs-full.img",
];

describe.each(IMAGES)("readStream on %s", (name) => {
	it("yields each file's bytes as readFile reads them", async () => {
		const fs = await openFilesystem(bytesSource(fixture(name)));
		const paths = await files(fs, "");
		expect(paths.length).toBeGreaterThan(2);
		for (const path of paths) expect(await streamed(fs, path)).toEqual(await fs.readFile(path));
		await expect(streamed(fs, "/")).rejects.toThrow(/not a regular file/);
	});
});

const proxy = await getPlatformProxy<{ BUCKET: R2Bucket }>({
	configPath: join(import.meta.dirname, "wrangler.jsonc"),
	persist: false,
});
const bucket = proxy.env.BUCKET;
afterAll(() => proxy.dispose());

describe("r2Source", () => {
	const bytes = Uint8Array.from({ length: 3 << 20 }, (_, i) => (i * 31 + (i >>> 11)) & 0xff);
	beforeAll(() => bucket.put("obj/blob", bytes));

	it("reads exactly the ranges asked for", async () => {
		const src = await r2Source(bucket, "obj/blob");
		expect(src.size).toBe(bytes.length);
		for (const [offset, length] of [
			[0, 1],
			[0, 4096],
			[1_234_567, 1],
			[1_048_575, 1_048_577],
			[bytes.length - 3, 3],
			[bytes.length, 0],
		] as const) {
			expect(await src.read(offset, length)).toEqual(bytes.slice(offset, offset + length));
		}
		await expect(src.read(bytes.length - 3, 4)).rejects.toThrow(SourceRangeError);
		await expect(src.read(-1, 1)).rejects.toThrow(SourceRangeError);
	});

	it("serves the readers: a filesystem image in R2 opens in place", async () => {
		const image = fixture("android/product.ext4.gz");
		await bucket.put("obj/product", image);
		const fs = await openFilesystem(await r2Source(bucket, "obj/product"));
		const whole = await openFilesystem(bytesSource(image));
		expect(await fs.readFile("etc/CarrierSettings/filler.bin")).toEqual(
			await whole.readFile("etc/CarrierSettings/filler.bin"),
		);
	});

	it("fails on a missing object", async () => {
		await expect(r2Source(bucket, "obj/none")).rejects.toThrow(R2ReadError);
	});
});
