import { createHash } from "node:crypto";

import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { checkKey, keyFromPath, keyPath } from "../src/protocol/keys.ts";
import { handleR2 } from "../src/protocol/r2.ts";
import { memoryStore } from "./memory-store.ts";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const base = "http://r2.internal";
const call = (path: string, init: RequestInit = {}): Request => new Request(base + path, init);
const put = (key: string, body: string, headers: Record<string, string> = {}): Request =>
  call(keyPath("o", key), { method: "PUT", body, headers: { "content-length": String(Buffer.byteLength(body)), ...headers } });

const createdSchema = v.object({ uploadId: v.string() });
const INGEST = { writes: ["obj/", "meta/", "releases/ios/"] };

describe("keys", () => {
  it("round-trips keys with %, ? and spaces through the path", () => {
    const key = "scan/20261003/f/carrier.plist%3A?x y.dat";
    expect(keyFromPath(new URL(base + keyPath("o", key)).pathname, "o")).toBe(key);
  });

  it.each(["", "/abs", "a//b", "a/./b", "a/../b", "a/b/", "a\u0000b", "x".repeat(1025)])("rejects %j", (key) => {
    expect(() => checkKey(key)).toThrow();
  });
});

describe("handleR2", () => {
  it("writes, reads, heads and lists", async () => {
    const store = memoryStore();
    expect((await handleR2(put("releases/ios/23C55.json", "{}"), store, INGEST)).status).toBe(201);
    const got = await handleR2(call(keyPath("o", "releases/ios/23C55.json")), store, INGEST);
    expect(await got.text()).toBe("{}");
    const head = await handleR2(call(keyPath("o", "releases/ios/23C55.json"), { method: "HEAD" }), store, INGEST);
    expect(head.headers.get("content-length")).toBe("2");
    expect((await handleR2(call(keyPath("o", "releases/ios/none.json")), store, INGEST)).status).toBe(404);
  });

  it("pages lists with a cursor", async () => {
    const store = memoryStore();
    for (const k of ["a", "b", "c"]) store.objects.set(`releases/ios/${k}`, new Uint8Array());
    const first: unknown = await (await handleR2(call("/list?prefix=releases/"), store, INGEST)).json();
    expect(first).toEqual({ keys: ["releases/ios/a", "releases/ios/b"], cursor: "2" });
    const second: unknown = await (await handleR2(call("/list?prefix=releases/&cursor=2"), store, INGEST)).json();
    expect(second).toEqual({ keys: ["releases/ios/c"] });
  });

  it("scopes writes to the job's prefixes", async () => {
    const store = memoryStore();
    expect((await handleR2(put("index/carriers.json", "[]"), store, INGEST)).status).toBe(403);
    expect((await handleR2(put("releases/android/x.json", "{}"), store, INGEST)).status).toBe(403);
    expect((await handleR2(put("jobs/x.json", "{}"), store, { writes: ["jobs/"] })).status).toBe(201);
    expect((await handleR2(put("other/x", "{}"), store, { writes: ["other/"] })).status).toBe(403);
    expect(store.objects.has("index/carriers.json")).toBe(false);
  });

  it("requires Content-Length", async () => {
    const req = call(keyPath("o", "releases/ios/a.json"), { method: "PUT", body: new Blob(["{}"]).stream(), duplex: "half" });
    expect((await handleR2(req, memoryStore(), INGEST)).status).toBe(411);
  });

  it("checks obj/ digests and keeps obj/ and meta/ create-only", async () => {
    const store = memoryStore();
    const body = "bundle bytes";
    const key = `obj/${sha(body)}`;
    expect((await handleR2(put(key, body), store, INGEST)).status).toBe(400);
    expect((await handleR2(put(key, body, { "x-sha256": sha("other") }), store, INGEST)).status).toBe(400);
    expect((await handleR2(put(`obj/${sha("x")}`, body, { "x-sha256": sha("x") }), store, INGEST)).status).toBe(400);
    expect((await handleR2(put(key, body, { "x-sha256": sha(body) }), store, INGEST)).status).toBe(201);
    const again = await handleR2(put(key, "different", { "x-sha256": sha(body) }), store, INGEST);
    expect(await again.json()).toEqual({ exists: true });
    expect(new TextDecoder().decode(store.objects.get(key))).toBe(body);
    expect((await handleR2(call(keyPath("o", key), { method: "DELETE" }), store, INGEST)).status).toBe(403);
  });

  it("deletes writable keys", async () => {
    const store = memoryStore();
    store.objects.set("scan/g1/_keys.json", new Uint8Array());
    expect((await handleR2(call(keyPath("o", "scan/g1/_keys.json"), { method: "DELETE" }), store, { writes: ["scan/"] })).status).toBe(204);
    expect(store.objects.size).toBe(0);
  });

  describe("multipart", () => {
    const parts = ["a".repeat(10), "b".repeat(10), "c".repeat(3)];
    const whole = parts.join("");
    const key = `obj/${sha(whole)}`;

    async function upload(store: ReturnType<typeof memoryStore>, digest: string): Promise<Response> {
      const created = await handleR2(call(keyPath("mpu", key), { method: "POST", headers: { "x-sha256": digest } }), store, INGEST);
      expect(created.status).toBe(201);
      const { uploadId } = v.parse(createdSchema, await created.json());
      const done = [];
      for (const [i, p] of parts.entries()) {
        const res = await handleR2(call(`${keyPath("mpu", key)}?uploadId=${uploadId}&part=${i + 1}`, {
          method: "PUT", body: p, headers: { "content-length": String(p.length) },
        }), store, INGEST);
        done.push(await res.json());
      }
      return handleR2(call(`${keyPath("mpu", key)}?uploadId=${uploadId}`, {
        method: "POST", body: JSON.stringify({ parts: done.reverse() }), headers: { "content-type": "application/json" },
      }), store, INGEST);
    }

    it("assembles parts in order and verifies the digest", async () => {
      const store = memoryStore();
      expect((await upload(store, sha(whole))).status).toBe(201);
      expect(new TextDecoder().decode(store.objects.get(key))).toBe(whole);
    });

    it("refuses to start an obj/ upload whose digest is not the key's", async () => {
      const res = await handleR2(call(keyPath("mpu", key), { method: "POST", headers: { "x-sha256": sha("x") } }), memoryStore(), INGEST);
      expect(res.status).toBe(400);
    });

    it("deletes an assembled object that does not hash to its key", async () => {
      const store = memoryStore();
      const created = await handleR2(call(keyPath("mpu", key), { method: "POST", headers: { "x-sha256": sha(whole) } }), store, INGEST);
      const { uploadId } = v.parse(createdSchema, await created.json());
      const wrong = await handleR2(call(`${keyPath("mpu", key)}?uploadId=${uploadId}&part=1`, {
        method: "PUT", body: "nope", headers: { "content-length": "4" },
      }), store, INGEST);
      const res = await handleR2(call(`${keyPath("mpu", key)}?uploadId=${uploadId}`, {
        method: "POST", body: JSON.stringify({ parts: [await wrong.json()] }),
      }), store, INGEST);
      expect(res.status).toBe(400);
      expect(store.objects.has(key)).toBe(false);
    });

    it("is scoped like single puts", async () => {
      const res = await handleR2(call(keyPath("mpu", "index/x"), { method: "POST" }), memoryStore(), INGEST);
      expect(res.status).toBe(403);
    });
  });
});
