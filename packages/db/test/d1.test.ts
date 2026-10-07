// The index in a local D1 (wrangler's simulator), migrated from ../migrations: each write the index step and the feeds
// make, that rewriting the same rows writes nothing, and each read pages make, rarity and its plan included.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SQLiteDialect } from "drizzle-orm/sqlite-core";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
	PROFILE_SCHEMA,
	RARITY,
	rarityFile,
	releaseSortKey,
	sourceTimeline,
	type HeadRows,
	type ProfileFacts,
} from "@carrier-explode/schema";
import type { SourceKey } from "@carrier-explode/schema/types";
import {
	carrierCountries,
	carrierList,
	carrierMembers,
	carrierModemConfigs,
	sourceModemConfigs,
	statedDevices,
	carrierOf,
	changesOf,
	copiesOf,
	countryCarriers,
	countryList,
	countryOf,
	deviceList,
	entriesOf,
	headIdentities,
	indexDb,
	linkRules,
	missingProfiles,
	modemConfigsOf,
	modemsOf,
	neighbours,
	newestReleaseDevices,
	putOtaFile,
	putProfiles,
	putRelease,
	putSource,
	routedBundles,
	rareSettings,
	releaseList,
	releaseOf,
	scanConcept,
	putBaseRows,
	scanSetting,
	selectedBy,
	setHas5g,
	shippedIn,
	sourceList,
	sourceOf,
	statesOn,
	syncChanges,
	syncCopies,
	syncDevices,
	syncEntries,
	syncHeadRows,
	syncLabels,
	syncPhoneStates,
	syncRoutes,
	unnamed,
	writeLabels,
	writeLinked,
	type IndexDb,
} from "../src/index.ts";
import { rarityQuery } from "../src/profiles.ts";

const CONFIG = rarityFile("android");

// A test makes up to hundreds of D1 queries in turn, each a round trip to workerd.
vi.setConfig({ testTimeout: 30_000 });

const proxy = await getPlatformProxy<{ DB: D1Database }>({
	configPath: join(import.meta.dirname, "wrangler.jsonc"),
	persist: false,
});
const d1 = proxy.env.DB;
let db: IndexDb;

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

beforeAll(async () => {
	for (const m of readdirSync(MIGRATIONS).toSorted()) {
		const statements = readFileSync(join(MIGRATIONS, m, "migration.sql"), "utf8")
			.split("--> statement-breakpoint")
			.map((s) => s.trim())
			.filter(Boolean);
		await d1.batch(statements.map((s) => d1.prepare(s)));
	}
	db = indexDb(d1.withSession());
});

afterAll(() => proxy.dispose());

const ALL = { after: null, take: 1000 } as const;
const ATT_IOS: SourceKey = "ios:carrier:ATT_US";
const ATT_NR_IOS: SourceKey = "ios:carrier:ATT_NR_US";
const ATT_PIXEL: SourceKey = "android:carrier:att_us";
const TMO_PIXEL: SourceKey = "android:carrier:tmobile_us";
const FRANCE: SourceKey = "ios:country:France";
const VISIBLE: SourceKey = "ios:carrier:Verizon_Visible_LTE_US";

const profile = (
	sha: string,
	display: string | null,
	iso: readonly string[],
	claimed: readonly string[],
	kind: ProfileFacts["kind"] = "settings",
): ProfileFacts => {
	const facts = { sha, schema: PROFILE_SCHEMA, display, iso, sims: claimed } as const;
	return kind === "settings" ? { ...facts, kind, radio: {} } : { ...facts, kind, radio: "nr" };
};

const headOf = (sha: string, volte: string): HeadRows => ({
	settings: [
		{ file: "carrier.plist", key: "apns[0].apn", path: "apns[*].apn", value: JSON.stringify(`${sha}.apn`) },
		{ file: "carrier.plist", key: "SupportsVoLTE", path: "SupportsVoLTE", value: volte },
	],
	concepts: [{ concept: "volte", value: volte === "true" ? '"on"' : '"no"' }],
});

const bluejayName = (value: string, origin: "human" | "model") =>
	({ subject: "device", code: "bluejay", field: "name", value, origin, evidence: null }) as const;

const head = (key: SourceKey, headSha: string, updated: string | null) => {
	const [platform, kind, name] = key.split(":");
	return {
		key,
		platform: platform === "ios" ? "ios" : "android",
		kind: kind === "country" ? "country" : "carrier",
		name: name ?? "",
		headSha,
		baseSha: null,
		updated,
	} as const;
};

const mvno = (i: number): SourceKey => `android:carrier:mvno${String(i).padStart(2, "0")}_us`;

describe("feeds", () => {
	it("keep a device's earliest release day, and write only what changed", async () => {
		const listed = [
			{ code: "iPhone19,1", platform: "ios", released: "2026-09-19", boards: ["D57AP"] },
			{ code: "tokay", platform: "android", released: "2024-08", boards: [] },
			{ code: "bluejay", platform: "android", released: "2025-07", boards: [] },
		] as const;
		expect(await syncDevices(db, listed)).toBe(3);
		expect(await syncDevices(db, listed)).toBe(0);
		expect(await syncDevices(db, [{ ...listed[1], released: "2024-10" }])).toBe(0);
		expect(await syncDevices(db, [{ ...listed[1], released: "2024-07" }])).toBe(1);
		expect(await setHas5g(db, "tokay", true)).toBe(true);
		expect(await setHas5g(db, "tokay", true)).toBe(false);
	});

	it("name devices by label, and let the seeded person's release day stand over the feed's", async () => {
		expect(
			await syncLabels(
				db,
				"device",
				"name",
				[{ code: "tokay", value: "Pixel 9" }],
				"https://developers.google.com/android/ota",
			),
		).toBe(1);
		expect(
			await syncLabels(
				db,
				"device",
				"name",
				[{ code: "tokay", value: "Pixel 9" }],
				"https://developers.google.com/android/ota",
			),
		).toBe(0);
		expect(await deviceList(db, "android")).toEqual([
			{ code: "tokay", name: "Pixel 9", platform: "android", released: "2024-07", boards: [], has5g: true },
			{ code: "bluejay", name: "bluejay", platform: "android", released: "2022-04", boards: [], has5g: null },
		]);
		expect(await unnamed(db, "device")).toEqual(["bluejay", "iPhone19,1"]);
	});

	it("list one day's devices by code, highest first", async () => {
		const day = "2026-09-19";
		await syncDevices(db, [
			{ code: "iPhone19,2", platform: "ios", released: day, boards: [] },
			{ code: "iPhone19,3", platform: "ios", released: day, boards: [] },
		]);
		expect((await deviceList(db, "ios")).map((d) => d.code)).toEqual([
			"iPhone19,3",
			"iPhone19,2",
			"iPhone19,1",
		]);
	});

	it("write a label over the same or a less trusted origin only, and refuse one that does not fit its field", async () => {
		await writeLabels(db, [bluejayName("Pixel 6a", "human")]);
		await writeLabels(db, [bluejayName("Pixel 6 a?", "model")]);
		expect((await deviceList(db, "android")).find((d) => d.code === "bluejay")?.name).toBe("Pixel 6a");
		await expect(
			writeLabels(db, [
				{
					subject: "device",
					code: "tokay",
					field: "released",
					value: "August",
					origin: "human",
					evidence: null,
				},
			]),
		).rejects.toThrow();
	});
});

describe("the index step", () => {
	const ios = {
		platform: "ios",
		id: "24A446",
		version: "27.0",
		label: "27.0",
		prerelease: false,
		released: "2026-09-15",
		devices: ["iPhone19,1"],
		sourceCount: 3,
		sortKey: "27.0.0 24A446",
	} as const;
	const ios1 = {
		...ios,
		id: "24B5",
		version: "27.1",
		label: "27.1",
		released: "2026-10-01",
		sortKey: "27.1.0 24B5",
	} as const;
	const pixel = {
		platform: "android",
		id: "CP3A.260905.009",
		version: "17",
		patch: "2026-09",
		released: "2026-09-02",
		devices: ["tokay"],
		sourceCount: 2,
		sortKey: "2026-09 CP3A.260905.009",
	} as const;
	const pixel1 = {
		...pixel,
		id: "CP3A.261005.004",
		patch: "2026-10",
		released: "2026-10-02",
		sortKey: "2026-10 CP3A.261005.004",
	} as const;
	const firmware = "g5400c-260604-260710-B-13742112";
	const modem = {
		name: firmware,
		family: "shannon",
		devices: ["tokay"],
		package: null,
		size: null,
		kind: null,
	};
	const mav25 = {
		name: "Mav25-2.10.04.Release.bbfw",
		family: "Mav25",
		devices: ["iPhone19,1"],
		package: "b".repeat(64),
		size: 137554454,
		kind: "bbfw",
	} as const;

	it("writes a release, its modems and configurations once, and nothing when they are unchanged", async () => {
		expect(await putRelease(db, ios, [mav25], [])).toBe(true);
		expect(await putRelease(db, ios, [mav25], [])).toBe(false);
		expect(await putRelease(db, ios1, [], [])).toBe(true);
		const configs = [
			{ device: "tokay", label: "us_tmo", sha: "m-tmo" },
			{ device: "tokay", label: "us_att", sha: "m-att" },
			{ device: "tokay", label: "us_plmn", sha: "m-plmn" },
		];
		expect(
			await putRelease(db, pixel, [modem], [...configs, { device: "tokay", label: "gone", sha: "m-gone" }]),
		).toBe(true);
		expect(await putRelease(db, pixel, [modem], configs)).toBe(true);
		expect(
			await putRelease(
				db,
				pixel1,
				[modem],
				[
					{ device: "tokay", label: "us_tmo", sha: "m-tmo2" },
					{ device: "tokay", label: "us_plmn", sha: "m-plmn" },
					{ device: "tokay", label: "us_att", sha: "m-att2" },
				],
			),
		).toBe(true);
		expect((await modemConfigsOf(db, "android", pixel.id, "tokay")).map((c) => c.label)).toEqual([
			"us_att",
			"us_plmn",
			"us_tmo",
		]);
		expect(await modemsOf(db, "ios", ios.id)).toEqual([{ ...mav25, familyName: "Qualcomm X80 · Mav25" }]);
	});

	it("keeps one firmware's modems apart on devices carrying different configurations", async () => {
		const shared = {
			...pixel,
			id: "CP3A.260805.001",
			devices: ["caiman", "tokay"],
			sortKey: "2026-08 CP3A.260805.001",
		};
		const on = (devices: string[]) => ({ ...modem, devices });
		await putRelease(
			db,
			shared,
			[on(["caiman"]), on(["tokay"])],
			[
				{ device: "caiman", label: "us_att", sha: "m-att-caiman" },
				{ device: "tokay", label: "us_att", sha: "m-att" },
			],
		);
		expect((await modemsOf(db, "android", shared.id)).map((m) => m.devices)).toEqual([["caiman"], ["tokay"]]);
		expect((await modemConfigsOf(db, "android", shared.id, "caiman")).map((c) => c.sha)).toEqual([
			"m-att-caiman",
		]);
		expect(await putRelease(db, shared, [], [])).toBe(true);
	});

	it("refuses an iOS modem without its package's size and kind", async () => {
		await expect(
			d1
				.prepare(
					"INSERT INTO modems (platform, release, name, family, devices, package) VALUES ('ios', 'x', 'm', 'Mav25', '[]', 'b')",
				)
				.run(),
		).rejects.toThrow(/CHECK/);
		await expect(
			d1
				.prepare(
					"INSERT INTO modems (platform, release, name, family, devices, size) VALUES ('android', 'x', 'm', 'shannon', '[]', 1)",
				)
				.run(),
		).rejects.toThrow(/CHECK/);
	});

	it("refuses a release header that does not fit its platform", async () => {
		await expect(
			d1
				.prepare(
					"INSERT INTO releases (platform, id, version, devices, source_count, sort_key) VALUES ('ios', 'x', '1', '[]', 0, 'x')",
				)
				.run(),
		).rejects.toThrow(/CHECK/);
	});

	it("reads releases newest first, a page at a time, and the releases either side of one", async () => {
		expect((await releaseList(db, "ios", ALL)).map((r) => [r.id, r.modemFamilies])).toEqual([
			["24B5", []],
			["24A446", [{ code: "Mav25", name: "Qualcomm X80 · Mav25", devices: ["iPhone19,1"] }]],
		]);
		expect((await releaseList(db, "ios", { after: "27.1.0 24B5", take: 5 })).map((r) => r.id)).toEqual([
			"24A446",
		]);
		expect(await releaseOf(db, "android", pixel.id)).toEqual({
			...pixel,
			modemFamilies: [{ code: "shannon", name: "Samsung Shannon", devices: ["tokay"] }],
		});
		expect(await neighbours(db, "ios", ios.id)).toEqual({ previous: null, next: "24B5" });
		expect(await neighbours(db, "ios", "24B5")).toEqual({ previous: ios.id, next: null });
		expect(await newestReleaseDevices(db, "ios", ios.id)).toEqual([]);
	});

	it("lists releases by day, but pairs a release with its neighbours by version: 27.0.1 follows 27.0, not a 27.2 beta out before it", async () => {
		const beta = {
			...ios,
			id: "24C5089g",
			version: "27.2 beta 2",
			label: "27.2 beta 2",
			prerelease: true,
			released: "2026-09-21",
			sortKey: releaseSortKey({
				...ios,
				version: "27.2 beta 2",
				released: "2026-09-21",
				id: "24C5089g",
				extractedAt: "x",
			}),
		} as const;
		const point = {
			...ios,
			id: "24A460",
			version: "27.0.1",
			label: "27.0.1",
			released: "2026-09-28",
			sortKey: releaseSortKey({
				...ios,
				version: "27.0.1",
				released: "2026-09-28",
				id: "24A460",
				extractedAt: "x",
			}),
		} as const;
		// oxlint-disable-next-line oxc/no-map-spread -- ios and ios1 are read again below; assigning to them would change them.
		const dated = [ios, ios1].map((r) => ({ ...r, sortKey: releaseSortKey({ ...r, extractedAt: "x" }) }));
		for (const r of [...dated, beta, point]) await putRelease(db, r, [], []);
		expect((await releaseList(db, "ios", ALL)).map((r) => r.version)).toEqual([
			"27.1",
			"27.0.1",
			"27.2 beta 2",
			"27.0",
		]);
		expect(await neighbours(db, "ios", point.id)).toEqual({ previous: ios.id, next: ios1.id });
		expect(await neighbours(db, "ios", beta.id)).toEqual({ previous: ios1.id, next: null });
		await d1.prepare("DELETE FROM releases WHERE id IN ('24C5089g', '24A460')").run();
		for (const r of [ios, ios1]) await putRelease(db, r, r === ios ? [mav25] : [], []);
		expect(await newestReleaseDevices(db, "ios", "24B5")).toEqual(["iPhone19,1"]);
	});

	it("writes copies per origin and names the sources they touched", async () => {
		expect(
			await syncCopies(db, {
				kind: "release",
				id: ios.id,
				lines: [""],
				copies: [
					{ source: ATT_IOS, line: "", sha: "i1", version: "72.0" },
					{ source: ATT_NR_IOS, line: "", sha: "n1", version: "1.0" },
					{ source: FRANCE, line: "", sha: "f1", version: "60.0" },
				],
			}),
		).toEqual([ATT_NR_IOS, ATT_IOS, FRANCE]);
		// France's bytes ship again under a new version.
		expect(
			await syncCopies(db, {
				kind: "release",
				id: ios1.id,
				lines: [""],
				copies: [
					{ source: ATT_IOS, line: "", sha: "i2", version: "72.0.1" },
					{ source: ATT_NR_IOS, line: "", sha: "n1", version: "1.0" },
					{ source: FRANCE, line: "", sha: "f1", version: "60.1" },
				],
			}),
		).toEqual([ATT_NR_IOS, ATT_IOS, FRANCE]);
		const pixelCopies = {
			kind: "release",
			id: pixel.id,
			lines: ["tokay"],
			copies: [
				{ source: ATT_PIXEL, line: "tokay", sha: "a1", version: "9" },
				{ source: TMO_PIXEL, line: "tokay", sha: "t1", version: "3" },
			],
		} as const;
		expect(await syncCopies(db, pixelCopies)).toEqual([ATT_PIXEL, TMO_PIXEL]);
		expect(await syncCopies(db, pixelCopies)).toEqual([]);
		const url = "https://updates.cdn-apple.com/2026FallFCS/carrier/ATT_US-72.1.ipcc";
		expect(
			await putOtaFile(db, {
				url,
				sha: "i3",
				version: "72.1",
				published: "2026-10-03",
				digests: { sha1: "c".repeat(40) },
			}),
		).toBe(true);
		expect(
			await putOtaFile(db, {
				url,
				sha: "i3",
				version: "72.1",
				published: "2026-10-03",
				digests: { sha1: "c".repeat(40) },
			}),
		).toBe(false);
		expect(
			await syncCopies(db, {
				kind: "ota",
				url,
				copies: [{ source: ATT_IOS, line: "", sha: "i3", version: "72.1", os: ["27.1"] }],
			}),
		).toEqual([ATT_IOS]);
		// An older version published after the newest, and a file no feed dates.
		const late = "https://updates.cdn-apple.com/2026FallFCS/carrier/ATT_US-71.9.ipcc";
		await putOtaFile(db, {
			url: late,
			sha: "i0",
			version: "71.9",
			published: "2026-10-04",
			digests: { sha1: "d".repeat(40) },
		});
		expect(
			await syncCopies(db, {
				kind: "ota",
				url: late,
				copies: [{ source: ATT_IOS, line: "", sha: "i0", version: "71.9", os: ["26.4"] }],
			}),
		).toEqual([ATT_IOS]);
		const undated = "https://updates.cdn-apple.com/2026FallFCS/carrier/ATT_NR_US-0.9.ipcc";
		await putOtaFile(db, {
			url: undated,
			sha: "n0",
			version: "0.9",
			published: null,
			digests: { sha1: "e".repeat(40) },
		});
		expect(
			await syncCopies(db, {
				kind: "ota",
				url: undated,
				copies: [{ source: ATT_NR_IOS, line: "", sha: "n0", version: "0.9", os: ["26.4"] }],
			}),
		).toEqual([ATT_NR_IOS]);
		await expect(
			d1
				.prepare(
					"INSERT INTO copies (source, line, sha, version, origin_kind, origin, os) VALUES ('s', '', 'x', '1', 'release', 'r', '[]')",
				)
				.run(),
		).rejects.toThrow(/CHECK/);
		await expect(
			d1
				.prepare(
					"INSERT INTO copies (source, line, sha, version, origin_kind, origin) VALUES ('s', '', 'x', '1', 'build', 'r')",
				)
				.run(),
		).rejects.toThrow(/CHECK/);
	});

	it("reads a source's copies with what orders them", async () => {
		const att = await copiesOf(db, ATT_IOS, "ios");
		expect(
			att.map((c) =>
				c.kind === "release"
					? [c.kind, c.version, c.release.id, c.release.label, c.release.sortKey]
					: [c.kind, c.version, c.file.published, c.os],
			),
		).toEqual([
			["ota", "71.9", "2026-10-04", ["26.4"]],
			["ota", "72.1", "2026-10-03", ["27.1"]],
			["release", "72.0", ios.id, "27.0", ios.sortKey],
			["release", "72.0.1", ios1.id, "27.1", ios1.sortKey],
		]);
	});

	it("writes each sha's rows once", async () => {
		const facts = [
			profile("i1", "AT&T", ["us"], ["310410"]),
			profile("i2", "AT&T", ["us"], ["310410"]),
			profile("i3", "AT&T", ["us"], ["310410", "310410|gid1=52"]),
			profile("n1", "AT&T 5G", ["us"], ["310410|gid1=53"]),
			profile("f1", null, ["fr"], []),
			profile("a1", "AT&T", ["us"], []),
			profile("t1", "T-Mobile", ["us"], []),
			profile("m-tmo", "us_tmo", [], ["310260"], "modem"),
			profile("m-tmo2", "us_tmo", [], ["310260"], "modem"),
			profile("m-att", "us_att", [], ["310410|gid1=52"], "modem"),
			profile("m-att2", "us_att", [], ["310410|gid1=52"], "modem"),
			profile("m-plmn", "us_plmn", [], ["310410", "310260"], "modem"),
		];
		expect(
			await missingProfiles(
				db,
				facts.map((f) => f.sha),
			),
		).toEqual(facts.map((f) => f.sha));
		await putProfiles(db, facts);
		await putProfiles(db, facts.slice(0, 1));
		expect(await missingProfiles(db, ["i1", "zz"])).toEqual(["zz"]);
	});

	it("writes a sha's rows again when they were read under an older PROFILE_SCHEMA", async () => {
		await d1.prepare("UPDATE profiles SET schema = schema - 1 WHERE sha = 'f1'").run();
		expect(await missingProfiles(db, ["f1", "i1"])).toEqual(["f1"]);
		await putProfiles(db, [profile("f1", "France", ["fr"], ["20801"])]);
		expect(await missingProfiles(db, ["f1"])).toEqual([]);
		expect(await selectedBy(db, "f1", FRANCE)).toEqual({ claimed: ["20801"], routed: [] });
		// Restore f1 as the later tests read it.
		await putProfiles(db, [profile("f1", null, ["fr"], [])]);
	});

	it("writes schema's timelines in its order, and only where they changed", async () => {
		const timelineOf = async (source: SourceKey, platform: "ios" | "android") =>
			sourceTimeline(await copiesOf(db, source, platform));
		const att = await timelineOf(ATT_IOS, "ios");
		expect(await syncEntries(db, ATT_IOS, att)).toBe(true);
		expect(await syncEntries(db, ATT_IOS, att)).toBe(false);
		// Lines are ordered by version: 71.9 shipped last but is oldest.
		expect(await entriesOf(db, ATT_IOS)).toEqual(att);
		expect(att.map((e) => [e.slug, e.day])).toEqual([
			["72.1", "2026-10-03"],
			["72.0.1", "2026-10-01"],
			["72.0", "2026-09-15"],
			["71.9", "2026-10-04"],
		]);
		expect(
			await syncEntries(
				db,
				ATT_IOS,
				att.map((e) => (e.slug === "72.0" ? { ...e, changed: false } : e)),
			),
		).toBe(true);
		// A new newest entry moves every rank down.
		const newer = {
			line: "",
			slug: "73.0",
			version: "73.0",
			sha: "i4",
			beta: false,
			changed: true,
			day: "2026-10-05",
		};
		expect(await syncEntries(db, ATT_IOS, [newer, ...att])).toBe(true);
		expect((await entriesOf(db, ATT_IOS)).map((e) => e.slug)).toEqual([
			"73.0",
			"72.1",
			"72.0.1",
			"72.0",
			"71.9",
		]);
		expect(await syncEntries(db, ATT_IOS, att)).toBe(true);
		for (const [source, platform] of [
			[ATT_NR_IOS, "ios"],
			[FRANCE, "ios"],
			[ATT_PIXEL, "android"],
			[TMO_PIXEL, "android"],
		] as const) {
			expect(await syncEntries(db, source, await timelineOf(source, platform))).toBe(true);
		}
		expect((await entriesOf(db, ATT_NR_IOS)).map((e) => [e.slug, e.day])).toEqual([
			["1.0", "2026-09-15"],
			["0.9", null],
		]);
		expect((await entriesOf(db, FRANCE)).map((e) => [e.slug, e.sha, e.changed])).toEqual([
			["60.1", "f1", false],
			["60.0", "f1", true],
		]);
	});

	it("writes heads and phone states only where they changed", async () => {
		expect(await putSource(db, head(ATT_IOS, "i3", "2026-10-03"))).toBe(true);
		expect(await putSource(db, head(ATT_IOS, "i3", "2026-10-03"))).toBe(false);
		for (const h of [
			head(ATT_NR_IOS, "n1", "2026-09-15"),
			head(FRANCE, "f1", null),
			head(ATT_PIXEL, "a1", "2026-09-02"),
			head(TMO_PIXEL, "t1", "2026-09-02"),
		])
			await putSource(db, h);
		const heads = [
			[ATT_IOS, "i3", "true"],
			[ATT_NR_IOS, "n1", "true"],
			[FRANCE, "f1", "false"],
			[ATT_PIXEL, "a1", "true"],
			[TMO_PIXEL, "t1", "false"],
		] as const;
		for (const [key, sha, volte] of heads) expect(await syncHeadRows(db, key, headOf(sha, volte))).toBe(true);
		expect(await syncHeadRows(db, ATT_IOS, headOf("i3", "true"))).toBe(false);

		expect(
			await syncPhoneStates(db, ATT_PIXEL, [{ device: "tokay", states: { volte: "on" }, defaults: {} }]),
		).toBe(true);
		expect(
			await syncPhoneStates(db, ATT_PIXEL, [{ device: "tokay", states: { volte: "on" }, defaults: {} }]),
		).toBe(false);
		expect(
			await syncPhoneStates(db, ATT_PIXEL, [
				{ device: "tokay", states: { volte: "on" }, defaults: { volte: { layer: "aosp", part: "all" } } },
			]),
		).toBe(true);
		expect(
			await syncPhoneStates(db, TMO_PIXEL, [{ device: "tokay", states: { volte: "no" }, defaults: {} }]),
		).toBe(true);
		expect(await statesOn(db, "tokay", ALL)).toEqual([
			{ source: ATT_PIXEL, states: { volte: "on" }, defaults: { volte: { layer: "aosp", part: "all" } } },
			{ source: TMO_PIXEL, states: { volte: "no" }, defaults: {} },
		]);
		expect(await statesOn(db, "tokay", { after: ATT_PIXEL, take: 1 })).toEqual([
			{ source: TMO_PIXEL, states: { volte: "no" }, defaults: {} },
		]);
		// bluejay reads nothing yet, so the features pages leave it out.
		expect((await statedDevices(db, "android")).map((d) => d.code)).toEqual(["tokay"]);
		expect(await statedDevices(db, "ios")).toEqual([]);

		expect(
			await syncRoutes(db, ["ios", "ipados", "watchos"], { [ATT_IOS]: ["310410", "310410|gid1=52"] }),
		).toEqual([ATT_IOS]);
		expect(await syncRoutes(db, ["ios", "ipados", "watchos"], { [ATT_IOS]: ["310410"] })).toEqual([ATT_IOS]);
		expect(
			await syncRoutes(db, ["ios", "ipados", "watchos"], {
				[ATT_IOS]: ["310410", "iccid:8901150", "carrierId:310ATT"],
			}),
		).toEqual([ATT_IOS]);
		expect((await selectedBy(db, "i3", ATT_IOS)).routed).toEqual([
			"310410",
			"carrierId:310ATT",
			"iccid:8901150",
		]);
		await expect(syncRoutes(db, ["ios"], { [ATT_IOS]: ["imei:1"] })).rejects.toThrow(/no ruleKey/);
		await syncRoutes(db, ["ios", "ipados", "watchos"], { [ATT_IOS]: ["310410"] });
		expect(await selectedBy(db, "i3", ATT_IOS)).toEqual({
			claimed: ["310410", "310410|gid1=52"],
			routed: ["310410"],
		});
	});

	it("routes Pixel SIMs from a whole carrier list, leaving Apple's routes and unchanged sources alone", async () => {
		const list = {
			[ATT_PIXEL]: ["310410"],
			[TMO_PIXEL]: ["310260|gid1=FF", "310260"],
			"android:carrier:gone_us": ["310999"],
		};
		expect(await syncRoutes(db, ["android"], list)).toEqual([
			ATT_PIXEL,
			"android:carrier:gone_us",
			TMO_PIXEL,
		]);
		expect(await syncRoutes(db, ["android"], list)).toEqual([]);
		expect(
			await syncRoutes(db, ["android"], { [ATT_PIXEL]: ["310410"], [TMO_PIXEL]: ["310260|gid1=FF"] }),
		).toEqual(["android:carrier:gone_us", TMO_PIXEL]);
		expect(await selectedBy(db, "t1", TMO_PIXEL)).toEqual({ claimed: [], routed: ["310260|gid1=FF"] });
		expect((await selectedBy(db, "i3", ATT_IOS)).routed).toEqual(["310410"]);
		await expect(syncRoutes(db, ["android"], { [ATT_IOS]: ["310410"] })).rejects.toThrow(
			/not a source of android/,
		);
	});

	it("reads the iPhone bundles Apple routes a group of PLMNs to, bare or by a qualifier", async () => {
		const apple = ["ios", "ipados", "watchos"] as const;
		await syncRoutes(db, apple, {
			[ATT_IOS]: ["310410", "310150|gid1=53"],
			"ios:carrier:ATT_aio_US": ["310150"],
			"ios:carrier:ATT_RedPocket_US": ["310410|iccidPrefix=8901"],
			"ios:carrier:Short_US": ["31041"],
			"ipados:carrier:ATT_US": ["310410"],
		});
		expect(await routedBundles(db, { ATT: ["310150", "310410"], VZW: ["311480"] })).toEqual({
			ATT: {
				bundles: [ATT_IOS, "ios:carrier:ATT_aio_US"],
				mvnoBundles: ["ios:carrier:ATT_RedPocket_US"],
			},
			VZW: { bundles: [], mvnoBundles: [] },
		});
		await syncRoutes(db, apple, { [ATT_IOS]: ["310410"] });
	});

	it("deletes and writes hundreds of rows within D1's 100 parameters", async () => {
		const many = Array.from({ length: 250 }, (_, i) => ({
			device: `device${String(i).padStart(3, "0")}`,
			states: { volte: "on" as const },
			defaults: {},
		}));
		expect(await syncPhoneStates(db, "android:carrier:bulk_us", many)).toBe(true);
		expect(await syncPhoneStates(db, "android:carrier:bulk_us", many.slice(0, 10))).toBe(true);
		expect(await statesOn(db, "device005", ALL)).toEqual([
			{ source: "android:carrier:bulk_us", states: { volte: "on" }, defaults: {} },
		]);
		expect(await statesOn(db, "device200", ALL)).toEqual([]);
		await syncPhoneStates(db, "android:carrier:bulk_us", []);
	});

	it("reads what a release ships, and writes and reads its changes with their versions", async () => {
		// France's bytes are on two entries; the copy's version picks this release's.
		expect(await shippedIn(db, "ios", ios1.id)).toEqual([
			{ source: ATT_NR_IOS, line: "", slug: "1.0", sha: "n1", version: "1.0" },
			{ source: ATT_IOS, line: "", slug: "72.0.1", sha: "i2", version: "72.0.1" },
			{ source: FRANCE, line: "", slug: "60.1", sha: "f1", version: "60.1" },
		]);
		const changed = [
			{
				source: ATT_IOS,
				kind: "changed",
				from: { line: "", slug: "72.0" },
				to: { line: "", slug: "72.0.1" },
			},
		] as const;
		expect(await syncChanges(db, "ios", ios1.id, changed)).toBe(true);
		expect(await syncChanges(db, "ios", ios1.id, changed)).toBe(false);
		expect(
			await syncChanges(db, "ios", ios.id, [
				{ source: ATT_IOS, kind: "added", to: { line: "", slug: "72.0" } },
			]),
		).toBe(true);
		expect(await changesOf(db, "ios", ios1.id, ALL)).toEqual([
			{
				source: ATT_IOS,
				kind: "changed",
				from: { line: "", slug: "72.0", version: "72.0" },
				to: { line: "", slug: "72.0.1", version: "72.0.1" },
			},
		]);
		await expect(
			d1
				.prepare(
					"INSERT INTO changes (platform, release, source, kind, to_line, to_slug) VALUES ('ios', 'x', 's', 'removed', '', '1')",
				)
				.run(),
		).rejects.toThrow(/CHECK/);
	});
});

describe("the link step", () => {
	it("reads every head's identity and people's rules, and writes only changed carriers", async () => {
		const heads = await headIdentities(db);
		expect(heads.find((h) => h.key === ATT_IOS)).toEqual({
			key: ATT_IOS,
			carrier: null,
			display: "AT&T",
			iso: ["us"],
			sims: ["310410", "310410|gid1=52"],
			routes: ["310410"],
		});
		expect(heads.find((h) => h.key === TMO_PIXEL)).toMatchObject({ sims: [], routes: ["310260|gid1=FF"] });
		expect((await linkRules(db)).filter((l) => l.a === ATT_IOS)).toEqual([
			{
				a: ATT_IOS,
				b: ATT_NR_IOS,
				rule: "link",
				why: "AT&T's 5G SIMs (GID1 52/53) get their own iOS bundle",
			},
		]);
		const linked = {
			carriers: [
				{ id: "ATT_US", name: "AT&T", iso: "us" },
				{ id: "tmobile_us", name: null, iso: "us" },
			],
			members: {
				[ATT_IOS]: "ATT_US",
				[ATT_NR_IOS]: "ATT_US",
				[ATT_PIXEL]: "ATT_US",
				[TMO_PIXEL]: "tmobile_us",
			},
		};
		expect(await writeLinked(db, linked)).toEqual(["ATT_US", "tmobile_us"]);
		expect(await writeLinked(db, linked)).toEqual([]);
		expect(
			await writeLinked(db, {
				...linked,
				carriers: [...linked.carriers, { id: "gone", name: "Gone", iso: null }],
			}),
		).toEqual(["gone"]);
		expect(await writeLinked(db, linked)).toEqual(["gone"]);
	});

	it("names carriers: the data's name over a feed's or model's label, which name a carrier the data does not, else a source's name", async () => {
		expect(await unnamed(db, "carrier")).toEqual(["tmobile_us"]);
		expect((await carrierOf(db, "tmobile_us"))?.name).toBe("tmobile_us");
		await writeLabels(db, [
			{
				subject: "carrier",
				code: "tmobile_us",
				field: "name",
				value: "T-Mobile",
				origin: "model",
				evidence: "https://t-mobile.com",
			},
		]);
		await writeLabels(db, [
			{
				subject: "carrier",
				code: "ATT_US",
				field: "name",
				value: "AT and T",
				origin: "model",
				evidence: "https://att.com",
			},
		]);
		expect(
			await syncLabels(
				db,
				"carrier",
				"name",
				[{ code: "ATT_US", value: "AT&T Mobility" }],
				"https://att.com",
			),
		).toBe(1);
		expect(await unnamed(db, "carrier")).toEqual([]);
		expect(await carrierList(db, ALL)).toEqual([
			{ id: "ATT_US", name: "AT&T", iso: "us", platforms: ["android", "ios"], updated: "2026-10-03" },
			{ id: "tmobile_us", name: "T-Mobile", iso: "us", platforms: ["android"], updated: "2026-09-02" },
		]);
		expect(await carrierOf(db, "ATT_US")).toMatchObject({ members: [ATT_PIXEL, ATT_NR_IOS, ATT_IOS] });
		// Ranked as linking ranks them: Apple first, then the most SIM rules.
		expect(await carrierMembers(db, "ATT_US")).toEqual([ATT_IOS, ATT_NR_IOS, ATT_PIXEL]);
		expect((await sourceList(db, "android", "carrier", ALL)).map((s) => [s.key, s.carrierName])).toEqual([
			[ATT_PIXEL, "AT&T"],
			[TMO_PIXEL, "T-Mobile"],
		]);
		// A list row carries its carrier's country and members, and its own newest change.
		expect((await sourceList(db, "android", "carrier", ALL))[0]).toMatchObject({
			cc: "us",
			updated: "2026-09-02",
			members: [ATT_PIXEL, ATT_NR_IOS, ATT_IOS],
		});
		// A country bundle has no carrier: its head's country, and no members.
		expect((await sourceList(db, "ios", "country", ALL))[0]).toMatchObject({
			key: FRANCE,
			cc: "fr",
			members: [],
		});
		expect(await carrierCountries(db, "android")).toEqual(["us"]);
		expect(await carrierCountries(db, "ipados")).toEqual([]);
		// A source's country is its own, never its carrier's (one an iOS bundle elsewhere may give it).
		await d1.prepare("UPDATE carriers SET iso = 'gb' WHERE id = 'tmobile_us'").run();
		expect((await sourceList(db, "android", "carrier", ALL)).map((s) => s.cc)).toEqual(["us", "us"]);
		expect(await carrierCountries(db, "android")).toEqual(["us"]);
		await d1.prepare("UPDATE carriers SET iso = 'us' WHERE id = 'tmobile_us'").run();
		expect(await sourceOf(db, FRANCE)).toMatchObject({
			key: FRANCE,
			carrier: null,
			carrierName: null,
			display: null,
			iso: ["fr"],
		});
	});

	it("groups countries from carriers and country bundles", async () => {
		expect(await countryList(db, ALL)).toEqual([
			{ iso: "fr", carriers: 0, sources: [FRANCE] },
			{ iso: "us", carriers: 2, sources: [] },
		]);
		expect(await countryList(db, { after: "fr", take: 10 })).toEqual([
			{ iso: "us", carriers: 2, sources: [] },
		]);
		expect((await countryCarriers(db, "us")).map((c) => c.name)).toEqual(["AT&T", "T-Mobile"]);
		expect(await countryOf(db, "fr")).toEqual({ iso: "fr", carriers: 0, sources: [FRANCE] });
		expect(await countryOf(db, "us")).toEqual({ iso: "us", carriers: 2, sources: [] });
		expect(await countryOf(db, "de")).toBeUndefined();
	});

	it("finds the modem configurations a carrier's SIMs select, from each firmware's newest release, PLMN-wide only failing an exact rule", async () => {
		const firmware = "g5400c-260604-260710-B-13742112";
		const config = (label: string, sha: string) => ({
			platform: "android",
			release: "CP3A.261005.004",
			firmware,
			label,
			sha,
			family: "shannon",
			familyName: "Samsung Shannon",
			devices: ["tokay"],
		});
		// AT&T claims 310410 and its GID1 52 exactly; the older release's us_att (m-att) is not read.
		expect(await carrierModemConfigs(db, "ATT_US")).toEqual([
			config("us_att", "m-att2"),
			config("us_plmn", "m-plmn"),
		]);
		// T-Mobile's carrier list routes only 310260 with a GID1 no configuration selects: every one selected by the whole of 310260.
		expect(await carrierModemConfigs(db, "tmobile_us")).toEqual([
			config("us_plmn", "m-plmn"),
			config("us_tmo", "m-tmo2"),
		]);
		// A source's own rules select the same here: its carrier has no other members.
		expect(await sourceModemConfigs(db, TMO_PIXEL)).toEqual(await carrierModemConfigs(db, "tmobile_us"));
		// tokay moves to a new firmware: only that firmware's configurations are its.
		const moved = {
			platform: "android",
			id: "CP4A.261105.001",
			version: "17",
			patch: "2026-11",
			released: "2026-11-02",
			devices: ["tokay"],
			sourceCount: 2,
			sortKey: "2026-11 CP4A.261105.001",
		} as const;
		await putProfiles(db, [profile("m-att3", "us_att", [], ["310410|gid1=52"], "modem")]);
		await putRelease(
			db,
			moved,
			[{ name: "g5400c-next", family: "shannon", devices: ["tokay"], package: null, size: null, kind: null }],
			[{ device: "tokay", label: "us_att", sha: "m-att3" }],
		);
		expect(await carrierModemConfigs(db, "ATT_US")).toEqual([
			{ ...config("us_att", "m-att3"), release: moved.id, firmware: "g5400c-next" },
		]);
	});

	it("names a carrier by a person's label on one of its sources, whatever its id, over the data's name and a model's", async () => {
		await putProfiles(db, [profile("v1", "Visible", ["us"], ["311480|gid2=1A"])]);
		await putSource(db, {
			key: VISIBLE,
			platform: "ios",
			kind: "carrier",
			name: "Verizon_Visible_LTE_US",
			headSha: "v1",
			baseSha: null,
			updated: null,
		});
		const linked = (id: string) => ({
			carriers: [
				{ id: "ATT_US", name: "AT&T", iso: "us" },
				{ id: "tmobile_us", name: null, iso: "us" },
				{ id, name: "Verizon Visible", iso: "us" },
			],
			members: {
				[ATT_IOS]: "ATT_US",
				[ATT_NR_IOS]: "ATT_US",
				[ATT_PIXEL]: "ATT_US",
				[TMO_PIXEL]: "tmobile_us",
				[VISIBLE]: id,
			},
		});
		await writeLinked(db, linked("visible_us"));
		await writeLabels(db, [
			{
				subject: "carrier",
				code: "visible_us",
				field: "name",
				value: "Visible Wireless",
				origin: "model",
				evidence: "https://visible.com",
			},
		]);
		// The seed migration named Visible through its iOS source.
		expect(await carrierOf(db, "visible_us")).toMatchObject({
			name: "Visible",
			updated: null,
			members: [VISIBLE],
		});
		await writeLinked(db, linked("Visible_US"));
		expect((await carrierOf(db, "Visible_US"))?.name).toBe("Visible");
		await expect(
			writeLabels(db, [
				{
					subject: "source",
					code: VISIBLE,
					field: "carrierName",
					value: "Visible",
					origin: "model",
					evidence: null,
				},
			]),
		).rejects.toThrow();
	});
});

/** A session whose batches add up the rows D1 says they wrote, index entries included. */
function counting(session: D1DatabaseSession): {
	readonly db: IndexDb;
	readonly written: () => number;
	readonly statements: () => number;
} {
	let rows = 0;
	let prepared = 0;
	const batch = async (statements: D1PreparedStatement[]): Promise<D1Result[]> => {
		const results = await session.batch(statements);
		rows += results.reduce((n, r) => n + r.meta.rows_written, 0);
		return results;
	};
	const prepare = (query: string): D1PreparedStatement => {
		prepared++;
		return session.prepare(query);
	};
	const counted = new Proxy(session, {
		get: (target, p) => {
			if (p === "batch") return batch;
			if (p === "prepare") return prepare;
			const value: unknown = Reflect.get(target, p);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return { db: indexDb(counted), written: () => rows, statements: () => prepared };
}

/** A bundle a point release restamps: 300 leaves and 80 concepts, of which only the version changes. */
const stamped = (version: string): HeadRows => ({
	settings: [
		...Array.from({ length: 300 }, (_, i) => ({
			file: "carrier.plist",
			key: `Key${i}`,
			path: `Key${i}`,
			value: String(i),
		})),
		{ file: "version.plist", key: "BundleVersion", path: "BundleVersion", value: JSON.stringify(version) },
	],
	concepts: Array.from({ length: 80 }, (_, i) => ({ concept: `c${i}`, value: '"on"' })),
});

describe("head rows", () => {
	const RESTAMPED: SourceKey = "ios:carrier:Restamped_US";

	it("move with their source's head, rewriting only the leaves that differ", async () => {
		const { db: measured, written } = counting(d1.withSession());
		expect(await syncHeadRows(measured, RESTAMPED, stamped("72.0"))).toBe(true);
		const full = written();
		expect(await syncHeadRows(measured, RESTAMPED, stamped("72.0"))).toBe(false);
		expect(written()).toBe(full);
		expect(await syncHeadRows(measured, RESTAMPED, stamped("72.0.1"))).toBe(true);
		const moved = written() - full;
		// The first head writes every row with its key entry (and a leaf its settings_by_path entry); the move, one leaf deleted and written again.
		expect({ full, moved }).toEqual({ full: 301 * 3 + 80 * 2, moved: 4 });
		const held = await d1
			.prepare("SELECT value FROM settings WHERE source = ? AND file = 'version.plist'")
			.bind(RESTAMPED)
			.all<{ value: string }>();
		expect(held.results).toEqual([{ value: '"72.0.1"' }]);
		expect(await syncHeadRows(measured, RESTAMPED, { settings: [], concepts: [] })).toBe(true);
		expect(
			await d1.prepare("SELECT count(*) AS n FROM settings WHERE source = ?").bind(RESTAMPED).first("n"),
		).toBe(0);
	});
	it("writes an iOS-sized head (9,075 leaves, as Verizon's) in a few statements, as D1 counts each toward 1,000 an invocation", async () => {
		const { db: measured, statements } = counting(d1.withSession());
		const big: HeadRows = {
			settings: Array.from({ length: 9075 }, (_, i) => ({
				file: `overrides_N${i % 40}.plist`,
				key: `Apns[${i}].Name`,
				path: "Apns[*].Name",
				value: JSON.stringify(`apn ${"x".repeat(100)} ${i}`),
			})),
			concepts: Array.from({ length: 94 }, (_, i) => ({ concept: `c${i}`, value: "null" })),
		};
		expect(await syncHeadRows(measured, "ios:carrier:Big_US", big)).toBe(true);
		expect(statements()).toBeLessThanOrEqual(8);
		expect(
			await d1
				.prepare("SELECT count(*) AS n FROM settings WHERE source = ?")
				.bind("ios:carrier:Big_US")
				.first("n"),
		).toBe(9075);
		expect(await syncHeadRows(measured, "ios:carrier:Big_US", big)).toBe(false);
		await syncHeadRows(db, "ios:carrier:Big_US", { settings: [], concepts: [] });
	});
});

describe("scans over heads", () => {
	it("read what each head of a group holds at a path or for a concept", async () => {
		// Every head of the group with its version; Visible's head holds no carrier.plist leaf there, and has no entries.
		expect(
			await scanSetting(db, { platform: "ios", kind: "carrier" }, "carrier.plist", "SupportsVoLTE"),
		).toEqual([
			{ source: ATT_NR_IOS, version: "1.0", held: "own", leaves: [{ key: "SupportsVoLTE", value: "true" }] },
			{ source: ATT_IOS, version: "72.1", held: "own", leaves: [{ key: "SupportsVoLTE", value: "true" }] },
			{ source: VISIBLE, version: null, held: "absent", leaves: [] },
		]);
		expect(await scanConcept(db, { platform: "ios", kind: "country" }, "volte", "iPhone19,1")).toEqual([
			{ source: FRANCE, value: '"no"', defaulted: null },
		]);
	});

	it("read a key a head leaves unset from the default.pb its own build ships under it", async () => {
		const base = (sha: string, rows: ReadonlyArray<readonly [key: string, value: string]>) =>
			putBaseRows(
				db,
				sha,
				rows.map(([key, value]) => ({ file: "carrier.plist", key, path: key, value })),
			);
		expect(
			await base("d1", [
				["MaxDataRate", "5"],
				["SupportsVoLTE", "false"],
			]),
		).toBe(true);
		expect(
			await base("d1", [
				["MaxDataRate", "5"],
				["SupportsVoLTE", "false"],
			]),
		).toBe(false);
		await base("d2", [["MaxDataRate", "7"]]);
		await putSource(db, { ...head(ATT_PIXEL, "a1", "2026-09-02"), baseSha: "d1" });
		await putSource(db, { ...head(TMO_PIXEL, "t1", "2026-09-02"), baseSha: "d2" });
		const group = { platform: "android", kind: "carrier" } as const;
		// Each reads its own build's default.pb, not one newest for all.
		expect(
			(await scanSetting(db, group, "carrier.plist", "MaxDataRate")).map((s) => [s.source, s.held, s.leaves]),
		).toEqual([
			[ATT_PIXEL, "default", [{ key: "MaxDataRate", value: "5" }]],
			[TMO_PIXEL, "default", [{ key: "MaxDataRate", value: "7" }]],
		]);
		// A key the head sets is its own, whatever its default.pb says.
		expect(
			(await scanSetting(db, group, "carrier.plist", "SupportsVoLTE")).map((s) => [
				s.source,
				s.held,
				s.leaves,
			]),
		).toEqual([
			[ATT_PIXEL, "own", [{ key: "SupportsVoLTE", value: "true" }]],
			[TMO_PIXEL, "own", [{ key: "SupportsVoLTE", value: "false" }]],
		]);
	});

	it("read a per-phone concept from the given phone's states, not the head, with the layer a default came from", async () => {
		await syncPhoneStates(db, ATT_PIXEL, [
			{
				device: "tokay",
				states: { volte: "available", "5g": "on" },
				defaults: { "5g": { layer: "default.pb", part: "all" } },
			},
			{ device: "bluejay", states: { volte: "on", "5g": "no" }, defaults: {} },
		]);
		const group = { platform: "android", kind: "carrier" } as const;
		// AT&T's head says VoLTE is on; on tokay it reads "available". T-Mobile's states name no 5G.
		expect(await scanConcept(db, group, "volte", "tokay")).toEqual([
			{ source: ATT_PIXEL, value: '"available"', defaulted: null },
			{ source: TMO_PIXEL, value: '"no"', defaulted: null },
		]);
		expect(await scanConcept(db, group, "5g", "tokay")).toEqual([
			{ source: ATT_PIXEL, value: '"on"', defaulted: '{"layer":"default.pb","part":"all"}' },
			{ source: TMO_PIXEL, value: "null", defaulted: null },
		]);
		// T-Mobile ships nothing bluejay reads.
		expect(await scanConcept(db, group, "5g", "bluejay")).toEqual([
			{ source: ATT_PIXEL, value: '"no"', defaulted: null },
		]);
	});

	it("finds a rare key and a rare value among 60 heads, ignoring older contents", async () => {
		const heads = Array.from({ length: 60 }, (_, i): HeadRows => ({
			concepts: [],
			settings: [
				{
					file: "config",
					key: "carrier_volte_available_bool",
					path: "carrier_volte_available_bool",
					value: "true",
				},
				{
					file: "config",
					key: "carrier_nr_availabilities_int_array",
					path: "carrier_nr_availabilities_int_array",
					value: i < 3 ? "[1]" : "[1,2]",
				},
				{ file: "config", key: "apns[0].apn", path: "apns[*].apn", value: JSON.stringify(`mvno${i}.apn`) },
				...(i < 2
					? [{ file: "config", key: "carrier_rare_key_bool", path: "carrier_rare_key_bool", value: "true" }]
					: []),
			],
		}));
		// An older head of mvno03 held the rare value too; only the current heads count.
		await syncHeadRows(db, mvno(3), {
			concepts: [],
			settings: [
				{
					file: "config",
					key: "carrier_nr_availabilities_int_array",
					path: "carrier_nr_availabilities_int_array",
					value: "[1]",
				},
			],
		});
		for (const [i, rows] of heads.entries()) {
			await putSource(db, {
				key: mvno(i),
				platform: "android",
				kind: "carrier",
				name: `mvno${i}_us`,
				headSha: `r${i}`,
				baseSha: null,
				updated: "2026-09-02",
			});
			await syncHeadRows(db, mvno(i), rows);
		}

		const group = { platform: "android", kind: "carrier" } as const;
		// ATT_PIXEL and TMO_PIXEL have no config file, so they are not in the group's 60.
		expect(await rareSettings(db, mvno(0), group, CONFIG, RARITY)).toEqual([
			{ rare: "key", path: "carrier_rare_key_bool", value: "true", holders: 2, of: 60, with: [mvno(1)] },
			{
				rare: "value",
				path: "carrier_nr_availabilities_int_array",
				value: "[1]",
				holders: 3,
				of: 60,
				with: [mvno(1), mvno(2)],
			},
		]);
		expect(await rareSettings(db, mvno(10), group, CONFIG, RARITY)).toEqual([]);
		// A key that only identifies the source is never rare.
		expect(
			await rareSettings(db, mvno(0), group, { file: "config", identity: ["carrier_rare_key_bool"] }, RARITY),
		).toEqual([
			{
				rare: "value",
				path: "carrier_nr_availabilities_int_array",
				value: "[1]",
				holders: 3,
				of: 60,
				with: [mvno(1), mvno(2)],
			},
		]);
		expect(await rareSettings(db, mvno(0), group, CONFIG, { ...RARITY, minGroupForRareKey: 61 })).toEqual([
			{
				rare: "value",
				path: "carrier_nr_availabilities_int_array",
				value: "[1]",
				holders: 3,
				of: 60,
				with: [mvno(1), mvno(2)],
			},
		]);
	});

	it("plans rarity on indexes", async () => {
		const query = new SQLiteDialect().sqlToQuery(
			rarityQuery(mvno(0), { platform: "android", kind: "carrier" }, CONFIG, RARITY),
		);
		const plan = await d1
			.prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
			.bind(...query.params)
			.all<{ detail: string }>();
		const details = plan.results.map((r) => r.detail);
		// Tables are only ever searched: the group by sources_by_list; the holders of a path by settings_by_path; one source's file by its key.
		expect(details.filter((d) => /^SCAN (sources|s)\b/.test(d))).toEqual([]);
		expect(
			details
				.filter((d) => d.startsWith("SEARCH sources USING"))
				.every((d) => /sources_by_list|sqlite_autoindex_sources_1/.test(d)),
		).toBe(true);
		expect(details.filter((d) => d.startsWith("SEARCH s ")).toSorted()).toEqual([
			"SEARCH s EXISTS USING COVERING INDEX sqlite_autoindex_settings_1 (source=? AND file=?)",
			"SEARCH s USING COVERING INDEX settings_by_path (file=? AND path=?)",
			"SEARCH s USING INDEX sqlite_autoindex_settings_1 (source=?)",
			// A rare key's own values, by the source's key.
			"SEARCH s USING INDEX sqlite_autoindex_settings_1 (source=?)",
		]);
	});
});
