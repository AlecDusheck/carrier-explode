// Keys, and the writes against a local R2 bucket (wrangler's simulator, in memory).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as v from "valibot";
import { getPlatformProxy } from "wrangler";
import { afterAll, describe, expect, it } from "vitest";

import {
	purgeRefusal,
	purgeCache,
	applyPolicy,
	INDEX_TAG,
	heldArtifacts,
	keys,
	putJson,
	putJsonOnce,
	putObj,
	putOnce,
	readRecord,
	RecordError,
	releaseOfKey,
	type HeldArtifact,
} from "../src/index.ts";

const proxy = await getPlatformProxy<{ BUCKET: R2Bucket }>({
	configPath: join(import.meta.dirname, "wrangler.jsonc"),
	persist: false,
});
const bucket = proxy.env.BUCKET;
afterAll(() => proxy.dispose());

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = async (key: string): Promise<string | undefined> => (await bucket.get(key))?.text();

const SHA = "a".repeat(64);

const DAY_SECONDS = 86_400;
const lifecycleSchema = v.object({
	rules: v.tuple([
		v.object({
			enabled: v.literal(true),
			conditions: v.object({ prefix: v.string() }),
			deleteObjectsTransition: v.object({
				condition: v.object({ type: v.literal("Age"), maxAge: v.literal(DAY_SECONDS) }),
			}),
		}),
	]),
});

describe("keys", () => {
	it("key a normalized object by its artifact's sha, under its schema's version", () => {
		expect(keys.profile(SHA)).toMatch(new RegExp(`^norm/v\\d+/${SHA}\\.json$`));
	});

	it("give back the release a listed key names, for every platform", () => {
		const written = [
			[keys.release("ios", "24A446"), { platform: "ios", id: ["24A446"] }],
			[
				keys.release("android", "CP3A.260905.009", "tokay"),
				{ platform: "android", id: ["CP3A.260905.009", "tokay"] },
			],
			[keys.release("samsung", "S948USQS4AZHL"), { platform: "samsung", id: ["S948USQS4AZHL"] }],
		] as const;
		for (const [key, release] of written) {
			expect(key.startsWith(keys.releasePrefix(release.platform))).toBe(true);
			expect(releaseOfKey(key)).toEqual(release);
		}
	});

	it("read no release from any other key", () => {
		for (const key of [
			keys.obj(SHA),
			keys.profile(SHA),
			"releases/android/CP3A.260905.009.json",
			"releases/ios/24A446/x.json",
			"releases/ios/24A446",
			"releases/tvos/1.json",
			"releases/samsung//x.json",
		]) {
			expect(releaseOfKey(key)).toBeUndefined();
		}
	});

	it("give back the sha of an obj/ key and of no other", () => {
		expect(keys.shaOfObj(keys.obj(SHA))).toBe(SHA);
		expect(keys.shaOfObj(keys.profile(SHA))).toBeUndefined();
		expect(keys.shaOfObj(keys.objPrefix())).toBeUndefined();
	});

	it("key an OTA file by its URL, under its feed's listed prefix", async () => {
		const url = "https://example.com/carrier/ATT_US.ipcc?x=1";
		const key = await keys.otaFile("apple", url);
		expect(key).toBe(await keys.otaFile("apple", url));
		expect(key).not.toBe(await keys.otaFile("apple", `${url}2`));
		expect(key.startsWith(keys.otaFilesPrefix("apple"))).toBe(true);
		expect(key).not.toContain("example.com");
		expect(keys.otaCurrent("apple")).not.toBe(keys.otaCurrent("pixel"));
	});

	it("put every tmp/ object under the lifecycle rule that expires it after a day", () => {
		const { rules } = v.parse(
			lifecycleSchema,
			JSON.parse(readFileSync(join(import.meta.dirname, "..", "lifecycle.json"), "utf8")),
		);
		const [
			{
				conditions: { prefix },
			},
		] = rules;
		expect(keys.tmp("ios-build-24A446", "ATT_US.ipcc").startsWith(prefix)).toBe(true);
		expect(keys.tmpPrefix("ios-build-24A446").startsWith(prefix)).toBe(true);
		for (const key of [keys.obj(SHA), keys.profile(SHA), keys.release("ios", "24A446")])
			expect(key.startsWith(prefix)).toBe(false);
	});
});

describe("writes", () => {
	it("write once: an existing key gives null and keeps its bytes", async () => {
		const key = keys.profile(SHA);
		expect(await putJsonOnce(bucket, key, { first: true })).not.toBeNull();
		expect(await putJsonOnce(bucket, key, { first: false })).toBeNull();
		expect(await putOnce(bucket, key, "other", "application/octet-stream")).toBeNull();
		expect(await text(key)).toBe(JSON.stringify({ first: true }));
		expect((await bucket.head(key))?.httpMetadata?.contentType).toBe("application/json");
	});

	it("store an artifact under its sha256 with its kind and content type, once", async () => {
		const body = bytes("an ipcc");
		const sha = sha256(body);
		const stored = await putObj(bucket, sha, body, "apple.ipcc");
		expect(stored?.key).toBe(keys.obj(sha));
		expect(stored?.customMetadata).toEqual({ kind: "apple.ipcc" });
		expect(stored?.httpMetadata?.contentType).toBe("application/zip");
		expect(await putObj(bucket, sha, body, "apple.ipcc")).toBeNull();
	});

	it("reject bytes that do not match the sha256 they are stored under", async () => {
		const sha = sha256(bytes("what was hashed"));
		await expect(putObj(bucket, sha, bytes("what arrived"), "apple.ftab")).rejects.toThrow(
			/SHA-256 checksum/,
		);
		expect(await bucket.head(keys.obj(sha))).toBeNull();
	});

	it("replace a release record when its unit reruns", async () => {
		const key = keys.release("samsung", "S948USQS4AZHL");
		await putJson(bucket, key, { run: 1 });
		await putJson(bucket, key, { run: 2 });
		expect(await text(key)).toBe(JSON.stringify({ run: 2 }));
	});

	it("list every artifact's kind without reading any object", async () => {
		const written: HeldArtifact[] = [];
		for (let i = 0; i < 3; i++) {
			const body = bytes(`carrier list ${i}`);
			written.push({ sha256: sha256(body), kind: "android.carrier-list" });
			await putObj(bucket, sha256(body), body, "android.carrier-list");
		}
		const held: HeldArtifact[] = [];
		for await (const a of heldArtifacts(bucket)) held.push(a);
		expect(held).toEqual(expect.arrayContaining(written));
		expect(held.map((a) => a.kind)).toContain("apple.ipcc");
	});

	it("refuse a listed artifact with no known kind", async () => {
		await bucket.put(keys.obj("f".repeat(64)), "x", { customMetadata: { kind: "apple.unknown" } });
		await expect(async () => {
			for await (const a of heldArtifacts(bucket)) expect(a).toBeDefined();
		}).rejects.toThrow();
		await bucket.delete(keys.obj("f".repeat(64)));
	});
});

describe("readers", () => {
	it("reads a record checked against its contract: null when absent, a RecordError naming the key when broken", async () => {
		const schema = v.object({ sha1: v.string() });
		await putJson(bucket, "ota/pixel/current.json", { sha1: "x" });
		expect(await readRecord(bucket, "ota/pixel/current.json", schema)).toEqual({ sha1: "x" });
		expect(await readRecord(bucket, "ota/pixel/none.json", schema)).toBeNull();
		await putJson(bucket, "ota/pixel/broken.json", { sha1: 1 });
		await expect(readRecord(bucket, "ota/pixel/broken.json", schema)).rejects.toThrow(RecordError);
		await expect(readRecord(bucket, "ota/pixel/broken.json", schema)).rejects.toThrow(
			/ota\/pixel\/broken\.json does not match its contract/,
		);
	});

	it("takes a purge only with the shared bearer", () => {
		expect(purgeRefusal("Bearer t", "t")).toBeNull();
		expect(purgeRefusal("Bearer x", "t")).not.toBeNull();
		expect(purgeRefusal("Bearer t", undefined)).not.toBeNull();
		expect(purgeRefusal(null, "t")).not.toBeNull();
	});

	it("tags what the edge may keep, and purges by that tag alone", async () => {
		const headers = new Headers();
		applyPolicy(headers, { browser: "no-cache", edge: "max-age=60" });
		expect(headers.get("cache-tag")).toBe(INDEX_TAG);
		const purged: unknown[] = [];
		const cache = {
			purge: async (o: { readonly tags: string[] }) => {
				purged.push(o);
				return { success: true, errors: [] };
			},
		};
		expect(await purgeCache(cache)).toBeNull();
		expect(purged).toEqual([{ tags: [INDEX_TAG] }]);
	});
});
