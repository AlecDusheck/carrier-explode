import { describe, expect, it } from "vitest";

import {
	canonicalLine,
	compareReleases,
	head,
	headRows,
	isVersionSlug,
	lastChanged,
	lineOf,
	linesOf,
	mainFile,
	modemFacts,
	newestFirst,
	perPhone,
	phoneHeads,
	sourceBase,
	phoneStates,
	profileFacts,
	PROFILE_SCHEMA,
	RARITY,
	releaseChanges,
	releaseSortKey,
	sourceTimeline,
	versionOn,
	type Device,
	type ModemConfig,
	type Phone,
	type PhoneHead,
	type PhoneProfile,
	type Profile,
	type ReleaseHeader,
	type ReleaseOrder,
	type ReleaseVersion,
	type ShippedCopy,
	type SourceCopy,
	type SourceRef,
	type TimelineEntry,
} from "../src/index.ts";
import { fileConfig } from "../src/android/config.ts";
import { androidConcepts } from "../src/android/readers.ts";

/** As the feeds record them: Google's OTA page (each Pixel's first build) and AppleDB (release day, board configs). */
const DEVICES: readonly Device[] = [
	{ code: "frankel", family: "android", released: "2025-08", boards: [] },
	{ code: "tokay", family: "android", released: "2024-08", boards: [] },
	{ code: "comet", family: "android", released: "2024-08", boards: [] },
	{ code: "raven", family: "android", released: "2021-10", boards: [] },
	{ code: "oriole", family: "android", released: "2021-10", boards: [] },
	{ code: "flame", family: "android", released: "2019-10", boards: [] },
	{ code: "iPhone18,1", family: "apple", released: "2025-09-19", boards: ["V53AP"] },
	{ code: "iPhone13,2", family: "apple", released: "2020-10-23", boards: ["D53gAP"] },
	{ code: "iPhone12,8", family: "apple", released: "2020-04-24", boards: ["D79AP"] },
	{ code: "iPhone10,1", family: "apple", released: "2017-09-22", boards: ["D20AP"] },
];
const ORDER = newestFirst(DEVICES);

const IOS: SourceRef = { platform: "ios", kind: "carrier", name: "Test_US" };
const ANDROID: SourceRef = { platform: "android", kind: "carrier", name: "test_us" };

const release = (id: string, released: string | null, prerelease: boolean | null = null): ReleaseOrder => ({
	id,
	released,
	prerelease,
	sortKey: `${released ?? ""} ${id}`,
});
const shipped = (r: ReleaseOrder, sha: string, version: string, line = ""): SourceCopy => ({
	kind: "release",
	line,
	sha,
	version,
	release: r,
});
const listed = (sha: string, version: string, published: string | null, line = ""): SourceCopy => ({
	kind: "ota",
	line,
	sha,
	version,
	file: { published },
});

const slugs = (entries: readonly TimelineEntry[]): string[] =>
	entries.map((e) => `${e.slug}${e.changed ? "" : " (same)"}`);
const main = (t: readonly TimelineEntry[]): TimelineEntry[] => lineOf(t, "");

describe("Apple timelines", () => {
	it("merges an image copy and an OTA copy of one content into one entry", () => {
		const t = sourceTimeline([
			shipped(release("24A01", "2026-01-01"), "c72", "72.0"),
			listed("c72", "72.0", "2025-12-01"),
			listed("c71", "71.1", "2025-06-01"),
		]);
		expect(slugs(main(t))).toEqual(["72.0", "71.1"]);
		expect(main(t).map((e) => [e.sha, e.day])).toEqual([
			["c72", "2025-12-01"],
			["c71", "2025-06-01"],
		]);
		expect(main(t).every((e) => isVersionSlug(e.slug))).toBe(true);
	});

	it("names an older content under a reused version by where it first appeared, and fails when it cannot", () => {
		const t = sourceTimeline([
			shipped(release("24A02", "2026-01-02"), "new", "50.1"),
			shipped(release("23A01", "2025-01-01"), "old", "50.1"),
		]);
		expect(slugs(main(t))).toEqual(["50.1", "50.1@23a01"]);
		const clash = [
			listed("a", "50.1", "2026-02-01"),
			listed("b", "50.1", "2025-01-01"),
			listed("c", "50.1", "2025-01-01"),
		];
		expect(() => sourceTimeline(clash)).toThrow(/names two contents/);
	});

	it("puts model-specific files on their own line and marks beta-only content", () => {
		const t = sourceTimeline([
			shipped(release("24A05", "2026-01-05", true), "b", "73.0"),
			listed("i71", "33.2", "2018-09-01", "iPhone7,1"),
		]);
		expect(linesOf(IOS, t, ORDER)).toEqual(["", "iPhone7,1"]);
		expect(main(t)[0]?.beta).toBe(true);
	});

	it("heads a source with no main-line copy on its model's line", () => {
		const t = sourceTimeline([listed("i71", "33.2", "2018-09-01", "iPhone7,1")]);
		expect(linesOf(IOS, t, ORDER)).toEqual(["iPhone7,1"]);
		expect(head(IOS, t, ORDER)?.sha).toBe("i71");
	});

	it("takes beta status from the release's prerelease flag, not its label", () => {
		expect(main(sourceTimeline([shipped(release("24A05", "2026-01-05", false), "b", "73.0")]))[0]?.beta).toBe(
			false,
		);
	});

	it("orders and names contents the same whatever order copies arrive in", () => {
		const copies = [
			shipped(release("24A02", "2026-01-01"), "x", "50.1"),
			shipped(release("24A03", "2026-01-01"), "y", "50.1"),
			listed("x", "50.1", "2026-01-01"),
			listed("z", "49.0", null),
		];
		expect(sourceTimeline(copies.toReversed())).toEqual(sourceTimeline(copies));
	});
});

/** A Pixel build's copies: each file on each device it ships to. */
const build = (r: ReleaseOrder, files: Array<[string, string, string[]]>): SourceCopy[] =>
	files.flatMap(([sha, version, devices]) => devices.map((d) => shipped(r, sha, version, d)));

describe("Android timelines", () => {
	const NEW = release("CP3A.260905.009", null),
		OLD = release("CP3A.260805.001", null);
	const copies = [
		...build(NEW, [
			["s9", "40", ["frankel", "tokay", "comet"]],
			["s6", "40", ["oriole", "raven"]],
		]),
		...build(OLD, [
			["s9", "40", ["tokay", "comet"]],
			["s6old", "39", ["oriole", "raven"]],
		]),
	];
	const t = sourceTimeline(copies);

	it("keeps one line per device, one version carrying different files on different devices", () => {
		expect(linesOf(ANDROID, t, ORDER)).toEqual(["frankel", "tokay", "comet", "raven", "oriole"]);
		expect(lineOf(t, "tokay").map((e) => e.slug)).toEqual(["40"]);
		expect(lineOf(t, "oriole").map((e) => [e.slug, e.sha, e.changed])).toEqual([
			["40", "s6", true],
			["39", "s6old", true],
		]);
		expect(["s9", "s6", "s6old"].map((sha) => canonicalLine(ANDROID, t, sha, ORDER)?.line)).toEqual([
			"frankel",
			"raven",
			"raven",
		]);
	});

	it("keeps identical bytes under a new version as their own, unchanged entry", () => {
		const t2 = sourceTimeline([
			...build(release("B2", null), [["same", "41", ["tokay"]]]),
			...build(release("B1", null), [["same", "40", ["tokay"]]]),
		]);
		expect(lineOf(t2, "tokay").map((e) => [e.slug, e.changed])).toEqual([
			["41", false],
			["40", true],
		]);
	});

	it("heads on the newest device, and each phone reads the file the newest build ships it", () => {
		expect(head(ANDROID, t, ORDER)?.line).toBe("frankel");
		const heads = phoneHeads({ source: ANDROID, copies, timeline: t, order: ORDER, base: [] }, [
			"frankel",
			"tokay",
			"comet",
			"raven",
			"oriole",
			"flame",
		]);
		expect(Object.fromEntries([...heads].map(([p, h]) => [p, h.sha]))).toEqual({
			frankel: "s9",
			tokay: "s9",
			comet: "s9",
			raven: "s6",
			oriole: "s6",
		});
	});

	it("merges an update file into the image copy of its bytes, and adds a newer one to each Pixel it was listed for", () => {
		const u = sourceTimeline([
			...copies,
			listed("s9", "40", null, "tokay"),
			listed("s10", "41", "2026-09-18", "tokay"),
			listed("s10", "41", "2026-09-18", "comet"),
		]);
		expect(lineOf(u, "tokay").map((e) => [e.slug, e.sha])).toEqual([
			["41", "s10"],
			["40", "s9"],
		]);
		expect(lineOf(u, "comet")[0]?.day).toBe("2026-09-18");
		expect(lineOf(u, "frankel").map((e) => e.slug)).toEqual(["40"]);
		expect(canonicalLine(ANDROID, u, "s10", ORDER)?.line).toBe("tokay");
		expect(lastChanged(u)).toBe("2026-09-18");
	});

	it("finds a version on a line, the one before it and the line's head, or says what is missing", () => {
		const at = versionOn(ANDROID, t, ORDER, "oriole", "39");
		expect(at.found && [at.line, at.entry.sha, at.previous, at.latest.slug]).toEqual([
			"oriole",
			"s6old",
			null,
			"40",
		]);
		const latest = versionOn(ANDROID, t, ORDER, undefined, undefined);
		expect(latest.found && [latest.line, latest.entry.slug, latest.previous]).toEqual([
			"frankel",
			"40",
			null,
		]);
		expect(versionOn(ANDROID, t, ORDER, "nope", undefined)).toEqual({ found: false, missing: "line" });
		expect(versionOn(ANDROID, t, ORDER, "tokay", "39")).toEqual({ found: false, missing: "version" });
	});
});

const iosHeader = (id: string, label: string, released: string): ReleaseHeader => ({
	platform: "ios",
	id,
	version: label,
	label,
	prerelease: label.includes("beta"),
	released,
	devices: [],
	extractedAt: "x",
});
const pixelHeader = (id: string, version: string, patch: string): ReleaseHeader => ({
	platform: "android",
	id,
	version,
	patch,
	devices: [],
	extractedAt: "x",
});
const galaxyHeader = (id: string, version: string, released: string): ReleaseHeader => ({
	platform: "samsung",
	id,
	version,
	released,
	devices: [],
	extractedAt: "x",
});

const versionOf = (r: ReleaseHeader): ReleaseVersion => ({
	id: r.id,
	version: r.version,
	patch: r.platform === "android" ? r.patch : null,
	released: r.released ?? null,
});

/** Newest first, as the builds lists show them. */
const newestFirstByKey = (rs: readonly ReleaseHeader[]): string[] =>
	rs.toSorted((a, b) => (releaseSortKey(a) < releaseSortKey(b) ? 1 : -1)).map((r) => r.id);

describe("releaseSortKey", () => {
	it("orders by release day, so a point release out after a beta sorts above it", () => {
		const rs = [
			iosHeader("24A437", "27.0", "2026-09-14"),
			iosHeader("24A446", "27.0.1", "2026-09-28"),
			iosHeader("24B5084k", "27.2 beta", "2026-09-16"),
			iosHeader("24B5089g", "27.2 beta 2", "2026-09-21"),
		];
		expect(newestFirstByKey(rs)).toEqual(["24A446", "24B5089g", "24B5084k", "24A437"]);
	});

	it("leaves pairing a build with the one before it to version order: 27.0.1 follows 27.0, whatever the 27.2 beta's day", () => {
		const rs = [
			iosHeader("24A446", "27.0.1", "2026-09-28"),
			iosHeader("24B5089g", "27.2 beta 2", "2026-09-21"),
			iosHeader("24A437", "27.0", "2026-09-14"),
		];
		expect(
			rs
				.map(versionOf)
				.toSorted(compareReleases)
				.map((r) => r.id),
		).toEqual(["24A437", "24A446", "24B5089g"]);
	});

	it("orders one day's releases by version, then id", () => {
		const rs = [
			galaxyHeader("S9480CHC4AZI1", "16", "2026-09-16"),
			galaxyHeader("F976U1OYM3AZI8", "17", "2026-09-16"),
			galaxyHeader("F976UOYN3AZI8", "17", "2026-09-16"),
		];
		expect(newestFirstByKey(rs)).toEqual(["F976UOYN3AZI8", "F976U1OYM3AZI8", "S9480CHC4AZI1"]);
	});

	it("orders undated releases below dated ones, by version, patch level and id", () => {
		const rs = [
			pixelHeader("AP3A.241005.015", "15", "2024-10"),
			pixelHeader("AP2A.240805.005.S4", "14", "2024-11"),
			pixelHeader("CD1A.260905.001.B1", "17", "2026-09"),
			pixelHeader("CP3A.260905.009", "17", "2026-09"),
			pixelHeader("CP2A.260805.005", "17", "2026-08"),
			{ ...pixelHeader("TQ1A.230105.001", "13", "2023-01"), released: "2023-01-03" },
		];
		expect(newestFirstByKey(rs)).toEqual([
			"TQ1A.230105.001",
			"CP3A.260905.009",
			"CD1A.260905.001.B1",
			"CP2A.260805.005",
			"AP3A.241005.015",
			"AP2A.240805.005.S4",
		]);
	});
});

/** A release's copies as the changes step reads them, each with its entry's slug. */
const ships = (source: string, line: string, sha: string, slug = sha): ShippedCopy => ({
	source: `ios:carrier:${source}`,
	line,
	sha,
	slug,
});

const attPixel = (line: string, sha: string): ShippedCopy => ({
	source: "android:carrier:att_us",
	line,
	sha,
	slug: "40",
});
const attChange = (from: string, to: string): unknown => [
	{
		source: "ios:carrier:ATT_US",
		kind: "changed",
		from: { line: "", slug: from },
		to: { line: "", slug: to },
	},
];

describe("releaseChanges", () => {
	it("lists what a release changed against its platform's previous one", () => {
		const was = [ships("ATT_US", "", "72.1"), ships("Gone_US", "", "1.0")];
		const now = [ships("ATT_US", "", "72.2"), ships("New_US", "", "2.0")];
		expect(releaseChanges(was, now, ORDER)).toEqual([
			{
				source: "ios:carrier:ATT_US",
				kind: "changed",
				from: { line: "", slug: "72.1" },
				to: { line: "", slug: "72.2" },
			},
			{ source: "ios:carrier:Gone_US", kind: "removed", from: { line: "", slug: "1.0" } },
			{ source: "ios:carrier:New_US", kind: "added", to: { line: "", slug: "2.0" } },
		]);
		expect(releaseChanges(null, now, ORDER)).toEqual([]);
	});

	it("counts a change on any device, linking to the newest device's entry, and a file listed twice as no change", () => {
		const was = [attPixel("tokay", "s9"), attPixel("oriole", "s6")];
		expect(releaseChanges(was, [attPixel("tokay", "s9"), attPixel("oriole", "s7")], ORDER)).toEqual([
			{
				source: "android:carrier:att_us",
				kind: "changed",
				from: { line: "tokay", slug: "40" },
				to: { line: "tokay", slug: "40" },
			},
		]);
		expect(releaseChanges(was, [...was, attPixel("comet", "s9")], ORDER)).toEqual([]);
	});

	it("decides an older build backfilled between two others against both, as the index step re-derives (previous, it) and (it, next)", () => {
		const a = [ships("ATT_US", "", "a")],
			b = [ships("ATT_US", "", "b")],
			c = [ships("ATT_US", "", "c")];
		expect(releaseChanges(a, c, ORDER)).toEqual(attChange("a", "c"));
		expect([releaseChanges(a, b, ORDER), releaseChanges(b, c, ORDER)]).toEqual([
			attChange("a", "b"),
			attChange("b", "c"),
		]);
	});
});

const states = (volte: "on" | "no", extra: Profile["concepts"] = {}): Profile["concepts"] => ({
	volte: { kind: "state", state: volte, because: [], fidelity: "exact" },
	...extra,
});

const phoneProfile = (
	source: SourceRef,
	concepts: Profile["concepts"],
	variants: Profile["variants"] = [],
): PhoneProfile => ({ source, concepts, variants, apns: [], raw: {} });

describe("sourceBase", () => {
	it("is the base under the newest phone that reads the source, none without one", () => {
		const heads = new Map([
			["tokay", { sha: "a", base: "d-tokay" }],
			["frankel", { sha: "a", base: "d-frankel" }],
		]);
		// frankel (2025-08) is newer than tokay (2024-08).
		expect(sourceBase(heads, ORDER)).toBe("d-frankel");
		expect(sourceBase(new Map(), ORDER)).toBeNull();
	});
});

describe("phoneStates", () => {
	const fiveG = { "5g": { kind: "state", state: "on", because: [], fidelity: "exact" } } as const;

	it("gives a Galaxy its own model's newest pack: a firmware is one model's", () => {
		const TMB: SourceRef = { platform: "samsung", kind: "carrier", name: "TMB" };
		const copies = [
			shipped(release("S931U1OYM1", "2026-08-01"), "s25", "16.1", "SM-S931U1"),
			shipped(release("S928U1OYM2", "2026-07-01"), "s24", "16.2", "SM-S928U1"),
			shipped(release("S931U1OYM0", "2026-06-01"), "old", "16.0", "SM-S931U1"),
		];
		const timeline = sourceTimeline(copies);
		const phones: Phone[] = ["SM-S931U1", "SM-S928U1"].map((code) => ({ code, boards: [], has5g: true }));
		const heads = phoneHeads(
			{ source: TMB, copies, timeline, order: ORDER, base: [] },
			phones.map((p) => p.code),
		);
		const profiles = new Map([
			["s25", phoneProfile(TMB, states("on"))],
			["s24", phoneProfile(TMB, states("no"))],
		]);
		expect(phoneStates(heads, (sha) => profiles.get(sha), phones)).toEqual([
			{ device: "SM-S931U1", states: { volte: "on" }, defaults: {} },
			{ device: "SM-S928U1", states: { volte: "no" }, defaults: {} },
		]);
	});

	it("turns EVS and ViLTE off with VoLTE off, whatever the file sets for them", () => {
		const copies = [shipped(release("24A1", "2026-09-15"), "i5", "73.0")];
		const phones: Phone[] = [{ code: "iPhone18,1", boards: ["V53AP"], has5g: true }];
		const heads = phoneHeads(
			{ source: IOS, copies, timeline: sourceTimeline(copies), order: ORDER, base: [] },
			phones.map((p) => p.code),
		);
		const on = { kind: "state", state: "on", because: [], fidelity: "exact" } as const;
		const profile = phoneProfile(
			IOS,
			states("no", { "hd-voice-plus": on, "video-calling": on, "wifi-calling": on }),
		);
		expect(phoneStates(heads, () => profile, phones)).toEqual([
			{
				device: "iPhone18,1",
				states: { volte: "no", "hd-voice-plus": "no", "video-calling": "no", "wifi-calling": "on" },
				defaults: {},
			},
		]);
	});

	it("applies an iPhone's board's override file over its bundle, and turns 5G features off on a phone without a 5G radio", () => {
		const copies = [shipped(release("24A1", "2026-09-15"), "i5", "73.0")];
		const iphones: Phone[] = [
			{ code: "iPhone18,1", boards: ["V53AP"], has5g: true },
			{ code: "iPhone13,2", boards: ["D53gAP"], has5g: true },
			{ code: "iPhone12,8", boards: ["D79AP"], has5g: false },
			{ code: "iPhone10,1", boards: ["D20AP"], has5g: false },
		];
		const heads = phoneHeads(
			{ source: IOS, copies, timeline: sourceTimeline(copies), order: ORDER, base: [] },
			iphones.map((p) => p.code),
		);
		const profile = phoneProfile(IOS, states("on", fiveG), [
			{
				id: "phones:overrides_D20_D53g.plist",
				when: { kind: "board", boards: ["D20", "D53g"] },
				concepts: states("no"),
				apns: [],
			},
		]);
		expect(phoneStates(heads, () => profile, iphones)).toEqual([
			{ device: "iPhone18,1", states: { "5g": "on", volte: "on" }, defaults: {} },
			{ device: "iPhone13,2", states: { "5g": "on", volte: "no" }, defaults: {} },
			{ device: "iPhone12,8", states: { "5g": "no", volte: "on" }, defaults: {} },
			{ device: "iPhone10,1", states: { "5g": "no", volte: "no" }, defaults: {} },
		]);
	});

	it("keeps 5G features on a phone whose radio no settings have judged, and gives each Pixel the states of the file it ships", () => {
		const copies = build(release("CP3A.1", "2026-09-02"), [
			["a9", "9", ["tokay", "cubs"]],
			["a6", "6", ["oriole"]],
		]);
		const pixels: Phone[] = [
			{ code: "tokay", boards: [], has5g: true },
			{ code: "cubs", boards: [], has5g: null },
			{ code: "oriole", boards: [], has5g: false },
		];
		const heads = phoneHeads(
			{ source: ANDROID, copies, timeline: sourceTimeline(copies), order: ORDER, base: [] },
			pixels.map((p) => p.code),
		);
		const profiles = new Map([
			["a9", phoneProfile(ANDROID, states("on", fiveG))],
			["a6", phoneProfile(ANDROID, states("no", fiveG))],
		]);
		const own = phoneStates(heads, (sha) => profiles.get(sha), pixels).map((r) => ({
			device: r.device,
			volte: r.states.volte,
			"5g": r.states["5g"],
		}));
		expect(own).toEqual([
			{ device: "tokay", volte: "on", "5g": "on" },
			{ device: "cubs", volte: "on", "5g": "on" },
			{ device: "oriole", volte: "no", "5g": "no" },
		]);
		expect(() => phoneStates(heads, () => undefined, pixels)).toThrow(/no profile was given/);
	});

	it("reads what a Pixel's carrier file leaves unset from the default.pb its build ships, then AOSP, naming the layer", () => {
		const pixel = (raw: Profile["raw"]): PhoneProfile => ({
			...phoneProfile(ANDROID, androidConcepts({ config: fileConfig(raw), apns: [] })),
			raw,
		});
		const profiles = new Map([
			["quiet", pixel({})],
			["sa", pixel({ "config:carrier_nr_availabilities_int_array": [2, 1] })],
			[
				"base",
				pixel({
					"config:carrier_nr_availabilities_int_array": [1],
					"config:carrier_volte_available_bool": true,
				}),
			],
		]);
		expect(profiles.get("quiet")?.concepts["5g-standalone"]).toEqual({ kind: "unset" });
		const NEW = release("CP3A.2", "2026-09-02"),
			OLD = release("CP3A.1", "2026-08-02");
		const copies = [...build(NEW, [["quiet", "9", ["tokay"]]]), ...build(OLD, [["sa", "8", ["oriole"]]])];
		const base = [...build(NEW, [["base", "2", ["tokay"]]]), ...build(OLD, [["base", "1", ["comet"]]])];
		const phones: Phone[] = ["tokay", "oriole"].map((code) => ({ code, boards: [], has5g: true }));
		const heads = phoneHeads(
			{ source: ANDROID, copies, timeline: sourceTimeline(copies), order: ORDER, base },
			phones.map((p) => p.code),
		);
		expect(Object.fromEntries(heads)).toEqual({ tokay: { sha: "quiet", base: "base" } });
		const read = (h: ReadonlyMap<string, PhoneHead>) =>
			phoneStates(h, (sha) => profiles.get(sha), phones).map((r) => ({
				device: r.device,
				sa: r.states["5g-standalone"],
				volte: r.states.volte,
				from: { sa: r.defaults["5g-standalone"]?.layer, volte: r.defaults.volte?.layer },
			}));
		expect(read(heads)).toEqual([
			{ device: "tokay", sa: "no", volte: "on", from: { sa: "default.pb", volte: "aosp" } },
		]);
		const unbased = new Map([
			["tokay", { sha: "quiet", base: null }],
			["oriole", { sha: "sa", base: null }],
		]);
		expect(read(unbased)).toEqual([
			{ device: "tokay", sa: "on", volte: "no", from: { sa: "aosp", volte: "aosp" } },
			{ device: "oriole", sa: "on", volte: "no", from: { sa: undefined, volte: "aosp" } },
		]);
	});

	it("keeps a Pixel's carrier offering a feature its own, crediting a layer only with whether it starts on", () => {
		const raw = {
			"config:carrier_volte_available_bool": true,
			"config:carrier_wfc_ims_available_bool": true,
			"config:vonr_enabled_bool": true,
		};
		const carrier: PhoneProfile = {
			...phoneProfile(ANDROID, androidConcepts({ config: fileConfig(raw), apns: [] })),
			raw,
		};
		const base: PhoneProfile = {
			...phoneProfile(ANDROID, {}),
			raw: { "config:carrier_default_wfc_ims_enabled_bool": true },
		};
		const profiles = new Map([
			["carrier", carrier],
			["base", base],
		]);
		const [tokay] = phoneStates(
			new Map([["tokay", { sha: "carrier", base: "base" }]]),
			(sha) => profiles.get(sha),
			[{ code: "tokay", boards: [], has5g: true }],
		);
		expect(tokay?.states).toMatchObject({ volte: "on", "wifi-calling": "on", "voice-over-5g": "on" });
		expect(tokay?.defaults).toMatchObject({
			volte: { layer: "aosp", part: "rest" },
			"wifi-calling": { layer: "default.pb", part: "rest" },
			"voice-over-5g": { layer: "aosp", part: "rest" },
		});
	});

	it("gives no phone states from a country or default bundle", () => {
		const copies = [shipped(release("24A1", "2026-09-15"), "f", "60.0")];
		const country: SourceRef = { platform: "ios", kind: "country", name: "France" };
		expect(
			phoneHeads({ source: country, copies, timeline: sourceTimeline(copies), order: ORDER, base: [] }, [
				"iPhone18,1",
			]).size,
		).toBe(0);
	});

	it("reads feature states per phone, of carrier sources only", () => {
		expect(perPhone("carrier", "5g")).toBe(true);
		expect(perPhone("carrier", "audio-codecs")).toBe(false);
		expect(perPhone("country", "5g")).toBe(false);
	});
});

describe("profileFacts", () => {
	const profile: Profile = {
		schema: PROFILE_SCHEMA,
		source: IOS,
		sha: "p1",
		identity: {
			display: "Test",
			iso: ["us"],
			sims: [{ mccmnc: "310410" }, { mccmnc: "310410", gid1: "6D" }, { mccmnc: "310410" }],
		},
		apns: [],
		concepts: {
			...states("on"),
			"apn-attach": { kind: "value", value: "ims", because: [], fidelity: "exact" },
			rcs: { kind: "unset" },
		},
		raw: {
			"carrier.plist:apns[0].configuration[1].apn": "internet",
			"carrier.plist:CarrierName": "Test",
			"signatures/carrier.plist:hash": "00",
			"en.lproj/Localizable.strings:x": "y",
			"apns[2].apn": "fast",
		},
		variants: [],
	};

	it("writes each leaf with its file, its key, its path with array indexes as [*] and its value as canonical JSON; never signatures or localisations", () => {
		expect(profileFacts(profile)).toEqual({
			sha: "p1",
			schema: PROFILE_SCHEMA,
			kind: "settings",
			display: "Test",
			iso: ["us"],
			sims: ["310410", "310410|gid1=6D"],
			radio: {},
		});
		expect(headRows(profile)).toEqual({
			settings: [
				{
					file: "carrier.plist",
					key: "apns[0].configuration[1].apn",
					path: "apns[*].configuration[*].apn",
					value: '"internet"',
				},
				{ file: "carrier.plist", key: "CarrierName", path: "CarrierName", value: '"Test"' },
				{ file: "", key: "apns[2].apn", path: "apns[*].apn", value: '"fast"' },
			],
			concepts: [
				{ concept: "volte", value: '"on"' },
				{ concept: "apn-attach", value: '"ims"' },
				{ concept: "rcs", value: "null" },
			],
		});
	});

	it("writes a modem configuration's selection as its SIM rules, nothing a carrier list shows, and its radio over its base's", () => {
		const config: ModemConfig = {
			schema: PROFILE_SCHEMA,
			family: "qualcomm",
			sha: "m1",
			label: "Commercial-TMO",
			scope: "carrier",
			selection: [{ mccmnc: "310260" }],
			facts: [],
			items: [],
			base: null,
			combos: [],
			errors: [],
		};
		expect(modemFacts(config, null)).toEqual({
			sha: "m1",
			schema: PROFILE_SCHEMA,
			kind: "modem",
			display: null,
			iso: [],
			sims: ["310260"],
			radio: "lte",
		});
		expect(modemFacts(config, "nr").radio).toBe("nr");
	});

	it("judges rarity in each family's main file, by today's thresholds", () => {
		expect([mainFile("ios"), mainFile("watchos"), mainFile("android"), mainFile("samsung")]).toEqual([
			"carrier.plist",
			"carrier.plist",
			"config",
			"customer.xml",
		]);
		expect(RARITY).toEqual({
			minHolders: 15,
			maxDistinctFloor: 4,
			holdersPerDistinct: 10,
			minGroupForRareKey: 50,
			maxSharers: 3,
			valuesPerTop: 3,
			keysPerTop: 1,
			keep: 30,
		});
	});
});

describe("indexing a unit twice", () => {
	it("derives identical rows, whatever order the index returns the copies in", () => {
		const copies = [
			...build(release("CP3A.2", "2026-09-02"), [
				["s9", "40", ["frankel", "tokay"]],
				["s6", "40", ["oriole"]],
			]),
			...build(release("CP3A.1", "2026-08-02"), [
				["s8", "39", ["tokay"]],
				["s6", "40", ["oriole"]],
			]),
			listed("s10", "41", "2026-09-18", "tokay"),
		];
		const derive = (cs: readonly SourceCopy[]): unknown => {
			const timeline = sourceTimeline(cs);
			const heads = phoneHeads({ source: ANDROID, copies: cs, timeline, order: ORDER, base: [] }, [
				"frankel",
				"tokay",
				"oriole",
			]);
			const shippedIn = (id: string): ShippedCopy[] =>
				cs.flatMap((c) => {
					const e =
						c.kind === "release" && c.release.id === id
							? timeline.find((x) => x.line === c.line && x.sha === c.sha && x.version === c.version)
							: undefined;
					return e === undefined
						? []
						: [{ source: "android:carrier:test_us", line: c.line, sha: c.sha, slug: e.slug }];
				});
			return {
				timeline,
				head: head(ANDROID, timeline, ORDER),
				updated: lastChanged(timeline),
				heads: [...heads],
				states: phoneStates(heads, () => phoneProfile(ANDROID, states("on")), [
					{ code: "tokay", boards: [], has5g: false },
				]),
				changes: releaseChanges(shippedIn("CP3A.1"), shippedIn("CP3A.2"), ORDER),
			};
		};
		const once = derive(copies);
		expect(derive(copies)).toEqual(once);
		expect(derive(copies.toReversed())).toEqual(once);
	});
});
