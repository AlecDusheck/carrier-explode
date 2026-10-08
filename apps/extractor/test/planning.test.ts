// Planning from what the feeds list and what the bucket's keys hold (../src/*/plan.ts, ../src/scope.ts).

import { describe, expect, it } from "vitest";

import { compareVersions } from "@carrier-explode/decode-ios";
import { releaseOfKey } from "@carrier-explode/storage";
import type { AppleDbEntry, Firmware } from "../src/apple/check.ts";
import { betaCandidates, distinctIpsws, listedBetas, listedReleases, planIos } from "../src/apple/plan.ts";
import type { OtaBuild, OtaDevice } from "../src/pixel/check.ts";
import { asks, planPixel } from "../src/pixel/plan.ts";
import {
	buildMonth,
	candidates,
	galaxyDevices,
	launchedSince,
	planGalaxy,
	scopedGalaxy,
} from "../src/galaxy/plan.ts";
import type { DatedDevice, Scope } from "../src/scope.ts";
import { iosPhonesOf } from "../src/store.ts";
import { SCOPE } from "./scope.ts";

/** The day after the cutover: undated builds count as out today. */
const TODAY = "2026-10-08";

const fw = (version: string, build: string, device: string, released?: string): Firmware => ({
	version,
	build,
	device,
	url: `u/${device}_${build}`,
	...(released === undefined ? {} : { released }),
});

const beta = (version: string, build: string, device: string, released: string): AppleDbEntry => ({
	version,
	build,
	beta: true,
	released,
	ipsws: new Map([[device, `u/${device}_${build}`]]),
});

/** Each held build's phones, as a listing of releases/ios/ gives them. */
const heldIos = (held: Readonly<Record<string, readonly string[]>> = {}): Map<string, ReadonlySet<string>> =>
	new Map(Object.entries(held).map(([build, phones]) => [build, new Set(phones)]));

describe("iOS", () => {
	const devices: DatedDevice[] = [
		{ code: "iPhone13,2", released: "2020-10-23" },
		{ code: "iPhone18,1", released: "2025-09-19" },
		// The iPhone SE (2nd generation), out before the scope's phones; an iPad of the same day as the iPhone 12.
		{ code: "iPhone12,8", released: "2020-04-24" },
		{ code: "iPad13,1", released: "2020-10-23" },
	];
	const releases = listedReleases([
		fw("26.6", "23G90", "iPhone18,1", "2026-07-28"),
		fw("26.6", "23G90", "iPhone13,2", "2026-07-28"),
		fw("26.6", "23G90", "iPhone12,8", "2026-07-28"),
		fw("26.6", "23G90", "iPad13,1", "2026-07-28"),
		fw("27.0", "24A437", "iPhone18,1", "2026-09-15"),
		// Just after the cutover; and one ipsw.me has not dated yet.
		fw("26.7", "23H10", "iPhone13,2", "2026-10-06"),
		fw("27.0.1", "24A450", "iPhone18,1"),
	]);
	const betas = listedBetas([
		beta("26.6 beta 2", "23G5050b", "iPhone18,1", "2026-06-20"),
		beta("27.0 beta 3", "24A5300c", "iPhone18,1", "2026-07-08"),
		beta("26.7 beta 1", "23H5001a", "iPhone13,2", "2026-10-07"),
	]);
	const plan = (held = heldIos()): string[] =>
		planIos(SCOPE, [...releases, ...betas], devices, held, TODAY).map((p) => p.label);

	it("takes every release before the cutover, betas only of the newest major, and everything after it, oldest first", () => {
		// 26.6 beta 2 (an older major's, before the cutover) is left out; 26.7 beta 1 (after it) is taken.
		expect(plan()).toEqual(["26.6", "26.7 beta 1", "26.7", "27.0 beta 3", "27.0", "27.0.1"]);
	});

	it("plans no build below the scope's minimum major, before or after the cutover", () => {
		const from27: Scope = { ...SCOPE, ios: { ...SCOPE.ios, minMajor: 27 } };
		const labels = planIos(from27, [...releases, ...betas], devices, heldIos(), TODAY).map((p) => p.label);
		expect(labels).toEqual(["27.0 beta 3", "27.0", "27.0.1"]);
	});

	it("plans only iPhones out since the scope's day: no iPad, no older iPhone", () => {
		const [build] = planIos(SCOPE, releases, devices, heldIos(), TODAY);
		expect(build).toMatchObject({
			build: "23G90",
			ipsws: [
				{ device: "iPhone18,1", url: "u/iPhone18,1_23G90" },
				{ device: "iPhone13,2", url: "u/iPhone13,2_23G90" },
			],
		});
	});

	it("leaves out a build whose release record is listed", () => {
		expect(plan(heldIos({ "23G90": ["iPhone18,1", "iPhone13,2"], "24A437": ["iPhone18,1"] }))).toEqual([
			"26.7 beta 1",
			"26.7",
			"27.0 beta 3",
			"27.0.1",
		]);
	});

	it("plans a held build again when its record was written without its phones, never failing the check", () => {
		const held = iosPhonesOf([
			{ key: "releases/ios/23G90.json", customMetadata: {} },
			{ key: "releases/ios/24A437.json", customMetadata: { phones: "iPhone18,1" } },
		]);
		expect(held).toEqual(heldIos({ "23G90": [], "24A437": ["iPhone18,1"] }));
		expect(plan(held)).toContain("26.6");
		expect(plan(held)).not.toContain("27.0");
	});

	it("plans a held build again, all its IPSWs, once a phone its record lacks is listed for it", () => {
		const [build] = planIos(SCOPE, releases, devices, heldIos({ "23G90": ["iPhone18,1"] }), TODAY);
		expect(build).toMatchObject({
			build: "23G90",
			ipsws: [{ device: "iPhone18,1" }, { device: "iPhone13,2" }],
		});
	});

	it("asks AppleDB about betas of the newest release's major and later, held or not", () => {
		const ipswMe = [fw("27.0", "24A437", "iPhone18,1"), fw("26.6", "23G90", "iPhone18,1")];
		expect(
			betaCandidates(
				["iOS;24B5089g", "iOS;24A5430a", "iOS;23G5050b", "iOS;25A5010a", "watchOS;24B5089g"],
				ipswMe,
			),
		).toEqual(["24B5089g", "24A5430a", "25A5010a"]);
	});

	it("takes each phone's newest build under the newest rule, and nothing once it is held", () => {
		const newest: Scope = { ...SCOPE, ios: { ...SCOPE.ios, everythingSince: null, backfill: "newest" } };
		const listed = [
			...listedReleases([fw("27.0", "24A437", "iPhone18,1", "2026-09-15")]),
			...listedBetas([
				beta("27.1 beta 1", "24B5050a", "iPhone18,1", "2026-09-20"),
				beta("27.1 beta 2", "24B5089g", "iPhone18,1", "2026-09-27"),
			]),
		];
		const newestOf = (held: Map<string, ReadonlySet<string>>): string[] =>
			planIos(newest, listed, devices, held, TODAY).map((p) => p.build);
		expect(newestOf(heldIos())).toEqual(["24B5089g"]);
		expect(newestOf(heldIos({ "24B5089g": ["iPhone18,1"] }))).toEqual([]);
	});

	it("keeps one entry per IPSW file, the lead's first, then the newest phone's", () => {
		const pairs = [
			{ device: "iPhone16,1", url: "a" },
			{ device: "iPhone17,1", url: "b" },
			{ device: "iPhone17,2", url: "b" },
			{ device: "iPhone18,1", url: "c" },
		];
		expect(distinctIpsws(pairs, "iPhone17,2")).toEqual([
			{ device: "iPhone17,2", url: "b" },
			{ device: "iPhone18,1", url: "c" },
			{ device: "iPhone16,1", url: "a" },
		]);
	});

	it("sorts a beta between releases", () => {
		expect(["27.2", "27.2 beta 10", "27.1", "27.2 beta 2"].toSorted(compareVersions)).toEqual([
			"27.1",
			"27.2 beta 2",
			"27.2 beta 10",
			"27.2",
		]);
	});
});

const ota = (device: string, build: string, android: string, patch: string, variant?: string): OtaBuild => ({
	device,
	build,
	android,
	patch,
	url: `u/${device}-${build}`,
	...(variant === undefined ? {} : { variant }),
});

/** The held Pixel records, as a listing of releases/android/ gives them. */
const heldPixel = (...keys: string[]): Set<string> =>
	new Set(keys.map((k) => releaseOfKey(k)).flatMap((k) => (k === undefined ? [] : [k.id.join("/")])));

describe("Pixel", () => {
	const devices: DatedDevice[] = [
		{ code: "frankel", released: "2025-08" },
		{ code: "redfin", released: "2020-10" },
		{ code: "sunfish", released: "2020-08" },
	];
	const page: OtaDevice[] = [
		{
			device: "frankel",
			name: "Pixel 10",
			builds: [
				ota("frankel", "BP2A.250605.001", "16.0.0", "2025-06"),
				ota("frankel", "BP2A.250705.008", "16.0.0", "2025-07"),
				ota("frankel", "BP3A.250905.014", "16.0.0", "2025-09"),
				ota("frankel", "CP1A.260805.002", "17.0.0", "2026-08"),
				ota("frankel", "CP1A.260905.009", "17.0.0", "2026-09"),
				ota("frankel", "CP1A.261005.003", "17.0.0", "2026-10"),
				ota("frankel", "CP1A.261005.003.A1", "17.0.0", "2026-10", "Verizon"),
				ota("frankel", "CP2A.261105.001", "17.0.0", "2026-11"),
			],
		},
		{
			device: "redfin",
			name: "Pixel 5",
			builds: [
				ota("redfin", "TP1A.221005.002", "13.0.0", "2022-10"),
				ota("redfin", "TQ3A.230805.001", "13.0.0", "2023-08"),
			],
		},
		{ device: "sunfish", name: "Pixel 4a", builds: [ota("sunfish", "TQ3A.230805.001", "13.0.0", "2023-08")] },
	];
	const plan = (held = heldPixel()): string[] =>
		planPixel(SCOPE, page, devices, held).map((p) => `${p.build}/${p.device}`);

	it("before the cutover takes each Pixel's last build of each train; from its month on, every general build", () => {
		// Monthly builds before it (BP2A.250605, CP1A.260805) are left out, its variant too; the Pixel 4a (out before October 2020) entirely.
		expect(plan()).toEqual([
			"TP1A.221005.002/redfin",
			"TQ3A.230805.001/redfin",
			"BP2A.250705.008/frankel",
			"BP3A.250905.014/frankel",
			"CP1A.260905.009/frankel",
			"CP1A.261005.003/frankel",
			"CP2A.261105.001/frankel",
		]);
	});

	it("plans phones only: a tablet the OTA page names as one is left out, however recent", () => {
		const tablet: OtaDevice = {
			device: "tangorpro",
			name: "Pixel Tablet",
			builds: [ota("tangorpro", "CP1A.261005.003", "17.0.0", "2026-10")],
		};
		const withTablet = planPixel(
			SCOPE,
			[...page, tablet],
			[...devices, { code: "tangorpro", released: "2023-03" }],
			heldPixel(),
		);
		expect(withTablet.map((p) => p.device)).not.toContain("tangorpro");
		expect(withTablet).toEqual(planPixel(SCOPE, page, devices, heldPixel()));
	});

	it("holds a unit when its own record is listed, leaving its build's other devices planned", () => {
		expect(
			plan(
				heldPixel(
					"releases/android/CP1A.261005.003/frankel.json",
					"releases/android/TP1A.221005.002/redfin.json",
				),
			),
		).toEqual([
			"TQ3A.230805.001/redfin",
			"BP2A.250705.008/frankel",
			"BP3A.250905.014/frankel",
			"CP1A.260905.009/frankel",
			"CP2A.261105.001/frankel",
		]);
	});

	it("asks the update service about each held Pixel's newest held train", () => {
		expect(
			asks([
				["CP3A.260905.009", "rango"],
				["BP4A.251005.001", "rango"],
				["BP4A.251005.001", "tokay"],
			]),
		).toEqual([
			{ device: "rango", train: "CP3A" },
			{ device: "tokay", train: "BP4A" },
		]);
	});
});

const fusOf = (csc: string): string => `P/${csc}/P/P`;

const s26 = { family: "Galaxy S", generation: 26 };
const s25 = { family: "Galaxy S", generation: 25 };
const flip8 = { family: "Galaxy Z Flip", generation: 8 };
const flip7 = { family: "Galaxy Z Flip", generation: 7 };

describe("Galaxy", () => {
	const listed = [
		{
			model: "SM-S942U",
			region: "ATT",
			line: s26,
			versions: [fusOf("S942UOYN4BZID"), fusOf("S942UOYN4AZH5"), fusOf("S942UOYN3AZF1")],
		},
		{ model: "SM-S942U", region: "TMB", line: s26, versions: [fusOf("S942UOYN4BZID")] },
		{ model: "SM-F776U", region: "ATT", line: flip8, versions: [fusOf("F776UOYN3AZI8")] },
		{ model: "SM-S931U", region: "ATT", line: s25, versions: [fusOf("S931UOYNCCZF9")] },
	];

	it("takes each major on each family's newest generation that has it", () => {
		const firmware = [
			{ build: "1", line: s26, major: 17 },
			{ build: "2", line: s25, major: 17 },
			{ build: "3", line: flip8, major: 17 },
			{ build: "4", line: s25, major: 16 },
			{ build: "5", line: flip7, major: 16 },
		];
		expect(scopedGalaxy(SCOPE, firmware).map((x) => x.build)).toEqual(["1", "3", "4", "5"]);
	});

	it("dates a phone's launch by its oldest build, which an older build rules out before all must date", () => {
		expect(launchedSince(["S942UOYN4BZID", "S942UOYN1AZAD"], "2026-01", TODAY)).toBe(true);
		expect(launchedSince(["S931UOYN1AYA1", "S931UOYNCDZIF"], "2026-01", TODAY)).toBe(false);
		expect(launchedSince(["S921UOYN1AWM9", "S921UOYN1AWKU"], "2025-01", TODAY)).toBe(false);
		expect(() => launchedSince(["S942UOYN1AZMD"], "2025-01", TODAY)).toThrow(/no year, month/);
		expect(launchedSince([], "2025-01", TODAY)).toBe(false);
	});

	it("reads each model's newest build of each OS upgrade, each CSC build once", () => {
		expect(
			candidates(listed, TODAY)
				.map((c) => c.build)
				.toSorted(),
		).toEqual(["F776UOYN3AZI8", "S931UOYNCCZF9", "S942UOYN4AZH5", "S942UOYN4BZID"]);
	});

	it("plans one unit per firmware: each scoped model's newest build per major, minus listed records, oldest first", () => {
		const majors: Record<string, number> = {
			S942UOYN4BZID: 17,
			S942UOYN4AZH5: 16,
			F776UOYN3AZI8: 16,
			S931UOYNCCZF9: 15,
		};
		const read = candidates(listed, TODAY).map((c) =>
			Object.assign(c, {
				major: majors[c.build] ?? 0,
				released: buildMonth(c.build, TODAY).slice(0, 7) + "-01",
			}),
		);
		// 17 and 16 on the S26 and the Flip8; 15 on the S25, the newest Galaxy S that has it.
		expect(planGalaxy(SCOPE, read, new Set()).map((p) => [p.build, p.model, p.major])).toEqual([
			["S931UOYNCCZF9", "SM-S931U", 15],
			["S942UOYN4AZH5", "SM-S942U", 16],
			["F776UOYN3AZI8", "SM-F776U", 16],
			["S942UOYN4BZID", "SM-S942U", 17],
		]);
		expect(planGalaxy(SCOPE, read, new Set(["S942UOYN4BZID"])).map((p) => p.build)).not.toContain(
			"S942UOYN4BZID",
		);
	});

	it("reads and plans each multi-CSC package of a model apart", () => {
		const regional = [
			{
				model: "SM-S942B",
				region: "EUX",
				line: s26,
				versions: [fusOf("S942BOXM4BZIG"), fusOf("S942BOXM4AZG5")],
			},
			{ model: "SM-S942B", region: "ZTO", line: s26, versions: [fusOf("S942BOWO4BZIF")] },
		];
		const read = candidates(regional, TODAY).map((c) =>
			Object.assign(c, { major: c.build.at(-4) === "B" ? 17 : 16, released: "2026-09-01" }),
		);
		expect(read.map((c) => [c.build, c.region])).toEqual([
			["S942BOXM4BZIG", "EUX"],
			["S942BOXM4AZG5", "EUX"],
			["S942BOWO4BZIF", "ZTO"],
		]);
		expect(
			planGalaxy({ ...SCOPE, samsung: { ...SCOPE.samsung, majors: 1 } }, read, new Set()).map((p) => p.build),
		).toEqual(["S942BOWO4BZIF", "S942BOXM4BZIG"]);
	});

	it("dates a build by its year letter, which cycles every 26 years", () => {
		// SM-S938U's version.xml on 2026-10-06: S938USQU1AYA1 (2025-01) … S938USQUCDZIF (2026-09).
		expect(buildMonth("S938UOYN1AYA1", TODAY)).toBe("2025-011");
		expect(buildMonth("S938UOYNCDZIF", TODAY)).toBe("2026-09F");
		expect(buildMonth("S942UOYN5AAB1", "2027-03-01")).toBe("2027-021");
		expect(buildMonth("S942UOYN5AZL3", "2027-03-01")).toBe("2026-123");
		expect(() => buildMonth("S942UOYN5AZM3", TODAY)).toThrow(/no year, month and revision/);
	});

	it("takes an OS upgrade's newest build across the year letter's wrap", () => {
		const wrapped = [
			{
				model: "SM-S942U",
				region: "ATT",
				line: s26,
				versions: [fusOf("S942UOYN5AZL3"), fusOf("S942UOYN5AAB1")],
			},
		];
		expect(candidates(wrapped, "2027-03-01").map((c) => c.build)).toEqual(["S942UOYN5AAB1"]);
		const dated = (build: string, released: string) => ({
			model: "SM-S942U",
			region: "ATT",
			line: s26,
			version: fusOf(build),
			build,
			major: 18,
			released,
		});
		expect(
			planGalaxy(
				SCOPE,
				[dated("S942UOYN5AAB1", "2027-02-03"), dated("S942UOYN5AZL3", "2026-12-20")],
				new Set(),
			).map((p) => p.build),
		).toEqual(["S942UOYN5AAB1"]);
	});

	it("records each model read on its earliest build day, named as FUS names it", () => {
		const read = [
			{
				model: "SM-S942U",
				region: "ATT",
				line: s26,
				version: fusOf("S942UOYN4BZID"),
				build: "S942UOYN4BZID",
				major: 17,
				released: "2026-09-20",
				name: null,
			},
			{
				model: "SM-S942U",
				region: "ATT",
				line: s26,
				version: fusOf("S942UOYN4AZH5"),
				build: "S942UOYN4AZH5",
				major: 16,
				released: "2026-08-11",
				name: "Galaxy S26 (SM-S942U)",
			},
			{
				model: "SM-S931U",
				region: "ATT",
				line: s25,
				version: fusOf("S931UOYNCCZF9"),
				build: "S931UOYNCCZF9",
				major: 16,
				released: "2026-06-30",
				name: null,
			},
		];
		expect(galaxyDevices(read)).toEqual({
			records: [
				{ code: "SM-S942U", platform: "samsung", released: "2026-08-11", boards: [] },
				{ code: "SM-S931U", platform: "samsung", released: "2026-06-30", boards: [] },
			],
			names: [{ code: "SM-S942U", value: "Galaxy S26 (SM-S942U)" }],
		});
	});
});
