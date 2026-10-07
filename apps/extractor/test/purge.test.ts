import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { purgeTarget, queue, sendBatches, type QueueEnv } from "../src/queues.ts";
import { batchOf, MemQueue } from "./queues.ts";

describe("sending index messages", () => {
	it("keeps each batch under 100 messages and 256 KB: an Apple OTA unit's 98 messages of 50 URLs go in three", () => {
		const url = `https://updates.cdn-apple.com/${"x".repeat(80)}.ipcc`;
		const big = Array.from({ length: 98 }, () => ({ kind: "ota", feed: "apple", urls: Array(50).fill(url) }));
		const sizes = sendBatches(big).map((b) => JSON.stringify(b).length);
		expect(sizes.length).toBe(3);
		expect(Math.max(...sizes)).toBeLessThan(256_000);
		expect(sendBatches(Array.from({ length: 250 }, () => ({ kind: "settle" }))).map((b) => b.length)).toEqual(
			[100, 100, 50],
		);
	});
});

describe("purge configuration", () => {
	it("purges every reader at its purge path with both, skips with neither, and refuses half", () => {
		expect(purgeTarget({ PURGE_ORIGINS: ["https://site", "https://api"], PURGE_TOKEN: "t" })).toEqual({
			purge: "readers",
			urls: ["https://site/internal/purge", "https://api/internal/purge"],
			token: "t",
		});
		expect(purgeTarget({ PURGE_ORIGINS: undefined, PURGE_TOKEN: undefined })).toEqual({ purge: "off" });
		expect(purgeTarget({ PURGE_ORIGINS: [], PURGE_TOKEN: undefined })).toEqual({ purge: "off" });
		expect(() => purgeTarget({ PURGE_ORIGINS: ["https://site"], PURGE_TOKEN: undefined })).toThrow(
			/PURGE_TOKEN is not/,
		);
		expect(() => purgeTarget({ PURGE_ORIGINS: undefined, PURGE_TOKEN: "t" })).toThrow(/PURGE_ORIGINS is not/);
		expect(() => purgeTarget({ PURGE_ORIGINS: "https://site", PURGE_TOKEN: "t" })).toThrow();
	});
});

const proxy = await getPlatformProxy<{ DB: D1Database; BUCKET: R2Bucket }>({
	configPath: join(import.meta.dirname, "wrangler.jsonc"),
	persist: false,
});
afterAll(() => proxy.dispose());

/** Readers answering `status`; each purge asked of them, its URL, bearer and content type. */
function readers(status: number): Array<readonly [string, string | null, string | null]> {
	const asked: Array<readonly [string, string | null, string | null]> = [];
	vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
		const headers = new Headers(init.headers);
		asked.push([url, headers.get("authorization"), headers.get("content-type")]);
		return new Response(null, { status });
	});
	return asked;
}

describe("the purge queue's consumer", () => {
	const env: QueueEnv = {
		DB: proxy.env.DB,
		BUCKET: proxy.env.BUCKET,
		INDEX_QUEUE: new MemQueue(),
		PURGE_QUEUE: new MemQueue(),
		PURGE_ORIGINS: ["https://site", "https://api"],
		PURGE_TOKEN: "t",
	};

	afterEach(() => vi.unstubAllGlobals());

	it("purges each reader once for a whole batch", async () => {
		const asked = readers(200);
		const batch = batchOf("carrier-explode-purge", [{}, {}, {}]);
		await queue(batch, env);
		expect(asked).toEqual([
			["https://site/internal/purge", "Bearer t", "application/json"],
			["https://api/internal/purge", "Bearer t", "application/json"],
		]);
		expect(batch.acked()).toBe(3);
	});

	it("leaves the batch to be retried when a reader refuses, rate-limited or not", async () => {
		readers(502);
		const batch = batchOf("carrier-explode-purge", [{}]);
		await expect(queue(batch, env)).rejects.toThrow(/502/);
		expect(batch.acked()).toBe(0);
	});
});
