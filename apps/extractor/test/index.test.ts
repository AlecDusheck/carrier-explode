// Indexing units (../src/indexing.ts) into a local D1 migrated from packages/db, from records in a local R2:
// the same unit twice writes nothing the second time; an older build indexed after a newer one leaves both correct.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as v from "valibot";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
	changesOf,
	deviceList,
	entriesOf,
	indexDb,
	releaseOf,
	sourceOf,
	statesOn,
	syncDevices,
	type IndexDb,
} from "@carrier-explode/db";
import {
	PROFILE_SCHEMA,
	type AndroidRelease,
	type AppleRelease,
	type Profile,
	type SourceKey,
} from "@carrier-explode/schema/types";
import { keys, putJson } from "@carrier-explode/storage";
import { type IndexContext, type IndexMessage, indexUnit } from "../src/indexing.ts";
import { devicesSynced, queue, type QueueEnv } from "../src/queues.ts";
import { reindexArtifacts } from "../src/reindex.ts";
import { permanent } from "../src/errors.ts";
import { batchOf, MemQueue } from "./queues.ts";

// A test makes hundreds of D1 queries in turn, each a round trip to workerd.
vi.setConfig({ testTimeout: 30_000 });

const proxy = await getPlatformProxy<{ DB: D1Database; BUCKET: R2Bucket }>({
	configPath: join(import.meta.dirname, "wrangler.jsonc"),
	persist: false,
});
const { DB: d1, BUCKET: bucket } = proxy.env;
let db: IndexDb;

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");

const ios = (id: string): IndexMessage => ({ kind: "release", release: { platform: "ios", id: [id] } });
const pixel = (build: string, device: string): IndexMessage => ({
	kind: "release",
	release: { platform: "android", id: [build, device] },
});

const ATT: SourceKey<"ios"> = "ios:carrier:ATT_US";
const TMO: SourceKey<"ios"> = "ios:carrier:TMobile_US";

const profile = (
	key: SourceKey<"ios">,
	sha: string,
	display: string,
	mccmnc: string,
	volte: "on" | "no",
	overrides: Profile["raw"] = {},
): Profile => ({
	schema: PROFILE_SCHEMA,
	source: { platform: "ios", kind: "carrier", name: key.split(":")[2] ?? "" },
	sha,
	identity: { display, iso: ["us"], sims: [{ mccmnc }] },
	apns: [],
	concepts: { volte: { kind: "state", state: volte, because: [], fidelity: "exact" } },
	raw: { "carrier.plist:SupportsVoLTE": volte === "on", ...overrides },
	variants: [],
});

const release = (
	id: string,
	version: string,
	released: string,
	sources: Record<SourceKey<"ios">, readonly [sha: string, version: string]>,
): AppleRelease => ({
	platform: "ios",
	id,
	version,
	label: version,
	prerelease: false,
	released,
	devices: ["iPhone18,1", "iPhone12,8"],
	extractedAt: "2026-10-05T00:00:00Z",
	sources: Object.fromEntries(
		Object.entries(sources).map(([key, [sha, ver]]) => [key, { sha, version: ver, size: 1, cid: sha }]),
	),
	modems: [],
});

const OLDER = release("24A100", "27.0", "2026-09-15", { [ATT]: ["att1", "70.0"], [TMO]: ["tmo1", "60.0"] });
const NEWER = release("24B200", "27.1", "2026-10-20", { [ATT]: ["att2", "71.0"], [TMO]: ["tmo1", "60.0"] });

const PIXEL_ATT: SourceKey<"android"> = "android:carrier:att_us";
const PIXEL_TMO: SourceKey<"android"> = "android:carrier:tmobile_us";

const pixelProfile = (
	key: SourceKey<"android">,
	sha: string,
	display: string,
	volte: "on" | "no",
): Profile => ({
	schema: PROFILE_SCHEMA,
	source: { platform: "android", kind: "carrier", name: key.split(":")[2] ?? "" },
	sha,
	identity: { display, iso: ["us"], sims: [] },
	apns: [],
	concepts: { volte: { kind: "state", state: volte, because: [], fidelity: "exact" } },
	raw: { "carrier_config:volte": volte === "on" },
	variants: [],
});

const PIXEL_DEFAULT: SourceKey<"android"> = "android:default:default";

/** The build's default.pb, under every carrier file: NSA 5G only. */
const pixelDefault: Profile = {
	schema: PROFILE_SCHEMA,
	source: { platform: "android", kind: "default", name: "default" },
	sha: "pdef1",
	identity: { iso: [], sims: [] },
	apns: [],
	concepts: {},
	raw: { "config:carrier_nr_availabilities_int_array": [1] },
	variants: [],
};

/** An empty carrier_list.pb at version 1: routes nothing. */
const CARRIER_LIST = { sha: "list1", bytes: Uint8Array.from([0x10, 0x01]) };

/** One Pixel's record of a build: the files it ships, each its device's alone. */
const pixelRecord = (
	build: string,
	version: string,
	patch: string,
	device: string,
	sources: Record<SourceKey<"android">, readonly [sha: string, version: string]>,
): AndroidRelease => ({
	platform: "android",
	id: build,
	version,
	patch,
	devices: [device],
	extractedAt: "2026-10-05T00:00:00Z",
	carrierList: CARRIER_LIST.sha,
	modems: [],
	sources: Object.fromEntries(
		Object.entries(sources).map(([key, [sha, ver]]) => [
			key,
			[{ sha, version: ver, size: 1, devices: [device] }],
		]),
	),
});

const PIXEL_OLD = "BP4A.251005.001";
const PIXEL_NEW = "CP3A.260905.009";
const PIXEL_RECORDS = [
	pixelRecord(PIXEL_OLD, "16", "2025-10", "frankel", {
		[PIXEL_ATT]: ["patt1", "9"],
		[PIXEL_DEFAULT]: ["pdef1", "1"],
	}),
	pixelRecord(PIXEL_NEW, "17", "2026-09", "frankel", {
		[PIXEL_ATT]: ["patt2", "10"],
		[PIXEL_TMO]: ["ptmo1", "3"],
		[PIXEL_DEFAULT]: ["pdef1", "1"],
	}),
	// Another Pixel of the same build ships the same files.
	pixelRecord(PIXEL_NEW, "17", "2026-09", "rango", {
		[PIXEL_ATT]: ["patt2", "10"],
		[PIXEL_TMO]: ["ptmo1", "3"],
		[PIXEL_DEFAULT]: ["pdef1", "1"],
	}),
];

/** Every row of every table but facts_written, which counts every facts message, in a stable order. */
async function dump(): Promise<Record<string, unknown[]>> {
	const tables = await d1
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'facts_written' ORDER BY name",
		)
		.all<{ name: string }>();
	const rows = async (name: string): Promise<string[]> =>
		(await d1.prepare(`SELECT * FROM "${name}"`).all()).results.map((r) => JSON.stringify(r)).toSorted();
	return Object.fromEntries(
		await Promise.all(tables.results.map(async ({ name }) => [name, await rows(name)] as const)),
	);
}

const radios = async (): Promise<Record<string, boolean | null>> =>
	Object.fromEntries((await deviceList(db, "ios")).map((d) => [d.code, d.has5g]));

let ctx: IndexContext;

/** A message and every message it hands on, indexed in turn, as the queue's consumer would: whether any wrote, so the readers purge. */
async function index(first: IndexMessage): Promise<{ readonly wrote: boolean }> {
	let wrote = false;
	for (let m: IndexMessage | null = first; m !== null;) {
		const done = await indexUnit(ctx, m);
		wrote ||= done.wrote;
		m = done.next;
	}
	return { wrote };
}

beforeAll(async () => {
	for (const m of readdirSync(MIGRATIONS).toSorted()) {
		const statements = readFileSync(join(MIGRATIONS, m, "migration.sql"), "utf8")
			.split("--> statement-breakpoint")
			.map((s) => s.trim())
			.filter(Boolean);
		await d1.batch(statements.map((s) => d1.prepare(s)));
	}
	db = indexDb(d1);
	ctx = { db, bucket };
	await syncDevices(db, [
		{ code: "iPhone18,1", platform: "ios", released: "2025-09-19", boards: ["V53AP"] },
		{ code: "iPhone12,8", platform: "ios", released: "2020-04-24", boards: ["D79AP"] },
	]);
	// Apple gives the 5G switch only to a phone with a 5G radio; the older build's file would wrongly give it to the LTE phone.
	const att1 = profile(ATT, "att1", "AT&T", "310410", "no", { "overrides_D79.plist:Show5GSwitch": true });
	const att2 = profile(ATT, "att2", "AT&T", "310410", "on", {
		"overrides_V53.plist:Show5GSwitch": true,
		"overrides_D79.plist:ShowCallForwarded": true,
	});
	for (const p of [att1, att2, profile(TMO, "tmo1", "T-Mobile", "310260", "on")]) {
		await putJson(bucket, keys.norm(p.sha), p);
	}
	for (const r of [OLDER, NEWER]) await putJson(bucket, keys.release("ios", r.id), r);

	await syncDevices(db, [
		{ code: "frankel", platform: "android", released: "2025-08-20", boards: [] },
		{ code: "rango", platform: "android", released: "2024-10-01", boards: [] },
	]);
	for (const p of [
		pixelProfile(PIXEL_ATT, "patt1", "AT&T", "no"),
		pixelProfile(PIXEL_ATT, "patt2", "AT&T", "on"),
		pixelProfile(PIXEL_TMO, "ptmo1", "T-Mobile", "on"),
		pixelDefault,
	]) {
		await putJson(bucket, keys.norm(p.sha), p);
	}
	await bucket.put(keys.obj(CARRIER_LIST.sha), CARRIER_LIST.bytes);
	for (const r of PIXEL_RECORDS) await putJson(bucket, keys.release("android", r.id, r.devices[0] ?? ""), r);
});

/** The rows each table gained and lost between two dumps. */
function delta(
	before: Record<string, unknown[]>,
	after: Record<string, unknown[]>,
): Record<string, { added: unknown[]; removed: unknown[] }> {
	return Object.fromEntries(
		Object.keys(after).flatMap((table) => {
			const was = new Set(before[table] ?? []),
				is = new Set(after[table] ?? []);
			const added = [...is].filter((r) => !was.has(r)),
				removed = [...was].filter((r) => !is.has(r));
			return added.length + removed.length === 0
				? []
				: [
						[
							table,
							{
								added: added.map((r): unknown => JSON.parse(String(r))),
								removed: removed.map((r): unknown => JSON.parse(String(r))),
							},
						],
					];
		}),
	);
}

afterAll(() => proxy.dispose());

describe("the Index", () => {
	it("indexes a build, and writes nothing when indexing it again", async () => {
		const first = await index(ios(NEWER.id));
		// Linking its new carriers shows in every response that read a source.
		expect(first).toEqual({ wrote: true });
		expect((await sourceOf(db, ATT))?.headSha).toBe("att2");
		expect((await sourceOf(db, ATT))?.carrier).not.toBeNull();
		expect(await radios()).toEqual({ "iPhone18,1": true, "iPhone12,8": false });
		expect(await statesOn(db, "iPhone18,1", { after: null, take: 10 })).toEqual([
			{ source: ATT, states: { volte: "on" }, defaults: {} },
			{ source: TMO, states: { volte: "on" }, defaults: {} },
		]);
		// The platform's first build changes nothing.
		expect(await changesOf(db, "ios", NEWER.id, { after: null, take: 10 })).toEqual([]);

		const held = await dump();
		expect(await index(ios(NEWER.id))).toEqual({ wrote: false });
		expect(await dump()).toEqual(held);
	});

	it("derives phone states for every phone an indexed release lists, whatever the ingest scope", async () => {
		// iPhone12,8 came out before the scope's releasedSince: scope filters ingest, never what is held.
		expect(await statesOn(db, "iPhone12,8", { after: null, take: 10 })).toEqual([
			{ source: ATT, states: { volte: "on" }, defaults: {} },
			{ source: TMO, states: { volte: "on" }, defaults: {} },
		]);
	});

	it("indexes an older build after a newer one: its own changes, and the newer build's against it", async () => {
		const backfill = await index(ios(OLDER.id));
		expect(backfill.wrote).toBe(true);
		expect(await changesOf(db, "ios", OLDER.id, { after: null, take: 10 })).toEqual([]);
		expect(await changesOf(db, "ios", NEWER.id, { after: null, take: 10 })).toEqual([
			{
				source: ATT,
				kind: "changed",
				from: { line: "", slug: "70.0", version: "70.0" },
				to: { line: "", slug: "71.0", version: "71.0" },
			},
		]);
		expect((await entriesOf(db, ATT)).map((e) => [e.slug, e.sha, e.changed, e.day])).toEqual([
			["71.0", "att2", true, "2026-10-20"],
			["70.0", "att1", true, "2026-09-15"],
		]);
		// The head stays the newer build's, and so does each phone's radio.
		expect((await sourceOf(db, ATT))?.headSha).toBe("att2");
		expect(await radios()).toEqual({ "iPhone18,1": true, "iPhone12,8": false });

		const held = await dump();
		for (const id of [OLDER.id, NEWER.id]) expect((await index(ios(id))).wrote).toBe(false);
		expect(await dump()).toEqual(held);
	});
});

describe("the Index, one Pixel's record at a time", () => {
	it("indexes one device's record of a build, and writes nothing indexing it again", async () => {
		expect(await index(pixel(PIXEL_NEW, "frankel"))).toEqual({ wrote: true });
		expect(await releaseOf(db, "android", PIXEL_NEW)).toMatchObject({ devices: ["frankel"], sourceCount: 3 });
		// Each carrier is read over the default.pb its build ships, whose leaves scans read.
		expect(
			await d1
				.prepare("SELECT key, base_sha AS base FROM sources WHERE platform = 'android' ORDER BY key")
				.all(),
		).toMatchObject({
			results: [
				{ key: PIXEL_ATT, base: "pdef1" },
				{ key: PIXEL_TMO, base: "pdef1" },
				{ key: PIXEL_DEFAULT, base: null },
			],
		});
		expect(await d1.prepare("SELECT sha, key, value FROM base_settings").all()).toMatchObject({
			results: [{ sha: "pdef1", key: "carrier_nr_availabilities_int_array", value: "[1]" }],
		});

		const held = await dump();
		expect(await index(pixel(PIXEL_NEW, "frankel"))).toEqual({ wrote: false });
		expect(await dump()).toEqual(held);
	});

	it("adds a second device of the same build as that device's rows alone", async () => {
		const before = await dump();
		expect(await index(pixel(PIXEL_NEW, "rango"))).toEqual({ wrote: true });
		const d = delta(before, await dump());
		// The build ships no modem, so rango's radio stays unknown and its device row is untouched.
		expect(Object.keys(d).toSorted()).toEqual(["copies", "entries", "phone_states", "releases"]);
		expect((await deviceList(db, "android")).find((p) => p.code === "rango")?.has5g).toBeNull();
		expect(
			[d.copies, d.entries]
				.flatMap((t) => t?.added ?? [])
				.every((r) => v.is(v.object({ line: v.literal("rango") }), r)),
		).toBe(true);
		expect([d.copies, d.entries].flatMap((t) => t?.removed ?? [])).toEqual([]);
		expect(d.phone_states?.added.every((r) => v.is(v.object({ device: v.literal("rango") }), r))).toBe(true);
		expect(d.phone_states?.removed).toEqual([]);
		// The build's one row, now listing both devices, newest first.
		expect(d.releases?.removed).toMatchObject([{ id: PIXEL_NEW, devices: JSON.stringify(["frankel"]) }]);
		expect(d.releases?.added).toMatchObject([
			{ id: PIXEL_NEW, devices: JSON.stringify(["frankel", "rango"]), source_count: 3 },
		]);

		const held = await dump();
		for (const device of ["rango", "frankel"])
			expect((await index(pixel(PIXEL_NEW, device))).wrote).toBe(false);
		expect(await dump()).toEqual(held);
	});

	it("indexes an older build's device after the newer build: the newer build's changes are against it", async () => {
		expect((await index(pixel(PIXEL_OLD, "frankel"))).wrote).toBe(true);
		expect(await changesOf(db, "android", PIXEL_OLD, { after: null, take: 10 })).toEqual([]);
		expect(await changesOf(db, "android", PIXEL_NEW, { after: null, take: 10 })).toEqual([
			{
				source: PIXEL_ATT,
				kind: "changed",
				from: { line: "frankel", slug: "9", version: "9" },
				to: { line: "frankel", slug: "10", version: "10" },
			},
			{ source: PIXEL_TMO, kind: "added", to: { line: "frankel", slug: "3", version: "3" } },
		]);
		expect((await entriesOf(db, PIXEL_ATT)).map((e) => [e.line, e.slug, e.sha])).toEqual([
			["frankel", "10", "patt2"],
			["frankel", "9", "patt1"],
			["rango", "10", "patt2"],
		]);
		expect((await sourceOf(db, PIXEL_ATT))?.headSha).toBe("patt2");
		// Each carrier's own VoLTE; 5G Standalone, which neither sets, from the build's default.pb.
		const frankel = await statesOn(db, "frankel", { after: null, take: 10 });
		expect(
			frankel.map((r) => [
				r.source,
				r.states.volte,
				r.defaults.volte,
				r.states["5g-standalone"],
				r.defaults["5g-standalone"]?.layer,
			]),
		).toEqual([
			[PIXEL_ATT, "on", undefined, "no", "default.pb"],
			[PIXEL_TMO, "on", undefined, "no", "default.pb"],
		]);

		const held = await dump();
		for (const [build, device] of [
			[PIXEL_OLD, "frankel"],
			[PIXEL_NEW, "frankel"],
			[PIXEL_NEW, "rango"],
		] as const) {
			expect((await index(pixel(build, device))).wrote).toBe(false);
		}
		expect(await dump()).toEqual(held);
	});
});

describe("the index queue's consumer", () => {
	const env = (): QueueEnv & {
		readonly INDEX_QUEUE: MemQueue<IndexMessage>;
		readonly PURGE_QUEUE: MemQueue<object>;
	} => ({
		DB: d1,
		BUCKET: bucket,
		INDEX_QUEUE: new MemQueue(),
		PURGE_QUEUE: new MemQueue(),
		PURGE_ORIGINS: undefined,
		PURGE_TOKEN: undefined,
	});

	it("queues only the chain a message hands on, never a record again", async () => {
		const e = env();
		const kinds: string[] = [];
		for (let pending: unknown[] = [ios(NEWER.id), pixel(PIXEL_NEW, "rango")]; pending.length > 0;) {
			const batch = batchOf("carrier-explode-index", pending.splice(0, 1));
			await queue(batch, e);
			expect(batch.acked()).toBe(1);
			const next = e.INDEX_QUEUE.take();
			kinds.push(...next.map((m) => m.kind));
			pending.push(...next);
		}
		expect(new Set(kinds)).toEqual(new Set(["settle", "rederive", "derive"]));
	});

	it("derives a platform once after a burst of facts: only the last settle message rederives", async () => {
		const e = env();
		const consume = async (body: unknown): Promise<IndexMessage[]> => {
			await queue(batchOf("carrier-explode-index", [body]), e);
			return e.INDEX_QUEUE.take();
		};
		const [first] = await consume(ios(NEWER.id));
		const [last] = await consume(ios(OLDER.id));
		expect(last).toMatchObject({ kind: "settle", platform: "ios" });
		expect(await consume(first)).toEqual([]);
		expect(await consume(last)).toEqual([{ kind: "rederive", platform: "ios" }]);
	});

	it("leaves deriving to a running reindex: a settle message after one of its records rederives nothing", async () => {
		const e = env();
		const consume = async (body: unknown): Promise<IndexMessage[]> => {
			await queue(batchOf("carrier-explode-index", [body]), e);
			return e.INDEX_QUEUE.take();
		};
		const [settle] = await consume(ios(NEWER.id));
		await consume({ kind: "reindex", platform: "ios", after: null });
		expect(await consume(settle)).toEqual([]);
	});

	it("acknowledges a message once it is indexed, queueing what it hands on, and writes nothing for a message seen before", async () => {
		const e = env();
		const held = await dump();
		const batch = batchOf("carrier-explode-index", [ios(NEWER.id)]);
		await queue(batch, e);
		expect(batch.acked()).toBe(1);
		// The release's facts are held; a settle message follows, and nothing changed to purge.
		expect(e.INDEX_QUEUE.take()).toMatchObject([{ kind: "settle", platform: "ios" }]);
		expect(e.PURGE_QUEUE.take()).toEqual([]);
		expect(delta(held, await dump())).toEqual({});
	});

	it("refuses a message that is no index message, leaving it to be retried", async () => {
		const batch = batchOf("carrier-explode-index", [
			{ kind: "release", release: { platform: "ios", id: [] } },
		]);
		await expect(queue(batch, env())).rejects.toThrow();
		expect(batch.acked()).toBe(0);
	});

	it("derives every source of a record again when its profiles were read under an older PROFILE_SCHEMA, writing only what differs", async () => {
		const before = await dump();
		// As a PROFILE_SCHEMA bump leaves it: att2's rows from an older schema, and its profile now reading VoLTE as "no".
		await d1.prepare("UPDATE profiles SET schema = schema - 1 WHERE sha = 'att2'").run();
		const att2 = profile(ATT, "att2", "AT&T", "310410", "no", {
			"overrides_V53.plist:Show5GSwitch": true,
			"overrides_D79.plist:ShowCallForwarded": true,
		});
		await bucket.put(keys.norm("att2"), JSON.stringify(att2));
		expect(await index(ios(NEWER.id))).toEqual({ wrote: true });
		const d = delta(before, await dump());
		expect(Object.keys(d).toSorted()).toEqual(["concepts", "phone_states", "settings"]);
		expect(d.concepts?.added).toEqual([{ source: ATT, concept: "volte", value: '"no"' }]);
		expect(d.phone_states?.added.every((r) => v.is(v.object({ source: v.literal(ATT) }), r))).toBe(true);
	});
});

describe("a feed's devices", () => {
	it("derive their platform again when a device's release day moves, which moves its sources' heads", async () => {
		const VZW: SourceKey<"android"> = "android:carrier:verizon_us";
		const BUILD = "AP1A.240505.004";
		await syncDevices(db, [
			{ code: "caiman", platform: "android", released: "2025-01-01", boards: [] },
			{ code: "komodo", platform: "android", released: "2024-12-01", boards: [] },
		]);
		for (const p of [
			pixelProfile(VZW, "pvzw1", "Verizon", "on"),
			pixelProfile(VZW, "pvzw2", "Verizon", "no"),
		])
			await putJson(bucket, keys.norm(p.sha), p);
		for (const [device, sha] of [
			["caiman", "pvzw1"],
			["komodo", "pvzw2"],
		] as const) {
			await putJson(
				bucket,
				keys.release("android", BUILD, device),
				pixelRecord(BUILD, "15", "2024-05", device, { [VZW]: [sha, "1"] }),
			);
			await index(pixel(BUILD, device));
		}
		// The newest phone's line heads the source.
		expect((await sourceOf(db, VZW))?.headSha).toBe("pvzw1");

		const queues = { INDEX_QUEUE: new MemQueue<IndexMessage>(), PURGE_QUEUE: new MemQueue<object>() };
		const devices = await syncDevices(db, [
			{ code: "caiman", platform: "android", released: "2024-06-01", boards: [] },
		]);
		await devicesSynced(queues, "android", { devices, names: 0 });
		expect(queues.INDEX_QUEUE.take()).toEqual([{ kind: "rederive", platform: "android" }]);
		expect(queues.PURGE_QUEUE.take()).toEqual([{}]);
		await index({ kind: "rederive", platform: "android" });
		expect((await sourceOf(db, VZW))?.headSha).toBe("pvzw2");
	});

	it("purge pages, and derive nothing, when only names change", async () => {
		const queues = { INDEX_QUEUE: new MemQueue<IndexMessage>(), PURGE_QUEUE: new MemQueue<object>() };
		await devicesSynced(queues, "ios", { devices: 0, names: 1 });
		expect(queues.INDEX_QUEUE.take()).toEqual([]);
		expect(queues.PURGE_QUEUE.take()).toEqual([{}]);
	});
});

describe("reindexing", () => {
	it("links again by a link rule added since, though no source's identity changed", async () => {
		await index(ios(NEWER.id));
		const carrierOf = async (k: SourceKey): Promise<string | null | undefined> =>
			(await sourceOf(db, k))?.carrier;
		expect(await carrierOf(ATT)).not.toBe(await carrierOf(TMO));
		const rule = d1
			.prepare("INSERT INTO links (a, b, rule, why) VALUES (?, ?, 'link', 'test')")
			.bind(ATT, TMO);
		await rule.run();
		expect(await index(ios(NEWER.id))).toEqual({ wrote: true });
		expect(await carrierOf(ATT)).toBe(await carrierOf(TMO));
		await d1.prepare("DELETE FROM links WHERE a = ? AND b = ?").bind(ATT, TMO).run();
		await index(ios(NEWER.id));
		expect(await carrierOf(ATT)).not.toBe(await carrierOf(TMO));
	});

	it("normalizes each held record's artifacts that lack a norm object for a reindex of all, each sha once, by kind", async () => {
		expect(await reindexArtifacts(bucket, { kind: "all", platform: "ios" })).toEqual([]);
		const unheld = ["tmo1", "att1"];
		const held = await Promise.all(unheld.map(async (sha) => (await bucket.get(keys.norm(sha)))?.text()));
		await Promise.all(unheld.map((sha) => bucket.delete(keys.norm(sha))));
		expect(await reindexArtifacts(bucket, { kind: "all", platform: "ios" })).toEqual([
			{ kind: "apple.ipcc", sha: "att1", source: ATT },
			{ kind: "apple.ipcc", sha: "tmo1", source: TMO },
		]);
		await Promise.all(
			unheld.map((sha, i) => {
				const json = held[i];
				if (json === undefined) throw new Error(`${sha} was not held`);
				return bucket.put(keys.norm(sha), json);
			}),
		);
	});

	it("writes each held record's facts in key order, deriving nothing until all are written, then the platform", async () => {
		for (const id of [OLDER.id, NEWER.id]) await index(ios(id));
		// As a PROFILE_SCHEMA bump leaves the index, and NEWER's own att2 not normalized again yet.
		await d1.prepare("UPDATE profiles SET schema = schema - 1 WHERE sha IN ('att1', 'att2', 'tmo1')").run();
		const att2 = await bucket.get(keys.norm("att2"));
		const att2Json = await att2?.text();
		if (att2Json === undefined) throw new Error("att2 is not held");
		await bucket.delete(keys.norm("att2"));
		// A record indexed as its unit would derives ATT, whose head is NEWER's att2.
		await expect(index(ios(OLDER.id))).rejects.toThrow(/missing/);

		const derived = async (): Promise<unknown[]> =>
			Object.entries(await dump()).flatMap(([t, rows]) =>
				["sources", "entries", "settings", "concepts", "phone_states", "changes"].includes(t) ? [rows] : [],
			);
		const before = await derived();
		const first = await indexUnit(ctx, { kind: "reindex", platform: "ios", after: null });
		expect(first.next).toEqual({ kind: "reindex", platform: "ios", after: keys.release("ios", OLDER.id) });
		expect(await derived()).toEqual(before);

		await bucket.put(keys.norm("att2"), att2Json);
		const second = await indexUnit(ctx, first.next ?? ios(""));
		expect(second.next).toEqual({ kind: "reindex", platform: "ios", after: keys.release("ios", NEWER.id) });
		expect(await derived()).toEqual(before);
		expect(await indexUnit(ctx, second.next ?? ios(""))).toEqual({
			wrote: false,
			next: { kind: "rederive", platform: "ios" },
		});
		expect(
			(await d1.prepare("SELECT DISTINCT schema FROM profiles WHERE sha IN ('att1', 'att2', 'tmo1')").all())
				.results,
		).toEqual([{ schema: PROFILE_SCHEMA }]);
		await index({ kind: "rederive", platform: "ios" });
		expect((await sourceOf(db, ATT))?.headSha).toBe("att2");
	});

	it("fails a release the bucket lacks for good, without retries", async () => {
		const missing = reindexArtifacts(bucket, {
			kind: "release",
			release: { platform: "ios", id: ["00A000"] },
		});
		await expect(missing).rejects.toThrow("missing");
		expect(permanent(await missing.catch((e: unknown) => e))).toBe(true);
	});
});
