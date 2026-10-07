// The bucket as container jobs reach it (../src/bucket-proxy.ts), against a local R2.

import { createHash } from "node:crypto";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterAll, describe, expect, it } from "vitest";

import { keys } from "@carrier-explode/storage";
import { serveBucket } from "../src/bucket-proxy.ts";
import { KIND_HEADER } from "../src/container-protocol.ts";

const proxy = await getPlatformProxy<{ BUCKET: R2Bucket }>({
	configPath: join(import.meta.dirname, "wrangler.jsonc"),
	persist: false,
});
const local = proxy.env.BUCKET;
afterAll(() => proxy.dispose());

/** Node's request bodies have no known length, which workerd's do; buffered here, so the binding takes them. */
const bucket: R2Bucket = Object.assign(Object.create(local), {
	put: async (key: string, body: ReadableStream, options?: R2PutOptions) =>
		local.put(key, await new Response(body).arrayBuffer(), options),
});

const request = (
	method: string,
	key: string,
	headers: Record<string, string> = {},
	body?: string,
): Promise<Response> =>
	serveBucket(
		new Request(`http://bucket.internal/${encodeURI(key)}`, {
			method,
			headers,
			...(body === undefined ? {} : { body }),
		}),
		bucket,
	);

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

describe("serveBucket", () => {
	it("stores an artifact once under its sha256, with its kind", async () => {
		const sha = sha256("bbfw");
		expect((await request("PUT", keys.obj(sha), { [KIND_HEADER]: "apple.bbfw" }, "bbfw")).status).toBe(201);
		expect((await request("PUT", keys.obj(sha), { [KIND_HEADER]: "apple.bbfw" }, "bbfw")).status).toBe(412);
		const held = await local.head(keys.obj(sha));
		expect([held?.customMetadata?.["kind"], held?.httpMetadata?.contentType]).toEqual([
			"apple.bbfw",
			"application/zip",
		]);
	});

	it("refuses bytes that are not the sha256 their key names", async () => {
		await expect(
			request("PUT", keys.obj(sha256("other")), { [KIND_HEADER]: "apple.ftab" }, "bytes"),
		).rejects.toThrow();
		expect(await local.head(keys.obj(sha256("other")))).toBeNull();
	});

	it("writes a key once with If-None-Match, and replaces it without", async () => {
		const once = { "content-type": "application/json", "if-none-match": "*" };
		expect((await request("PUT", "tmp/u/a", once, "1")).status).toBe(201);
		expect((await request("PUT", "tmp/u/a", once, "2")).status).toBe(412);
		expect(
			(await request("PUT", "releases/samsung/b.json", { "content-type": "application/json" }, "1")).status,
		).toBe(201);
		expect(
			(await request("PUT", "releases/samsung/b.json", { "content-type": "application/json" }, "2")).status,
		).toBe(201);
		expect(await (await request("GET", "tmp/u/a")).text()).toBe("1");
		expect(await (await request("GET", "releases/samsung/b.json")).text()).toBe("2");
	});

	it("answers 404 for a missing key", async () => {
		expect((await request("GET", "tmp/none")).status).toBe(404);
	});
});
