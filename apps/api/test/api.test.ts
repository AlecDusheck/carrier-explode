// The API against wrangler's local D1 and R2, in memory: an index published the way the extractor publishes one, the
// decoded records it names in the bucket, and requests through the app as the Worker serves them.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { delta, indexRows } from "@carrier-explode/db";
import { indexDb, liveIndex } from "@carrier-explode/db/d1";
import { buildIndexes, indexProfile, PROFILE_SCHEMA, type Profile, type Release, type SourceRef } from "@carrier-explode/schema";
import { keys } from "@carrier-explode/storage";
import { api } from "../src/api.ts";
import { DEFAULT_LIMIT, encodeCursor } from "../src/page.ts";

const proxy = await getPlatformProxy<Env>({ configPath: join(import.meta.dirname, "..", "wrangler.jsonc"), persist: false });
const env = { ...proxy.env, PURGE_TOKEN: "t" };

const ios = (name: string): SourceRef => ({ platform: "ios", kind: "carrier", name });
const PIXEL: SourceRef = { platform: "android", kind: "carrier", name: "att_us" };
const sha = (n: number): string => n.toString(16).padStart(64, "0");

const profile = (source: SourceRef, at: string): Profile => ({
  schema: PROFILE_SCHEMA, source, sha: at, identity: { iso: ["us"], sims: [{ mccmnc: "310410" }] },
  apns: [{ apn: "phone", types: ["default"], hasPassword: false, path: "carrier.plist:apns[0]" }],
  concepts: { volte: { kind: "state", state: "on", because: [], fidelity: "exact" } },
  raw: { "carrier.plist:apns[0].apn": "phone", "carrier.plist:SupportsVoLTE": true },
  variants: [],
});

const RELEASES: Release[] = [
  { platform: "ios", id: "24A2", version: "27.1", label: "27.1", prerelease: false, devices: ["iPhone18,1"], extractedAt: "x", released: "2026-10-01", modems: [],
    sources: { "ios:carrier:ATT_US": { sha: sha(2), cid: "c2", version: "72.1", size: 1 }, "ios:carrier:TMobile_US": { sha: sha(3), cid: "c3", version: "50.0", size: 1 }, "ios:carrier:Verizon_US": { sha: sha(4), cid: "c4", version: "60.0", size: 1 } } },
  { platform: "ios", id: "24A1", version: "27.0", label: "27.0", prerelease: false, devices: ["iPhone18,1"], extractedAt: "x", released: "2026-09-15", modems: [],
    sources: { "ios:carrier:ATT_US": { sha: sha(1), cid: "c1", version: "72.0", size: 1 } } },
  { platform: "android", id: "CP3A.1", version: "16", patch: "2026-09", released: "2026-09-02", devices: ["tokay"], extractedAt: "x", carrierList: "l", modems: [],
    sources: { "android:carrier:att_us": [{ sha: sha(9), version: "9", size: 1, devices: ["tokay"] }] } },
];

const PROFILES = new Map<string, Profile>([
  [sha(1), profile(ios("ATT_US"), sha(1))], [sha(2), profile(ios("ATT_US"), sha(2))], [sha(3), profile(ios("TMobile_US"), sha(3))],
  [sha(4), profile(ios("Verizon_US"), sha(4))], [sha(9), profile(PIXEL, sha(9))],
]);

beforeAll(async () => {
  const d1 = env.DB;
  const dir = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
  for (const m of readdirSync(dir).sort()) {
    const statements = readFileSync(join(dir, m, "migration.sql"), "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    await d1.batch(statements.map((s) => d1.prepare(s)));
  }
  const live = await liveIndex(indexDb(d1));
  const index = buildIndexes({
    releases: RELEASES, otaFiles: [], devices: live.devices, labels: live.labels, profiles: (s) => { const p = PROFILES.get(s); return p && indexProfile(p); },
    manifestSims: {}, modemConfigs: () => undefined, carrierIds: {},
  });
  const { statements } = await delta(indexRows(index), live);
  await d1.batch(statements.map((s) => d1.prepare(s.sql).bind(...s.params)));
  for (const [at, p] of PROFILES) await env.BUCKET.put(keys.norm(at), JSON.stringify(p));
});

afterAll(() => proxy.dispose());

const get = (path: string): Promise<Response> => Promise.resolve(api.request(path, {}, env));
const body = async (path: string): Promise<unknown> => (await get(path)).json();

describe("lists", () => {
  it("come a page at a time, each resuming after the last one's key", async () => {
    const first = await get("/v1/ios/carriers?limit=2");
    expect(first.status).toBe(200);
    const page = await first.json();
    expect(page).toMatchObject({ items: [{ key: "ios:carrier:ATT_US", carrier: { id: "ATT_US", iso: "us" } }, { key: "ios:carrier:TMobile_US" }] });
    expect(page).toHaveProperty("next.cursor", encodeCursor("TMobile_US"));
    expect(page).toHaveProperty("next.url", `http://localhost/v1/ios/carriers?cursor=${encodeCursor("TMobile_US")}&limit=2`);
    expect(await body(`/v1/ios/carriers?cursor=${encodeCursor("TMobile_US")}&limit=2`)).toMatchObject({
      items: [{ key: "ios:carrier:Verizon_US", name: "Verizon_US", carrier: { iso: "us" }, updated: "2026-10-01" }],
      next: null,
    });
  });

  it("order builds newest first, and a version's line newest first", async () => {
    expect(await body("/v1/ios/builds?limit=1")).toMatchObject({ items: [{ id: "24A2" }], next: { cursor: expect.any(String) } });
    expect(await body("/v1/ios/carriers/ATT_US/versions")).toMatchObject({ items: [{ slug: "72.1" }, { slug: "72.0" }], next: null });
  });

  it("refuse a cursor the API did not write", async () => {
    const res = await get("/v1/ios/carriers?cursor=bm90LWEta2V5");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { status: 400 } });
  });
});

describe("URLs", () => {
  it("have one spelling: parameters in order, the default limit left out", async () => {
    const reordered = await get("/v1/ios/carriers?limit=2&cursor=abc");
    expect(reordered.status).toBe(308);
    expect(reordered.headers.get("location")).toBe("http://localhost/v1/ios/carriers?cursor=abc&limit=2");
    expect((await get(`/v1/ios/carriers?limit=${DEFAULT_LIMIT}`)).headers.get("location")).toBe("http://localhost/v1/ios/carriers");
  });

  it("refuse a parameter the route does not take, in the error shape", async () => {
    const res = await get("/v1/ios/carriers/ATT_US?file=carrier.plist");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { status: 400, message: expect.stringContaining("file") } });
  });

  it("name builds and phones before the source kinds their segments would also match", async () => {
    expect((await get("/v1/ios/builds/24A1")).status).toBe(200);
    expect((await get("/v1/ios/phones")).status).toBe(200);
    expect((await get("/v1/android/countries")).status).toBe(404);
  });
});

describe("versions", () => {
  it("answer the decoded profile, its native settings apart", async () => {
    const version = await body("/v1/ios/carriers/ATT_US/latest");
    expect(version).toMatchObject({ key: "ios:carrier:ATT_US", line: null, entry: { slug: "72.1" }, previous: "72.0", profile: { apns: [{ apn: "phone" }], concepts: { volte: { state: "on" } } } });
    expect(version).not.toHaveProperty("profile.raw");
    expect(await body("/v1/ios/carriers/ATT_US/72.0/settings")).toEqual({
      key: "ios:carrier:ATT_US", line: null, slug: "72.0", settings: { "carrier.plist:apns[0].apn": "phone", "carrier.plist:SupportsVoLTE": true },
    });
  });

  it("default an Android source to its newest device's line", async () => {
    expect(await body("/v1/android/carriers/att_us/latest")).toMatchObject({ line: "tokay", entry: { slug: "9" } });
    expect((await get("/v1/android/carriers/att_us/latest?line=nope")).status).toBe(404);
    expect(await body("/v1/android/carriers/att_us/latest/modems")).toEqual([]);
  });

  it("serve no file as it shipped", async () => {
    expect((await get("/v1/ios/carriers/ATT_US/72.1/files")).status).toBe(404);
    expect((await get(`/v1/android/modem-configs/${sha(1)}`)).status).toBe(404);
  });

  it("are a 500 in the error shape when a stored record breaks its contract", async () => {
    await env.BUCKET.put(keys.norm(sha(4)), JSON.stringify({ schema: PROFILE_SCHEMA }));
    const res = await get("/v1/ios/carriers/Verizon_US/60.0");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { status: 500, message: expect.stringContaining("does not match its contract") } });
    await env.BUCKET.put(keys.norm(sha(4)), JSON.stringify(PROFILES.get(sha(4))));
  });
});

describe("caching", () => {
  it("keeps a pinned version long and tags it with its source, which a publish purges", async () => {
    const pinned = await get("/v1/ios/carriers/ATT_US/72.0");
    const latest = await get("/v1/ios/carriers/ATT_US/latest");
    expect(pinned.headers.get("cache-tag")).toBe("ios:carrier:ATT_US");
    expect(pinned.headers.get("cloudflare-cdn-cache-control")).toBe(`max-age=${env.CACHE_TTL.pinned}, stale-while-revalidate=${env.CACHE_TTL.staleWhileRevalidate}`);
    expect(latest.headers.get("cloudflare-cdn-cache-control")).toBe(`max-age=${env.CACHE_TTL.latest}, stale-while-revalidate=${env.CACHE_TTL.staleWhileRevalidate}`);
    expect(pinned.headers.get("cache-control")).toBe("no-cache");
  });

  it("tags a list with the index, keeps a miss briefly, and never keeps an error", async () => {
    expect((await get("/v1/carriers")).headers.get("cache-tag")).toBe("index");
    expect((await get("/v1/ios/carriers/Nope")).headers.get("cloudflare-cdn-cache-control")).toBe(`max-age=${env.CACHE_TTL.missing}`);
    expect((await get("/v1/ios/carriers?bogus=1")).headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers a matching If-None-Match with a 304", async () => {
    const tag = (await get("/v1/platforms")).headers.get("etag") ?? "";
    expect((await api.request("/v1/platforms", { headers: { "if-none-match": tag } }, env)).status).toBe(304);
  });

  it("opens every answer to any origin", async () => {
    expect((await get("/v1/platforms")).headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("the OpenAPI document", () => {
  it("lists every route, with each answer's schema from its contract", async () => {
    const doc = await body("/openapi.json");
    expect(doc).toHaveProperty("openapi", "3.1.0");
    expect(doc).toHaveProperty(["paths", "/v1/{platform}/{kind}/{name}/{version}", "get", "operationId"], "getVersion");
    expect(doc).toHaveProperty(["components", "schemas", "Version", "properties", "profile", "properties", "concepts"]);
    expect(doc).toHaveProperty(["components", "schemas", "Settings", "properties", "settings", "additionalProperties", "$ref"], "#/components/schemas/Settings.0");
    expect(doc).toHaveProperty(["components", "schemas", "Settings.0", "anyOf"]);
  });
});
