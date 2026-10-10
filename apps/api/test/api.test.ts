// The API against wrangler's local D1 and R2, in memory: an index written through packages/db the way the index step
// writes one, the normalized profiles it names in the bucket, and requests through the app as the Worker serves them.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as v from "valibot";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
	copiesOf,
	deviceList,
	headIdentities,
	indexDb,
	linkRules,
	putProfiles,
	putRelease,
	putSource,
	shippedIn,
	syncChanges,
	syncCopies,
	syncDevices,
	syncEntries,
	syncPhoneStates,
	syncRoutes,
	writeLabels,
	writeLinked,
	type IndexDb,
	type IndexedRelease,
	type ModemConfigRow,
	type ModemRow,
} from "@carrier-explode/db";
import {
	baseSource,
	head,
	lastChanged,
	linkCarriers,
	newestFirst,
	phoneHeads,
	phoneStates,
	profileFacts,
	releaseChanges,
	sourceBase,
	sourceTimeline,
	MODEM_SCHEMA,
	PROFILE_SCHEMA,
	type ConceptValue,
	type Profile,
	type SourceRef,
} from "@carrier-explode/schema";
import { isReleasePlatform, parseSourceKey, type SourceKey } from "@carrier-explode/schema/types";
import { keys } from "@carrier-explode/storage";

const proxy = await getPlatformProxy<Env>({
	configPath: join(import.meta.dirname, "..", "wrangler.jsonc"),
	environment: "dev",
	persist: false,
});
const env = { ...proxy.env, PURGE_TOKEN: "t" };

vi.doMock("cloudflare:workers", () => ({ env }));
const { api } = await import("../src/api.ts");
const { encodeCursor } = await import("../src/page.ts");

const sha = (n: number): string => n.toString(16).padStart(64, "0");

const DEVICES = [
	{ code: "iPhone18,1", platform: "ios", released: "2025-09-19", boards: [] },
	{ code: "tokay", platform: "android", released: "2024-08-22", boards: [] },
	{ code: "SM-S948U", platform: "samsung", released: "2026-02-25", boards: [] },
] as const;

const header = { sourceCount: 0 };
const RELEASES: ReadonlyArray<readonly [IndexedRelease, readonly ModemRow[], readonly ModemConfigRow[]]> = [
	[
		{
			...header,
			platform: "ios",
			id: "24A1",
			version: "27.0",
			label: "27.0",
			prerelease: false,
			released: "2026-09-15",
			devices: ["iPhone18,1"],
			sortKey: "27.0 24A1",
		},
		[],
		[],
	],
	[
		{
			...header,
			platform: "ios",
			id: "24A2",
			version: "27.1",
			label: "27.1",
			prerelease: false,
			released: "2026-10-01",
			devices: ["iPhone18,1"],
			sortKey: "27.1 24A2",
		},
		[
			{
				name: "Mav25",
				family: "Mav25",
				devices: ["iPhone18,1"],
				package: sha(7),
				size: 137554454,
				kind: "bbfw",
			},
		],
		[],
	],
	[
		{
			...header,
			platform: "android",
			id: "CP3A.1",
			version: "16",
			patch: "2026-09",
			released: "2026-09-02",
			devices: ["tokay"],
			sortKey: "16 2026-09",
		},
		[{ name: "g5300", family: "shannon", devices: ["tokay"], package: null, size: null, kind: null }],
		[{ device: "tokay", label: "us_att", sha: sha(8) }],
	],
	[
		{
			...header,
			platform: "samsung",
			id: "S948USQS4AZHL",
			version: "17",
			released: "2026-09-20",
			devices: ["SM-S948U"],
			sortKey: "17 S948USQS4AZHL",
		},
		[{ name: "S948U-CP", family: "qualcomm", devices: ["SM-S948U"], package: null, size: null, kind: null }],
		[{ device: "SM-S948U", label: "Commercial-Test", sha: sha(11) }],
	],
];

/** Each release's copies: source, line, sha, version. */
const COPIES: Readonly<Record<string, ReadonlyArray<readonly [SourceKey, string, number, string]>>> = {
	"24A1": [["ios:carrier:ATT_US", "", 1, "72.0"]],
	"24A2": [
		["ios:carrier:ATT_US", "", 2, "72.1"],
		["ios:carrier:TMobile_US", "", 3, "50.0"],
		["ios:carrier:Verizon_US", "", 4, "60.0"],
		["ios:carrier:Sakura_jp", "", 12, "5.0"],
	],
	"CP3A.1": [
		["android:carrier:att_us", "tokay", 9, "9"],
		["android:carrier:mvno_us", "tokay", 14, "3"],
		["android:default:default", "tokay", 13, "1"],
	],
	S948USQS4AZHL: [["samsung:carrier:ATT", "SM-S948U", 10, "1.0"]],
};

/** Each source's display name, SIM and country; a Pixel's file claims no SIMs, its carrier list routes them. */
const IDENTITY: Readonly<Record<string, readonly [string, string, string]>> = {
	ATT_US: ["AT&T", "310410", "us"],
	att_us: ["AT&T", "310410", "us"],
	ATT: ["AT&T", "310410", "us"],
	TMobile_US: ["T-Mobile", "310260", "us"],
	Verizon_US: ["Verizon", "311480", "us"],
	Sakura_jp: ["Sakura", "44099", "jp"],
	mvno_us: ["Test MVNO", "310260", "us"],
	default: ["", "", ""],
};

const on = (): ConceptValue => ({ kind: "state", state: "on", because: [], fidelity: "exact" });

/** What differs from VoLTE on alone: AT&T's 72.1 and Sakura's bundle add 5G SA, AT&T's 72.1 a setting. */
const MORE: Readonly<Record<number, Pick<Profile, "concepts" | "raw">>> = {
	2: {
		concepts: { volte: on(), "5g-standalone": on() },
		raw: {
			"carrier.plist:apns[0].apn": "phone",
			"carrier.plist:SupportsVoLTE": true,
			"carrier.plist:SupportsNR": true,
		},
	},
	12: {
		concepts: { volte: on(), "5g-standalone": on() },
		raw: { "carrier.plist:apns[0].apn": "phone", "carrier.plist:SupportsVoLTE": true },
	},
};

const refOf = (key: SourceKey): SourceRef => {
	const ref = parseSourceKey(key);
	if (ref === undefined) throw new Error(`${key}: not a source key`);
	return ref;
};

function profile(key: SourceKey, n: number): Profile {
	const source = refOf(key);
	const [display, mccmnc, iso] = IDENTITY[source.name] ?? ["", "", ""];
	return {
		schema: PROFILE_SCHEMA,
		source,
		sha: sha(n),
		identity: {
			...(display === "" ? {} : { display }),
			iso: iso === "" ? [] : [iso],
			sims: source.platform === "android" || mccmnc === "" ? [] : [{ mccmnc }],
		},
		apns: [{ apn: "phone", types: ["default"], path: "carrier.plist:apns[0]" }],
		concepts: MORE[n]?.concepts ?? { volte: on() },
		raw: MORE[n]?.raw ?? { "carrier.plist:apns[0].apn": "phone", "carrier.plist:SupportsVoLTE": true },
		variants: [],
	};
}

const PROFILES: readonly Profile[] = Object.values(COPIES)
	.flat()
	.map(([key, , n]) => profile(key, n));

/** What the index step writes for these releases: facts, each source's timeline, head and phone states, changes, then the carrier link. */
async function index(db: IndexDb): Promise<void> {
	await syncDevices(db, DEVICES);
	await writeLabels(db, [
		{
			subject: "device",
			code: "SM-S948U",
			field: "name",
			value: "Galaxy Test",
			origin: "human",
			evidence: null,
		},
	]);
	for (const [release, modems, configs] of RELEASES) {
		await putRelease(db, release, modems, configs);
		const copies = (COPIES[release.id] ?? []).map(([source, line, n, version]) => ({
			source,
			line,
			sha: sha(n),
			version,
		}));
		const [line, ...more] = release.platform === "ios" ? [""] : release.devices;
		if (line === undefined) throw new Error(`${release.id}: no line`);
		await syncCopies(db, { kind: "release", id: release.id, lines: [line, ...more], copies });
	}
	await putProfiles(db, [
		...PROFILES.map(profileFacts),
		{
			sha: sha(8),
			schema: MODEM_SCHEMA,
			kind: "modem",
			display: null,
			iso: [],
			sims: ["310410"],
			radio: "nr",
		},
		{ sha: sha(11), schema: MODEM_SCHEMA, kind: "modem", display: null, iso: [], sims: [], radio: "nr" },
	]);
	for (const key of new Set(
		Object.values(COPIES)
			.flat()
			.map(([source]) => source),
	)) {
		const ref = refOf(key);
		const phones = isReleasePlatform(ref.platform) ? await deviceList(db, ref.platform) : [];
		const order = newestFirst(phones);
		const copies = await copiesOf(db, key, ref.platform);
		const timeline = sourceTimeline(copies);
		const newest = head(ref, timeline, order);
		if (newest === undefined) throw new Error(`${key}: no head`);
		const baseKey = baseSource(ref.platform);
		const base = baseKey === null ? [] : await copiesOf(db, baseKey, ref.platform);
		const heads = phoneHeads(
			{ source: ref, copies, timeline, order, base },
			phones.map((p) => p.code),
		);
		await syncEntries(db, key, timeline);
		await putSource(db, {
			key,
			platform: ref.platform,
			kind: ref.kind,
			name: ref.name,
			headSha: newest.sha,
			baseSha: sourceBase(heads, order),
			updated: lastChanged(timeline),
		});
		await syncPhoneStates(
			db,
			key,
			phoneStates(heads, (s) => PROFILES.find((p) => p.sha === s), phones),
		);
	}
	const order = newestFirst(DEVICES.map(({ code, released }) => ({ code, released, name: code })));
	await syncChanges(
		db,
		"ios",
		"24A2",
		releaseChanges(await shippedIn(db, "ios", "24A1"), await shippedIn(db, "ios", "24A2"), order),
	);
	await syncRoutes(db, ["android"], {
		"android:carrier:att_us": ["310410"],
		"android:carrier:mvno_us": ["310260|gid1=6D"],
	});
	await writeLinked(db, linkCarriers(await headIdentities(db), await linkRules(db)));
}

beforeAll(async () => {
	const d1 = env.DB;
	const dir = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
	for (const m of readdirSync(dir).toSorted()) {
		const statements = readFileSync(join(dir, m, "migration.sql"), "utf8")
			.split("--> statement-breakpoint")
			.map((s) => s.trim())
			.filter(Boolean);
		await d1.batch(statements.map((s) => d1.prepare(s)));
	}
	await index(indexDb(d1));
	for (const p of PROFILES) await env.BUCKET.put(keys.profile(p.sha), JSON.stringify(p));
});

afterAll(() => proxy.dispose());

const get = (path: string): Promise<Response> => Promise.resolve(api.request(path, {}, env));
const body = async (path: string): Promise<unknown> => (await get(path)).json();

const ATT = "ATT_US";

describe("the index", () => {
	it("lists every collection with an example on this origin", async () => {
		const listing = await body("/v1");
		expect(listing).toMatchObject({ openapi: "http://localhost/openapi.json" });
		const { resources } = v.parse(
			v.object({ resources: v.array(v.object({ path: v.string(), example: v.string() })) }),
			listing,
		);
		expect(resources.map((r) => r.path)).toContain("/v1/sims");
		for (const { example } of resources.filter((r) => !r.example.includes("{")))
			expect([example, (await get(example)).status]).toEqual([example, expect.toBeOneOf([200, 404])]);
	});

	it("names every concept profiles read, features being the state ones", async () => {
		const concepts = await body("/v1/concepts");
		expect(concepts).toContainEqual(expect.objectContaining({ id: "volte", type: "state", needs5G: false }));
		expect(concepts).toContainEqual(expect.objectContaining({ type: "number", unit: expect.any(String) }));
	});
});

describe("lists", () => {
	it("come a page at a time, each resuming after the last one's key", async () => {
		const first = await get("/v1/ios/carriers?limit=2");
		expect(first.status).toBe(200);
		const page = await first.json();
		expect(page).toMatchObject({
			items: [{ key: "ios:carrier:ATT_US", carrier: { name: "AT&T" } }, { key: "ios:carrier:Sakura_jp" }],
		});
		expect(page).toHaveProperty("next.cursor", encodeCursor("Sakura_jp"));
		expect(page).toHaveProperty(
			"next.url",
			`http://localhost/v1/ios/carriers?cursor=${encodeCursor("Sakura_jp")}&limit=2`,
		);
		expect(await body(`/v1/ios/carriers?cursor=${encodeCursor("Sakura_jp")}&limit=2`)).toMatchObject({
			items: [{ key: "ios:carrier:TMobile_US" }, { key: "ios:carrier:Verizon_US", updated: "2026-10-01" }],
			next: null,
		});
	});

	it("refuse a cursor the API did not write, or a key no longer in a list read whole", async () => {
		const res = await get("/v1/ios/carriers?cursor=bm90LWEta2V5");
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { status: 400, code: "bad_request" } });
		expect((await get(`/v1/ios/carriers/ATT_US/versions?cursor=${encodeCursor("1.0")}`)).status).toBe(400);
	});
});

describe("URLs", () => {
	it("have one spelling: parameters in order, the default limit left out", async () => {
		const reordered = await get("/v1/ios/carriers?limit=2&cursor=abc");
		expect(reordered.status).toBe(308);
		expect(reordered.headers.get("location")).toBe("http://localhost/v1/ios/carriers?cursor=abc&limit=2");
		expect((await get(`/v1/ios/carriers?limit=${env.API_PAGE_LIMITS.default}`)).headers.get("location")).toBe(
			"http://localhost/v1/ios/carriers",
		);
		const encoded = await get("/v1/compare?a=ios%3Acarrier%3AATT_US&b=samsung%3Acarrier%3AATT");
		expect(encoded.status).toBe(308);
		expect(encoded.headers.get("location")).toBe(
			"http://localhost/v1/compare?a=ios:carrier:ATT_US&b=samsung:carrier:ATT",
		);
	});

	it("refuse a parameter the route does not take, in the error shape", async () => {
		const res = await get("/v1/ios/carriers/ATT_US?file=carrier.plist");
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			error: { status: 400, code: "bad_request", message: expect.stringContaining("file") },
		});
	});

	it("name shared collections and builds before the platform paths their segments would also match", async () => {
		expect((await get("/v1/carriers")).status).toBe(200);
		expect((await get("/v1/devices")).status).toBe(200);
		expect((await get("/v1/ios/builds/24A1")).status).toBe(200);
		expect((await get("/v1/android/countries")).status).toBe(404);
	});

	it("answer an unknown route with where to look", async () => {
		const res = await get("/v2/carriers");
		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
	});
});

describe("carriers", () => {
	it("are found by any of their sources' native names, by country and by platform", async () => {
		expect(await body("/v1/carriers?q=att_us")).toMatchObject({ items: [{ id: ATT, name: "AT&T" }] });
		expect(await body("/v1/carriers?q=sakura")).toMatchObject({ items: [{ id: "Sakura_jp" }] });
		expect(await body("/v1/carriers?country=jp")).toMatchObject({ items: [{ id: "Sakura_jp", iso: "jp" }] });
		expect(await body("/v1/carriers?platform=samsung")).toMatchObject({ items: [{ id: ATT }], next: null });
	});

	it("link one carrier's sources across platforms, each with its head", async () => {
		expect(await body(`/v1/carriers/${ATT}`)).toEqual({
			id: ATT,
			name: "AT&T",
			iso: "us",
			platforms: ["android", "ios", "samsung"],
			updated: "2026-10-01",
			sources: [
				{
					key: "android:carrier:att_us",
					platform: "android",
					kind: "carrier",
					name: "att_us",
					updated: "2026-09-02",
					head: { line: "tokay", slug: "9", version: "9" },
				},
				{
					key: "ios:carrier:ATT_US",
					platform: "ios",
					kind: "carrier",
					name: "ATT_US",
					updated: "2026-10-01",
					head: { line: "", slug: "72.1", version: "72.1" },
				},
				{
					key: "samsung:carrier:ATT",
					platform: "samsung",
					kind: "carrier",
					name: "ATT",
					updated: "2026-09-20",
					head: { line: "SM-S948U", slug: "1.0", version: "1.0" },
				},
			],
		});
		const missing = await get("/v1/carriers/Nope");
		expect(missing.status).toBe(404);
		expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });
	});

	it("answer one feature on each platform's newest phone", async () => {
		expect(await body(`/v1/carriers/${ATT}/features?feature=volte`)).toEqual({
			items: [
				{
					source: "android:carrier:att_us",
					device: { code: "tokay", name: "tokay", platform: "android" },
					states: { volte: "on" },
					defaults: {},
				},
				{
					source: "ios:carrier:ATT_US",
					device: { code: "iPhone18,1", name: "iPhone18,1", platform: "ios" },
					states: { volte: "on" },
					defaults: {},
				},
				{
					source: "samsung:carrier:ATT",
					device: { code: "SM-S948U", name: "Galaxy Test", platform: "samsung" },
					states: { volte: "on" },
					defaults: {},
				},
			],
		});
		expect(await body(`/v1/carriers/${ATT}/features?device=iPhone18,1`)).toMatchObject({
			items: [{ source: "ios:carrier:ATT_US", states: { volte: "on", "5g-standalone": "on" } }],
		});
	});

	it("answer each source's head decoded, only the fields asked for", async () => {
		const profiles = await body(`/v1/carriers/${ATT}/profiles?fields=apns`);
		expect(profiles).toMatchObject({
			items: [
				{ source: "android:carrier:att_us", line: "tokay", slug: "9", profile: { apns: [{ apn: "phone" }] } },
				{ source: "ios:carrier:ATT_US", line: "", slug: "72.1", profile: { sha: sha(2) } },
				{ source: "samsung:carrier:ATT", line: "SM-S948U" },
			],
		});
		expect(profiles).not.toHaveProperty("items.0.profile.concepts");
		expect((await get(`/v1/carriers/${ATT}/profiles?fields=raw`)).status).toBe(400);
	});

	it("answer the modem configurations their SIMs select, never a Galaxy's that selects none", async () => {
		expect(await body(`/v1/carriers/${ATT}/modems`)).toEqual({
			items: [
				{
					platform: "android",
					release: "CP3A.1",
					firmware: "g5300",
					label: "us_att",
					sha: sha(8),
					family: "shannon",
					familyName: expect.any(String),
					devices: ["tokay"],
				},
			],
		});
	});

	it("group countries, and answer one with its carriers", async () => {
		expect(await body("/v1/countries")).toEqual({
			items: [
				{ iso: "jp", carriers: 1, sources: [] },
				{ iso: "us", carriers: 4, sources: [] },
			],
			next: null,
		});
		expect(await body("/v1/countries/us")).toMatchObject({
			iso: "us",
			carriers: [{ name: "AT&T" }, { name: "T-Mobile" }, { name: "Test MVNO" }, { name: "Verizon" }],
		});
		expect((await get("/v1/countries/ut")).status).toBe(404);
	});
});

describe("features", () => {
	it("answer every carrier's state of one feature on each platform's newest phone, by country and state", async () => {
		expect(await body("/v1/features/5g-standalone?country=jp")).toEqual({
			feature: "5g-standalone",
			devices: [
				{ code: "iPhone18,1", name: "iPhone18,1", platform: "ios" },
				{ code: "tokay", name: "tokay", platform: "android" },
				{ code: "SM-S948U", name: "Galaxy Test", platform: "samsung" },
			],
			items: [
				{
					source: "ios:carrier:Sakura_jp",
					carrier: { id: "Sakura_jp", name: "Sakura" },
					device: "iPhone18,1",
					state: "on",
					defaulted: null,
				},
			],
			next: null,
		});
		expect(await body("/v1/features/5g-standalone?platform=ios&state=on")).toMatchObject({
			devices: [{ code: "iPhone18,1" }],
			items: [{ source: "ios:carrier:ATT_US" }, { source: "ios:carrier:Sakura_jp" }],
		});
		expect(await body("/v1/features/5g-standalone?platform=ios&state=unset")).toMatchObject({
			items: [
				{ source: "ios:carrier:TMobile_US", state: null },
				{ source: "ios:carrier:Verizon_US", state: null },
			],
		});
	});

	it("read the phone named, which must be of the platform named", async () => {
		expect(await body("/v1/features/volte?device=SM-S948U")).toMatchObject({
			devices: [{ code: "SM-S948U" }],
			items: [{ source: "samsung:carrier:ATT", state: "on" }],
		});
		expect((await get("/v1/features/volte?device=SM-S948U&platform=ios")).status).toBe(400);
		expect((await get("/v1/features/nope")).status).toBe(400);
	});
});

describe("devices", () => {
	it("list every platform's phones, found by name", async () => {
		expect(await body("/v1/devices")).toMatchObject({
			items: [{ code: "iPhone18,1" }, { code: "tokay" }, { code: "SM-S948U" }],
		});
		expect(await body("/v1/devices?q=galaxy")).toMatchObject({
			items: [{ code: "SM-S948U", name: "Galaxy Test" }],
		});
		expect(await body("/v1/devices?platform=android")).toMatchObject({
			items: [{ code: "tokay" }],
			next: null,
		});
	});

	it("answer a device with its newest build, and each carrier's features on it", async () => {
		expect(await body("/v1/devices/iPhone18,1")).toMatchObject({
			platform: "ios",
			build: { id: "24A2", version: "27.1", released: "2026-10-01" },
		});
		expect(await body("/v1/devices/SM-S948U/features")).toEqual({
			items: [{ source: "samsung:carrier:ATT", states: { volte: "on" }, defaults: {} }],
			next: null,
		});
		expect((await get("/v1/devices/nope")).status).toBe(404);
	});

	it("answer the modems a device's build ships, each platform its own way", async () => {
		expect(await body("/v1/devices/SM-S948U/modems")).toEqual({
			device: "SM-S948U",
			build: "S948USQS4AZHL",
			platform: "samsung",
			modems: [
				{
					name: "S948U-CP",
					family: "qualcomm",
					familyName: expect.any(String),
					devices: ["SM-S948U"],
					configs: [{ label: "Commercial-Test", name: null, sha: sha(11) }],
				},
			],
		});
		expect(await body("/v1/devices/iPhone18,1/modems")).toMatchObject({
			build: "24A2",
			platform: "ios",
			modems: [{ name: "Mav25", package: sha(7) }],
		});
		expect(await body("/v1/devices/iPhone18,1/modems?build=24A1")).toMatchObject({
			build: "24A1",
			modems: [],
		});
		expect((await get("/v1/devices/iPhone18,1/modems?build=CP3A.1")).status).toBe(404);
	});
});

describe("SIM lookup", () => {
	it("answers every source a SIM selects, most specific rule first", async () => {
		expect(await body("/v1/sims?gid1=6d38&mccmnc=310260")).toEqual({
			items: [
				{
					source: "android:carrier:mvno_us",
					carrier: { id: "mvno_us", name: "Test MVNO" },
					rule: "310260|gid1=6D",
					via: "routed",
				},
				{
					source: "ios:carrier:TMobile_US",
					carrier: { id: "TMobile_US", name: "T-Mobile" },
					rule: "310260",
					via: "claimed",
				},
			],
		});
		expect(await body("/v1/sims?mccmnc=310260")).toMatchObject({
			items: [{ source: "ios:carrier:TMobile_US" }],
		});
		expect(await body("/v1/sims?mccmnc=310410")).toMatchObject({
			items: [
				{ source: "android:carrier:att_us", via: "routed" },
				{ source: "ios:carrier:ATT_US", via: "claimed" },
				{ source: "samsung:carrier:ATT", via: "claimed" },
			],
		});
		expect((await get("/v1/sims?mccmnc=31")).status).toBe(400);
	});
});

describe("sources", () => {
	it("are found by name, carrier name and country", async () => {
		expect(await body("/v1/ios/carriers?q=veri")).toMatchObject({
			items: [{ key: "ios:carrier:Verizon_US" }],
		});
		expect(await body("/v1/ios/carriers?q=t-mobile")).toMatchObject({
			items: [{ key: "ios:carrier:TMobile_US" }],
		});
		expect(await body("/v1/ios/carriers?country=jp")).toMatchObject({
			items: [{ key: "ios:carrier:Sakura_jp" }],
			next: null,
		});
	});

	it("answer a source's lines, the SIM rules that select it, and the layer it is read over", async () => {
		expect(await body("/v1/ios/carriers/ATT_US")).toMatchObject({
			key: "ios:carrier:ATT_US",
			lines: [{ line: "", versions: 2, head: "72.1" }],
			selectedBy: { claimed: ["310410"], routed: [] },
			base: null,
		});
		expect(await body("/v1/android/carriers/att_us")).toMatchObject({
			lines: [{ line: "tokay", versions: 1, head: "9" }],
			selectedBy: { claimed: [], routed: ["310410"] },
			base: { source: "android:default:default", line: "tokay", slug: "1", version: "1" },
		});
	});

	it("list a line's versions newest first", async () => {
		expect(await body("/v1/ios/carriers/ATT_US/versions")).toMatchObject({
			items: [{ slug: "72.1" }, { slug: "72.0" }],
			next: null,
		});
	});
});

describe("versions", () => {
	it("answer the decoded profile with what shipped it, its native settings apart", async () => {
		const version = await body("/v1/ios/carriers/ATT_US/versions/72.0");
		expect(version).toMatchObject({
			key: "ios:carrier:ATT_US",
			line: "",
			entry: { slug: "72.0" },
			previous: null,
			shipped: [{ kind: "build", platform: "ios", id: "24A1", version: "27.0", released: "2026-09-15" }],
			profile: { apns: [{ apn: "phone" }], concepts: { volte: { state: "on" } } },
		});
		expect(version).not.toHaveProperty("profile.raw");
		expect(await body("/v1/ios/carriers/ATT_US/versions/latest?fields=concepts")).toMatchObject({
			entry: { slug: "72.1" },
			previous: "72.0",
			profile: { concepts: { "5g-standalone": { state: "on" } } },
		});
		expect(await body("/v1/ios/carriers/ATT_US/versions/72.0/settings")).toEqual({
			key: "ios:carrier:ATT_US",
			line: "",
			slug: "72.0",
			settings: { "carrier.plist:apns[0].apn": "phone", "carrier.plist:SupportsVoLTE": true },
		});
		expect(
			await body("/v1/ios/carriers/ATT_US/versions/latest/settings?prefix=carrier.plist:Supports"),
		).toEqual({
			key: "ios:carrier:ATT_US",
			line: "",
			slug: "72.1",
			settings: { "carrier.plist:SupportsVoLTE": true, "carrier.plist:SupportsNR": true },
		});
	});

	it("default a device source to its newest device's line", async () => {
		expect(await body("/v1/android/carriers/att_us/versions/latest")).toMatchObject({
			line: "tokay",
			entry: { slug: "9" },
		});
		expect(await body("/v1/samsung/carriers/ATT/versions/latest")).toMatchObject({
			line: "SM-S948U",
			entry: { slug: "1.0" },
		});
		expect((await get("/v1/android/carriers/att_us/versions/latest?line=nope")).status).toBe(404);
	});

	it("serve no file as it shipped", async () => {
		expect((await get("/v1/ios/carriers/ATT_US/versions/72.1/files")).status).toBe(404);
		expect((await get(`/v1/modem-configs/${sha(1)}`)).status).toBe(404);
	});

	it("are a 500 in the error shape when a stored record breaks its contract", async () => {
		const verizon = PROFILES.find((p) => p.source.name === "Verizon_US");
		if (verizon === undefined) throw new Error("no Verizon profile");
		await env.BUCKET.put(keys.profile(verizon.sha), JSON.stringify({ schema: PROFILE_SCHEMA }));
		const res = await get("/v1/ios/carriers/Verizon_US/versions/60.0");
		expect(res.status).toBe(500);
		expect(await res.json()).toMatchObject({
			error: {
				status: 500,
				code: "internal",
				message: expect.stringContaining("does not match its contract"),
			},
		});
		await env.BUCKET.put(keys.profile(verizon.sha), JSON.stringify(verizon));
	});
});

describe("builds", () => {
	it("are listed newest first, by version and by device", async () => {
		const builds = await body("/v1/ios/builds?limit=1");
		expect(builds).toMatchObject({ items: [{ id: "24A2" }], next: { cursor: encodeCursor("27.1 24A2") } });
		expect(builds).not.toHaveProperty("items.0.sortKey");
		expect(await body(`/v1/ios/builds?cursor=${encodeCursor("27.1 24A2")}&limit=1`)).toMatchObject({
			items: [{ id: "24A1" }],
			next: null,
		});
		expect(await body("/v1/ios/builds?version=27.0")).toMatchObject({ items: [{ id: "24A1" }], next: null });
		expect(await body("/v1/samsung/builds?device=SM-S948U")).toMatchObject({
			items: [{ id: "S948USQS4AZHL" }],
		});
		expect(await body("/v1/samsung/builds?device=tokay")).toEqual({ items: [], next: null });
	});

	it("answer what a build changed, each change linking its comparison", async () => {
		const changes = await body("/v1/ios/builds/24A2/changes");
		expect(changes).toEqual({
			items: [
				{
					source: "ios:carrier:ATT_US",
					kind: "changed",
					from: { line: "", slug: "72.0", version: "72.0" },
					to: { line: "", slug: "72.1", version: "72.1" },
					compare:
						"http://localhost/v1/compare?a=ios:carrier:ATT_US&a_version=72.0&b=ios:carrier:ATT_US&b_version=72.1",
				},
				{ source: "ios:carrier:Sakura_jp", kind: "added", to: { line: "", slug: "5.0", version: "5.0" } },
				{ source: "ios:carrier:TMobile_US", kind: "added", to: { line: "", slug: "50.0", version: "50.0" } },
				{ source: "ios:carrier:Verizon_US", kind: "added", to: { line: "", slug: "60.0", version: "60.0" } },
			],
			next: null,
		});
		expect(await body(`/v1/ios/builds/24A2/changes?carrier=${ATT}`)).toMatchObject({
			items: [{ source: "ios:carrier:ATT_US" }],
			next: null,
		});
		expect((await get(`/v1/android/builds/CP3A.1/changes?cursor=${encodeCursor("att_us")}`)).status).toBe(
			400,
		);
	});

	it("answer an iOS build's baseband packages, and a Pixel's firmware with its configurations", async () => {
		expect(await body("/v1/ios/builds/24A2/modems")).toEqual({
			platform: "ios",
			modems: [
				{
					name: "Mav25",
					family: "Mav25",
					familyName: expect.any(String),
					devices: ["iPhone18,1"],
					package: sha(7),
				},
			],
		});
		expect(await body("/v1/android/builds/CP3A.1/modems")).toMatchObject({
			platform: "android",
			modems: [{ name: "g5300", configs: [{ label: "us_att", sha: sha(8) }] }],
		});
		expect((await get("/v1/android/builds/NOPE.1/modems")).status).toBe(404);
	});
});

describe("comparison", () => {
	it("answers a build's change: the concepts and settings that differ", async () => {
		const comparison = await get(
			"/v1/compare?a=ios:carrier:ATT_US&a_version=72.0&b=ios:carrier:ATT_US&b_version=72.1",
		);
		expect(comparison.headers.get("cloudflare-cdn-cache-control")).toContain(
			`max-age=${env.CACHE_TTL.pinned}`,
		);
		expect(await comparison.json()).toMatchObject({
			a: { source: "ios:carrier:ATT_US", line: "", slug: "72.0", version: "72.0" },
			b: { slug: "72.1" },
			sameFamily: true,
			groups: [
				{
					group: "features",
					rows: [
						{ id: "5g-standalone", status: "only-b" },
						{ id: "volte", status: "same" },
					],
				},
			],
			apns: [{ apn: "phone", status: "matched", differs: [] }],
			raw: [{ path: "carrier.plist:SupportsNR", status: "only-b", b: true }],
		});
	});

	it("compares across platforms by concepts and APNs, never native settings", async () => {
		const comparison = await body("/v1/compare?a=ios:carrier:ATT_US&b=samsung:carrier:ATT");
		expect(comparison).toMatchObject({ a: { slug: "72.1" }, b: { line: "SM-S948U" }, sameFamily: false });
		expect(comparison).not.toHaveProperty("raw");
		expect((await get("/v1/compare?a=ios:carrier:Nope&b=samsung:carrier:ATT")).status).toBe(404);
		expect((await get("/v1/compare?a=nope&b=samsung:carrier:ATT")).status).toBe(400);
	});
});

describe("caching", () => {
	it("keeps a pinned version long and tags it with the index, which every purge drops", async () => {
		const pinned = await get("/v1/ios/carriers/ATT_US/versions/72.0");
		const latest = await get("/v1/ios/carriers/ATT_US/versions/latest");
		expect(pinned.headers.get("cache-tag")).toBe("index");
		expect(pinned.headers.get("cloudflare-cdn-cache-control")).toBe(
			`max-age=${env.CACHE_TTL.pinned}, stale-while-revalidate=${env.CACHE_TTL.staleWhileRevalidate}`,
		);
		expect(latest.headers.get("cloudflare-cdn-cache-control")).toBe(
			`max-age=${env.CACHE_TTL.latest}, stale-while-revalidate=${env.CACHE_TTL.staleWhileRevalidate}`,
		);
		expect(pinned.headers.get("cache-control")).toBe("no-cache");
	});

	it("tags a list with the index, keeps a miss briefly, and never keeps an error", async () => {
		expect((await get("/v1/carriers")).headers.get("cache-tag")).toBe("index");
		expect((await get("/v1/ios/carriers/Nope")).headers.get("cloudflare-cdn-cache-control")).toBe(
			`max-age=${env.CACHE_TTL.missing}`,
		);
		expect((await get("/v1/ios/carriers?bogus=1")).headers.get("cache-control")).toBe("private, no-store");
	});

	it("answers a matching If-None-Match with a 304", async () => {
		const tag = (await get("/v1/platforms")).headers.get("etag") ?? "";
		expect((await api.request("/v1/platforms", { headers: { "if-none-match": tag } }, env)).status).toBe(304);
	});

	it("opens every answer to any origin", async () => {
		expect((await get("/v1")).headers.get("access-control-allow-origin")).toBe("*");
		expect((await get("/v1/platforms")).headers.get("access-control-allow-origin")).toBe("*");
	});
});

describe("the OpenAPI document", () => {
	it("lists every route, with each answer's schema from its contract", async () => {
		const doc = await body("/openapi.json");
		expect(doc).toHaveProperty("openapi", "3.1.0");
		for (const [path, id] of [
			["/v1/{platform}/{kind}/{name}/versions/{version}", "getVersion"],
			["/v1/sims", "lookUpSim"],
			["/v1/compare", "compare"],
			["/v1/features/{feature}", "listFeatureStates"],
			["/v1/devices/{code}/modems", "getDeviceModems"],
		] as const)
			expect(doc).toHaveProperty(["paths", path, "get", "operationId"], id);
		expect(doc).toHaveProperty([
			"components",
			"schemas",
			"Version",
			"properties",
			"profile",
			"properties",
			"concepts",
		]);
		expect(JSON.stringify(doc)).toContain('"$ref":"#/components/schemas/Settings.0"');
		expect(doc).toHaveProperty([
			"components",
			"schemas",
			"Error",
			"properties",
			"error",
			"properties",
			"code",
		]);
	});
});
