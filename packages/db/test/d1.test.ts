// A publish into a local D1 (wrangler's simulator), migrated from ../migrations: what lands, what a second publish
// changes and deletes, that an older publish cannot overwrite a newer one, and how labels reach the index.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildIndexes, indexProfile, PROFILE_SCHEMA, type Label, type Profile, type Release, type SourceRef } from "@carrier-explode/schema";
import {
  carrierOf, carriersAfter, changesAfter, codeNamed, countriesAfter, countryOf, currentPhones, deviceRecords, indexDb, listedSources, liveIndex, namesOf,
  phoneOf, phonesAfter, releaseList, releaseOf, releasesAfter, sourceList, sourceOf, sourcesAfter, statesAfter, statesOn, syncDevices, syncLabels, unnamed,
  writeLabels, type IndexDb,
} from "../src/d1.ts";
import { delta, indexRows, type ListedDevice, type Live, type Statement } from "../src/index.ts";

const proxy = await getPlatformProxy<{ DB: D1Database; UPGRADE: D1Database }>({ configPath: join(import.meta.dirname, "wrangler.jsonc"), persist: false });
const d1 = proxy.env.DB;
let db: IndexDb;

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");
const migrations = readdirSync(MIGRATIONS).sort();

async function migrate(into: D1Database, names: readonly string[]): Promise<void> {
  for (const m of names) {
    const statements = readFileSync(join(MIGRATIONS, m, "migration.sql"), "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    await into.batch(statements.map((s) => into.prepare(s)));
  }
}

beforeAll(async () => {
  await migrate(d1, migrations);
  db = indexDb(d1.withSession());
});

afterAll(() => proxy.dispose());

const run = async (statements: readonly Statement[]): Promise<void> => {
  await d1.batch(statements.map((s) => d1.prepare(s.sql).bind(...s.params)));
};

/** D1 as a publish starting at `readAt` reads it. */
const liveAt = async (readAt: string): Promise<Live> => ({ ...(await liveIndex(db)), readAt });

const ATT_IOS: SourceRef = { platform: "ios", kind: "carrier", name: "ATT_US" };
const ATT_PIXEL: SourceRef = { platform: "android", kind: "carrier", name: "att_us" };

const profile = (source: SourceRef, sha: string, volte: "on" | "no"): Profile => ({
  schema: PROFILE_SCHEMA, source, sha, identity: { display: source.name, iso: ["us"], sims: [{ mccmnc: "310410" }] },
  apns: [], concepts: { volte: { kind: "state", state: volte, because: [], fidelity: "exact" } }, raw: {}, variants: [],
});

function index(iosVersion: string, withPixel: boolean, live: Pick<Live, "devices" | "labels">): ReturnType<typeof indexRows> {
  const releases: Release[] = [
    { platform: "ios", id: "24A1", version: "27.0", label: "27.0", prerelease: false, devices: ["iPhone18,1"], extractedAt: "x", released: "2026-09-15", modems: [],
      sources: { "ios:carrier:ATT_US": { sha: `i${iosVersion}`, cid: "c", version: iosVersion, size: 1 } } },
    ...(withPixel ? [{
      platform: "android", id: "CP3A.1", version: "16", patch: "2026-09", released: "2026-09-02", devices: ["tokay"], extractedAt: "x", carrierList: "l", modems: [],
      sources: { "android:carrier:att_us": [{ sha: "a9", version: "9", size: 1, devices: ["tokay"] }] },
    } as const satisfies Release] : []),
  ];
  const profiles = new Map([[`i${iosVersion}`, indexProfile(profile(ATT_IOS, `i${iosVersion}`, "on"))], ["a9", indexProfile(profile(ATT_PIXEL, "a9", "no"))]]);
  return indexRows(buildIndexes({
    releases, otaFiles: [], devices: live.devices, labels: live.labels, profiles: (sha) => profiles.get(sha), manifestSims: {}, modemConfigs: () => undefined, carrierIds: {},
  }));
}

/** A publish of `index` as D1 holds it at `readAt`, applied. */
async function publish(readAt: string, iosVersion: string, withPixel: boolean): Promise<Awaited<ReturnType<typeof delta>>> {
  const live = await liveAt(readAt);
  const out = await delta(index(iosVersion, withPixel, live), live);
  await run(out.statements);
  return out;
}

describe("publishing the index into D1", () => {
  it("lands every table, and reads back through the site's queries", async () => {
    const { changed } = await publish("2026-10-04T10:00:00.000Z", "72.0", true);
    expect(changed).toEqual(["android:carrier:att_us", "ios:carrier:ATT_US"]);
    expect((await releaseList(db)).map((r) => r.id)).toEqual(["24A1", "CP3A.1"]);
    expect((await sourceList(db, "android", "carrier")).map((s) => [s.key, s.carrier.id, s.carrier.members])).toEqual([
      ["android:carrier:att_us", "ATT_US", ["android:carrier:att_us", "ios:carrier:ATT_US"]],
    ]);
    const source = await sourceOf(db, "ios:carrier:ATT_US");
    expect(source?.timeline.kind === "apple" && source.timeline.main.map((e) => e.slug)).toEqual(["72.0"]);
    expect(await statesOn(db, "tokay")).toEqual([{ source: "android:carrier:att_us", states: { volte: "no" } }]);
    expect(await currentPhones(db)).toEqual([
      { code: "iPhone18,1", name: "iPhone18,1", platform: "ios", has5G: true }, { code: "tokay", name: "tokay", platform: "android", has5G: true },
    ]);
    expect((await liveIndex(db)).builtAt).toBe("2026-10-04T10:00:00.000Z");
    expect((await liveIndex(db)).carriers).toEqual({ "android:carrier:att_us": "ATT_US", "ios:carrier:ATT_US": "ATT_US" });
  });

  it("writes only what changed, deletes what the new index lacks, and names the sources whose pages that changes", async () => {
    const { changed } = await publish("2026-10-04T11:00:00.000Z", "72.1", false);
    expect(changed).toEqual(["android:carrier:att_us", "ios:carrier:ATT_US"]);
    expect((await releaseList(db)).map((r) => r.id)).toEqual(["24A1"]);
    expect(await sourceOf(db, "android:carrier:att_us")).toBeUndefined();
    expect(await statesOn(db, "tokay")).toEqual([]);
    const source = await sourceOf(db, "ios:carrier:ATT_US");
    expect(source?.timeline.kind === "apple" && source.timeline.main.map((e) => e.slug)).toEqual(["72.1"]);
  });

  it("writes nothing but its time when nothing changed", async () => {
    const live = await liveAt("2026-10-04T12:00:00.000Z");
    const { statements, changed } = await delta(index("72.1", false, live), live);
    expect(statements).toHaveLength(1);
    expect(changed).toEqual([]);
    await run(statements);
    expect((await liveIndex(db)).builtAt).toBe("2026-10-04T12:00:00.000Z");
  });

  it("deletes hundreds of rows within D1's 100 parameters and SQLite's expression depth, composite keys included", async () => {
    const live = await liveAt("2026-10-04T12:30:00.000Z");
    const stalePhones = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [JSON.stringify([`device${i}`, "ios:carrier:Gone"]), "h"]));
    const staleLegacy = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [JSON.stringify([`/gone/${i}`]), "h"]));
    const { statements } = await delta(index("72.1", false, live), { ...live, hashes: { ...live.hashes, phone_states: stalePhones, legacy: staleLegacy } });
    expect(statements.length).toBeGreaterThan(5);
    expect(Math.max(...statements.map((s) => s.params.length))).toBeLessThanOrEqual(100);
    await run(statements);
  });

  it("never lets an older publish overwrite a newer one", async () => {
    const live = await liveAt("2026-10-04T09:00:00.000Z");
    await run((await delta(index("72.0", true, live), { ...live, hashes: { ...live.hashes, sources: {} } })).statements);
    const source = await sourceOf(db, "ios:carrier:ATT_US");
    expect(source?.timeline.kind === "apple" && source.timeline.main.map((e) => e.slug)).toEqual(["72.1"]);
    expect((await liveIndex(db)).builtAt).toBe("2026-10-04T12:30:00.000Z");
  });

  it("reads D1 before anything else, so what a later write changes is in the next publish", async () => {
    const before = new Date().toISOString();
    const { readAt } = await liveIndex(db);
    expect(readAt >= before && readAt <= new Date().toISOString()).toBe(true);
  });
});

describe("lookups by many keys", () => {
  it("finds sources among more keys than D1 binds in one statement", async () => {
    const keys = [...Array.from({ length: 250 }, (_, i) => `ios:carrier:Gone${i}` as const), "ios:carrier:ATT_US" as const];
    expect((await listedSources(db, keys)).map((s) => s.key)).toEqual(["ios:carrier:ATT_US"]);
  });
});

describe("labels", () => {
  const name = (subject: Label["subject"], code: string, value: string, origin: Label["origin"]): Label =>
    ({ subject, code, field: "name", value, origin, evidence: origin === "human" ? null : "https://example.com" });

  it("are written over by the same or a more trusted origin only: for a name, a feed's, then a person's, then the model's", async () => {
    expect(await unnamed(db, "carrier")).toEqual(["ATT_US"]);
    await writeLabels(db, [name("carrier", "ATT_US", "AT and T", "model")], "t1");
    await writeLabels(db, [name("carrier", "ATT_US", "AT&T", "human")], "t2");
    await writeLabels(db, [name("carrier", "ATT_US", "ATT?", "model")], "t3");
    expect((await liveIndex(db)).labels.filter((l) => l.code === "ATT_US").map((l) => [l.value, l.origin])).toEqual([["AT&T", "human"]]);
    expect(await unnamed(db, "carrier")).toEqual([]);
  });

  it("refuse a value that does not fit its field, or an origin it does not take", async () => {
    await expect(writeLabels(db, [{ subject: "device", code: "tokay", field: "released", value: "August", origin: "human", evidence: null }], "t")).rejects.toThrow();
    await expect(writeLabels(db, [{ subject: "device", code: "tokay", field: "released", value: "2024-08", origin: "model", evidence: null }], "t")).rejects.toThrow();
    await expect(writeLabels(db, [name("device", "tokay", " Pixel 9", "feed")], "t")).rejects.toThrow();
  });

  it("let a person's release day stand over a feed's", async () => {
    await writeLabels(db, [{ subject: "device", code: "bluejay", field: "released", value: "2022-04", origin: "human", evidence: null }], "t1");
    await writeLabels(db, [{ subject: "device", code: "bluejay", field: "released", value: "2025-07", origin: "feed", evidence: "https://example.com" }], "t2");
    expect((await liveIndex(db)).labels.filter((l) => l.code === "bluejay").map((l) => [l.field, l.value, l.origin])).toContainEqual(["released", "2022-04", "human"]);
  });

  it("from a feed are written only where they changed", async () => {
    const listed = [{ code: "iPhone18,1", value: "iPhone 17 Pro" }, { code: "tokay", value: "Pixel 9" }];
    expect(await syncLabels(db, "device", "name", listed, "https://api.ipsw.me", "t4")).toBe(2);
    expect(await syncLabels(db, "device", "name", listed, "https://api.ipsw.me", "t5")).toBe(0);
    expect(await unnamed(db, "device")).toEqual([]);
  });

  it("reach pages only through a publish, which names carriers in their rows and codes in `names`, and changes every page when a name does", async () => {
    expect((await sourceList(db, "ios", "carrier"))[0]?.carrier.name).toBe("ATT_US");
    expect(await namesOf(db, "device", ["iPhone18,1"])).toEqual(new Map());
    const { changed } = await publish("2026-10-04T13:00:00.000Z", "72.1", false);
    expect(changed).toBe("everything");
    expect((await sourceList(db, "ios", "carrier"))[0]?.carrier.name).toBe("AT&T");
    expect(await namesOf(db, "device", ["iPhone18,1", "tokay", "nothing"])).toEqual(new Map([["iPhone18,1", "iPhone 17 Pro"], ["tokay", "Pixel 9"]]));
    expect(await codeNamed(db, "device", "Pixel 9")).toBe("tokay");
    expect(await currentPhones(db)).toEqual([{ code: "iPhone18,1", name: "iPhone 17 Pro", platform: "ios", has5G: true }]);
  });

  it("change only the carrier's pages when only a carrier's name changes", async () => {
    await writeLabels(db, [name("carrier", "ATT_US", "AT&T Mobility", "human")], "t6");
    const { changed } = await publish("2026-10-04T14:00:00.000Z", "72.1", false);
    expect(changed).toEqual(["ios:carrier:ATT_US"]);
  });
});

describe("devices", () => {
  const tokay = (released: string, evidence = "https://example.com/feed"): ListedDevice => ({ code: "tokay", family: "android", released, boards: [], evidence });
  const iphone: ListedDevice = { code: "iPhone18,1", family: "apple", released: "2025-09-19", boards: ["V53AP"], evidence: "https://example.com/appledb" };
  const held = async (): Promise<Array<{ code: string; released: string; boards: readonly string[] }>> =>
    (await deviceRecords(db)).map(({ code, released, boards }) => ({ code, released, boards })).sort((a, b) => a.code.localeCompare(b.code));
  const evidence = async (code: string): Promise<unknown> => (await d1.prepare("SELECT evidence FROM devices WHERE code = ?").bind(code).first())?.["evidence"];

  it("start empty: the feeds fill them", async () => {
    expect(await held()).toEqual([]);
  });

  it("keep a device's earliest release and the page that gave it, and rewrite only what changed", async () => {
    expect(await syncDevices(db, [tokay("2024-08"), iphone], "t1")).toBe(2);
    expect(await syncDevices(db, [tokay("2025-01", "https://example.com/later"), iphone], "t2")).toBe(0);
    expect(await syncDevices(db, [tokay("2024-07", "https://example.com/earlier"), { ...iphone, boards: ["V53AP", "V53DEV"] }], "t3")).toBe(2);
    expect(await held()).toEqual([{ code: "iPhone18,1", released: "2025-09-19", boards: ["V53AP", "V53DEV"] }, { code: "tokay", released: "2024-07", boards: [] }]);
    expect(await evidence("tokay")).toBe("https://example.com/earlier");
    expect((await liveIndex(db)).devices.find((d) => d.code === "tokay")?.released).toBe("2024-07");
  });
});

describe("migrations", () => {
  it("carry the labels the earlier ones held over as names, and add the two Pixel release days", async () => {
    const upgrade = proxy.env.UPGRADE;
    const reshaped = migrations.findIndex((m) => m.endsWith("_labels_generic"));
    await migrate(upgrade, migrations.slice(0, reshaped));
    await upgrade.prepare("INSERT INTO labels (kind, code, text, origin, evidence, updated) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)")
      .bind("device", "tokay", "Pixel 9", "feed", "https://developers.google.com/android/ota", "t", "carrier", "ATT_US", "AT&T", "model", "https://example.com", "t").run();
    await migrate(upgrade, migrations.slice(reshaped));
    const rows = await upgrade.prepare("SELECT subject, code, field, value, origin, evidence FROM labels ORDER BY subject, code, field").all();
    expect(rows.results).toEqual([
      { subject: "carrier", code: "ATT_US", field: "name", value: "AT&T", origin: "model", evidence: "https://example.com" },
      { subject: "device", code: "bluejay", field: "released", value: "2022-04", origin: "human", evidence: expect.stringContaining("source.android.com") },
      { subject: "device", code: "sunfish", field: "released", value: "2020-05", origin: "human", evidence: expect.stringContaining("source.android.com") },
      { subject: "device", code: "tokay", field: "name", value: "Pixel 9", origin: "feed", evidence: "https://developers.google.com/android/ota" },
      { subject: "modem", code: "Mav24", field: "name", value: "Qualcomm X71M", origin: "human", evidence: expect.stringContaining("TechInsights") },
      { subject: "modem", code: "Mav25", field: "name", value: "Qualcomm X80", origin: "human", evidence: null },
    ]);
    const tables = await upgrade.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('phone_radios', 'phones', 'names') ORDER BY name").all();
    expect(tables.results).toEqual([{ name: "names" }, { name: "phones" }]);
  });
});

describe("pages", () => {
  const carrier = (name: string, mccmnc: string, sha: string): Profile => ({ ...profile({ platform: "ios", kind: "carrier", name }, sha, "on"), identity: { iso: ["us"], sims: [{ mccmnc }] } });
  const profiles = new Map([["p1", carrier("ATT_US", "310410", "p1")], ["p2", carrier("TMobile_US", "310260", "p2")], ["p3", carrier("Verizon_US", "311480", "p3")]]);
  const releases: Release[] = [
    { platform: "ios", id: "24B1", version: "27.1", label: "27.1", prerelease: false, devices: ["iPhone18,1"], extractedAt: "x", released: "2026-10-01", modems: [],
      sources: { "ios:carrier:ATT_US": { sha: "p1", cid: "c1", version: "1", size: 1 }, "ios:carrier:TMobile_US": { sha: "p2", cid: "c2", version: "1", size: 1 }, "ios:carrier:Verizon_US": { sha: "p3", cid: "c3", version: "1", size: 1 } } },
    { platform: "ios", id: "24A1", version: "27.0", label: "27.0", prerelease: false, devices: ["iPhone18,1"], extractedAt: "x", released: "2026-09-15", modems: [],
      sources: { "ios:carrier:ATT_US": { sha: "p1", cid: "c1", version: "1", size: 1 } } },
  ];

  beforeAll(async () => {
    const live = await liveAt("2026-10-04T13:00:00.000Z");
    const index = buildIndexes({
      releases, otaFiles: [], devices: live.devices, labels: live.labels, profiles: (s) => { const p = profiles.get(s); return p && indexProfile(p); }, manifestSims: {},
      modemConfigs: () => undefined, carrierIds: {},
    });
    await run((await delta(indexRows(index), live)).statements);
  });

  it("resume each list after the last key read, in the index's order", async () => {
    const names = async (after: string | null): Promise<string[]> => (await sourcesAfter(db, "ios", "carrier", { after, take: 2 })).map((s) => s.name);
    expect(await names(null)).toEqual(["ATT_US", "TMobile_US"]);
    expect(await names("TMobile_US")).toEqual(["Verizon_US"]);
    expect((await carriersAfter(db, { after: "ATT_US", take: 5 })).map((c) => c.id)).toEqual(["TMobile_US", "Verizon_US"]);
    expect((await countriesAfter(db, { after: null, take: 5 })).map((c) => c.iso)).toEqual(["us"]);
    const [newest, ...older] = await releasesAfter(db, "ios", { after: null, take: 5 });
    expect([newest?.summary.id, ...older.map((r) => r.summary.id)]).toEqual(["24B1", "24A1"]);
    expect((await releasesAfter(db, "ios", { after: newest?.sort ?? -1, take: 5 })).map((r) => r.summary.id)).toEqual(["24A1"]);
    expect((await changesAfter(db, "ios", "24B1", { after: "ios:carrier:ATT_US", take: 5 })).map((c) => [c.source, c.kind]))
      .toEqual([["ios:carrier:TMobile_US", "added"], ["ios:carrier:Verizon_US", "added"]]);
    expect((await statesAfter(db, "iPhone18,1", { after: null, take: 1 })).map((s) => s.source)).toEqual(["ios:carrier:ATT_US"]);
    expect(await phonesAfter(db, "ios", { after: null, take: 5 })).toEqual([{ code: "iPhone18,1", name: "iPhone 17 Pro", platform: "ios", has5G: true }]);
    expect(await phonesAfter(db, "android", { after: null, take: 5 })).toEqual([]);
  });

  it("look one up by its key", async () => {
    expect((await carrierOf(db, "Verizon_US"))?.carrier.members).toEqual(["ios:carrier:Verizon_US"]);
    expect(await carrierOf(db, "Nope")).toBeUndefined();
    expect((await countryOf(db, "us"))?.carriers).toEqual(["ATT_US", "TMobile_US", "Verizon_US"]);
    expect((await releaseOf(db, "ios", "24A1"))?.version).toBe("27.0");
    expect(await releaseOf(db, "android", "24A1")).toBeUndefined();
    expect((await phoneOf(db, "iPhone18,1"))?.platform).toBe("ios");
  });
});
