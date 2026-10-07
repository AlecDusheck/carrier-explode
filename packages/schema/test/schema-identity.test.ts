import { describe, expect, it } from "vitest";

import {
	identityChanged,
	linkCarriers,
	manifestRoutes,
	membersByPrimacy,
	matcherKey,
	parseRuleKey,
	ruleKey,
	ruleSpecificity,
	selectsSim,
	sourceKey,
	type LinkRule,
	type SimMatcher,
	type SimRule,
	type ApplePlatform,
	type SourceIdentity,
	type SourceKey,
	type SourceRef,
} from "../src/index.ts";
import { isUnnamedRule } from "../src/identity.ts";
import { assignIds } from "../src/ids.ts";

type Head = SourceIdentity & { readonly carrier: string | null };

function m(
	platform: SourceRef["platform"],
	name: string,
	sims: SimMatcher[],
	display: string | null = name,
): Head {
	return {
		key: sourceKey({ platform, kind: "carrier", name }),
		display,
		iso: ["us"],
		sims: sims.map(matcherKey),
		routes: [],
		carrier: null,
	};
}

const plain = (...codes: string[]): SimMatcher[] => codes.map((mccmnc) => ({ mccmnc }));
const gid = (g: string): SimMatcher[] => ["310280", "310410"].map((mccmnc) => ({ mccmnc, gid1: g }));
const onAtt = (...gids: string[]): SimMatcher[] => gids.map((gid1) => ({ mccmnc: "310410", gid1 }));

/** Each carrier's members' names, sorted. */
function groups(heads: readonly Head[], rules: readonly LinkRule[] = []): string[][] {
	const { members } = linkCarriers(heads, rules);
	const byCarrier = Map.groupBy(Object.entries(members), ([, id]) => id);
	return [...byCarrier.values()].map((list) => list.map(([k]) => k.split(":")[2] ?? k).toSorted()).toSorted();
}

describe("linkCarriers", () => {
	const host = [
		m("ios", "Verizon_LTE_US", plain("311480", "310590"), "Verizon"),
		m("android", "verizon_us", plain("311480", "310590", "310004")),
	];

	it("links a host by its shared plain network codes, named after its Apple bundle's display", () => {
		expect(groups(host)).toEqual([["Verizon_LTE_US", "verizon_us"]]);
		expect(linkCarriers(host, []).carriers).toEqual([{ id: "Verizon_LTE_US", name: "Verizon", iso: "us" }]);
	});

	it("keeps an MVNO keyed by GID apart from its host's plain codes", () => {
		expect(
			groups([
				...host,
				m("ios", "Verizon_Visible_LTE_US", [{ mccmnc: "311480", gid2: "1A" }]),
				m("android", "visible_us", [{ mccmnc: "311480", gid1: "BAE1000000000000" }]),
			]),
		).toEqual([["Verizon_LTE_US", "verizon_us"], ["Verizon_Visible_LTE_US"], ["visible_us"]]);
	});

	it("does not let an MVNO that lists one of the host's codes join it", () => {
		expect(
			groups([
				m("ios", "TMobile_US", plain("310260", "310160", "310200", "310210")),
				m("android", "tmobile_us", plain("310260", "310160", "310200", "310210")),
				// Lists the host's 310260 among four codes of its own: under half of its rules are shared.
				m("android", "mvno_us", plain("310260", "311990", "311991", "311992", "311993")),
			]),
		).toEqual([["TMobile_US", "tmobile_us"], ["mvno_us"]]);
	});

	it("joins a second SIM profile of one carrier to its best match when most of its rules are shared", () => {
		expect(
			groups([
				m("ios", "ATT_NR_US", [...gid("53"), ...gid("52"), { mccmnc: "310950", gid1: "53" }]),
				m("android", "att5g_us", [...gid("53"), { mccmnc: "310950", gid1: "53" }]),
				m("android", "att5gsa_us", gid("52")),
			]),
		).toEqual([["ATT_NR_US", "att5g_us", "att5gsa_us"]]);
	});

	it("links by the SIM rules Apple's OTA manifest routes to a bundle as well as its own", () => {
		const routed = { ...m("ios", "Mint_US", []), routes: ["310260|spn=MINT"] };
		expect(groups([routed, m("android", "mint_us", [{ mccmnc: "310260", spn: "MINT" }])])).toEqual([
			["Mint_US", "mint_us"],
		]);
	});

	it("keeps a split pair apart when a third source would bridge them", () => {
		const split: LinkRule = {
			a: "ios:carrier:KDDI_jp",
			b: "android:carrier:kddimvno5gsa_jp",
			rule: "split",
			why: "test",
		};
		expect(
			groups(
				[
					m("ios", "KDDI_jp", plain("44050", "44051")),
					m("android", "kddi_jp", plain("44050", "44051")),
					m("watchos", "KDDI_jp", plain("44050", "44052")),
					m("android", "kddimvno5gsa_jp", plain("44052")),
				],
				[split],
			),
		).toEqual([["KDDI_jp", "KDDI_jp", "kddi_jp"], ["kddimvno5gsa_jp"]]);
	});

	it("applies people's links and splits", () => {
		const rules: LinkRule[] = [
			{
				a: "ios:carrier:Verizon_Visible_LTE_US",
				b: "android:carrier:visible_us",
				rule: "link",
				why: "keyed differently",
			},
			{ a: "ios:carrier:Verizon_LTE_US", b: "android:carrier:verizon_us", rule: "split", why: "test" },
		];
		expect(
			groups(
				[
					...host,
					m("ios", "Verizon_Visible_LTE_US", [{ mccmnc: "311480", gid2: "1A" }]),
					m("android", "visible_us", [{ mccmnc: "311480", gid1: "BAE1" }]),
				],
				rules,
			),
		).toEqual([["Verizon_LTE_US"], ["Verizon_Visible_LTE_US", "visible_us"], ["verizon_us"]]);
	});

	it("never links by a test or private-network PLMN, which every lab SIM uses", () => {
		expect(
			groups([
				m("android", "test001_zz", plain("00101", "001010")),
				m("samsung", "GCF", plain("00101", "99999")),
				m("android", "pn_xx", plain("99999", "999999")),
				m("samsung", "VZW", [...plain("00101", "999999", "311480"), { mccmnc: "001010", gid1: "BAE0" }]),
				m("android", "verizon_us", plain("311480")),
			]),
		).toEqual([["GCF"], ["VZW", "verizon_us"], ["pn_xx"], ["test001_zz"]]);
	});

	it("never links by the network 3GPP's conformance tests simulate (TS 31.121: 246 081)", () => {
		// Galaxy VZW and Apple's CarrierLab share only 246081 and 24681.
		expect(
			groups([
				m("ios", "CarrierLab", plain("246081", "24681", "26280", "311011"), null),
				m(
					"samsung",
					"VZW",
					[...plain("246081", "24681", "311028"), { mccmnc: "311480", gid1: "BAE0000000000000" }],
					null,
				),
			]),
		).toEqual([["CarrierLab"], ["VZW"]]);
	});

	it("links nothing by a best match tied between several sources of one platform", () => {
		// 310028 and 311390 are listed by Galaxy VZW and USC alike, so they would bridge Verizon's pack into UScellular.
		expect(
			groups([
				m("ios", "USCellular_LTE_US", plain("311580", "311589")),
				m("samsung", "USC", plain("311580", "311589", "310028", "311390")),
				m("samsung", "VZW", [...plain("310028", "311390"), { mccmnc: "311480", gid1: "BAE0000000000000" }]),
				m("android", "310028", plain("310028")),
				m("android", "311390", plain("311390")),
			]),
		).toEqual([["310028"], ["311390"], ["USC", "USCellular_LTE_US"], ["VZW"]]);
	});

	it("takes no match as mutual while the other side's best is tied", () => {
		// Dev's ATT_MVNO_US shares its rules with Galaxy DSA and XAA alike; DSA's best iPhone match is ATT_MVNO_US, which
		// bridged Boost (boostmobile_us, ATT_Dish_MVNO_US, DSA) into AT&T.
		const mvno = ["20", "21", "22", "23", "24"].flatMap(gid);
		const own = (from: number): SimMatcher[] => onAtt(...Array.from({ length: 30 }, (_, i) => `${from + i}`));
		expect(
			groups([
				m("ios", "ATT_MVNO_US", mvno),
				m("ios", "ATT_Dish_MVNO_US", onAtt("3432", "3434", "3436")),
				m("android", "boostmobile_us", onAtt("3430", "3432", "3434", "3436")),
				m("samsung", "DSA", [...onAtt("3432", "3434", "3436"), ...mvno, ...own(100)]),
				m("samsung", "XAA", [...mvno, ...own(200)]),
			]),
		).toEqual([["ATT_Dish_MVNO_US", "DSA", "boostmobile_us"], ["ATT_MVNO_US"], ["XAA"]]);
	});

	it("names a carrier from its sources' names when no head displays one, leaving a bare source name for a label", () => {
		const { carriers } = linkCarriers(
			[m("android", "tmobile_us", plain("310260"), null), m("samsung", "TMB", plain("310260"), null)],
			[],
		);
		// The Android name without its country reads as a name; a sales code does not, so a label names that carrier.
		expect(carriers).toEqual([{ id: "tmobile_us", name: "tmobile", iso: "us" }]);
		expect(linkCarriers([m("samsung", "XAA", plain("310999"), null)], []).carriers).toEqual([
			{ id: "XAA", name: null, iso: "us" },
		]);
	});

	it("keeps a carrier's current id while it is still one of its names", () => {
		const fresh = [
			m("ios", "ATT_NR_US", plain("310410", "310280")),
			m("ios", "ATT_US", plain("310410", "310280")),
			m("android", "att_us", plain("310410", "310280")),
		];
		const [nr, att, android] = fresh;
		if (nr === undefined || att === undefined || android === undefined) throw new Error("three heads");
		const both = [{ ...nr, carrier: "ATT_US" }, { ...att, carrier: "ATT_US" }, android];
		const link: LinkRule = { a: "ios:carrier:ATT_NR_US", b: "ios:carrier:ATT_US", rule: "link", why: "test" };
		expect(linkCarriers(both, [link]).carriers.map((c) => c.id)).toEqual(["ATT_US"]);
		expect(linkCarriers(fresh, [link]).carriers.map((c) => c.id)).toEqual(["ATT_NR_US"]);
	});

	it("names a carrier after its iPhone bundle before its iPad or Watch bundle, whatever their SIM counts", () => {
		const { carriers } = linkCarriers(
			[
				m("watchos", "Test_US", plain("310410", "310260"), "Watch"),
				m("ios", "Test_US", plain("310410"), "iPhone"),
			],
			[],
		);
		expect(carriers).toEqual([{ id: "Test_US", name: "iPhone", iso: "us" }]);
	});

	it("links an iPhone, iPad and Watch bundle by the SIMs they share, like any other platforms", () => {
		expect(
			groups([
				m("ios", "Test_US", plain("310410")),
				m("watchos", "Test_US", plain("310410")),
				m("android", "test_us", plain("310410")),
			]),
		).toEqual([["Test_US", "Test_US", "test_us"]]);
	});

	it("links the same heads to the same carriers whatever order they come in", () => {
		const heads = [
			...host,
			m("ios", "Verizon_Visible_LTE_US", [{ mccmnc: "311480", gid2: "1A" }]),
			m("android", "visible_us", [{ mccmnc: "311480", gid1: "BAE1" }]),
		];
		expect(linkCarriers(heads.toReversed(), [])).toEqual(linkCarriers(heads, []));
	});
});

describe("membersByPrimacy", () => {
	it("puts each platform's source with the most SIM rules first, platforms in PLATFORMS order", () => {
		const members = [
			m("android", "att5g_us", plain("310410")),
			m("android", "att_us", plain("310410", "310280", "310950")),
			m("samsung", "ATT", plain("310410")),
			m("ios", "ATT_NR_US", plain("310410")),
			m("ios", "ATT_US", plain("310410", "310280")),
		];
		expect(membersByPrimacy(members)).toEqual([
			"ios:carrier:ATT_US",
			"ios:carrier:ATT_NR_US",
			"android:carrier:att_us",
			"android:carrier:att5g_us",
			"samsung:carrier:ATT",
		]);
	});
});

describe("identityChanged", () => {
	const head = m("ios", "Test_US", plain("310410", "310260"));

	it("asks for linking when a source is new or what linking reads of it changed, not when only its order did", () => {
		expect(identityChanged(undefined, head)).toBe(true);
		expect(identityChanged(head, { ...head, sims: head.sims.toReversed() })).toBe(false);
		expect(identityChanged(head, { ...head, sims: ["310410"] })).toBe(true);
		expect(identityChanged(head, { ...head, routes: ["310410|gid1=6D"] })).toBe(true);
		expect(identityChanged(head, { ...head, display: "Test" })).toBe(true);
		expect(identityChanged(head, { ...head, iso: ["ca"] })).toBe(true);
	});
});

describe("manifestRoutes", () => {
	const routed = manifestRoutes({
		MobileDeviceCarriers: { "8901150": "ATT_US" },
		MobileDeviceCarriersByCarrierID: { "310VZW": "Verizon_LTE_US" },
		MobileDeviceCarriersByMccMnc: {
			"311480": {
				MVNOs: [
					{ BundleName: "Verizon_Visible_LTE_US", GID2: "1A" },
					{ BundleName: "Verizon_LTE_US", GID2: "FF" },
				],
			},
		},
		CarrierBundles: {
			Watch: {
				IMSI: {
					"311480": { BundleMapKey: "311480_Map", MVNOs: [{ BundleMapKey: "visible_Map", GID2: "1A" }] },
				},
				BundleMappings: {
					"311480_Map": {
						1: { BundleMatchEntry: "Verizon_1", OS: { Min: "7.0" } },
						2: { BundleMatchEntry: "Verizon_2", OS: { Min: "9.0" } },
					},
					visible_Map: { 1: { BundleMatchEntry: "Visible_1" } },
				},
				Bundles: {
					Verizon_1: { BundleID: "Verizon_LTE_US" },
					Verizon_2: { BundleID: "Verizon_LTE_US" },
					Visible_1: { BundleID: "Verizon_Visible_LTE_US" },
				},
			},
		},
	});

	const sims = (key: SourceKey<ApplePlatform>): string[] => (routed[key] ?? []).map(ruleKey);

	it("routes iPhone and iPad bundles by the PLMN table, an all-FF GID being no rule", () => {
		expect(routed["ios:carrier:Verizon_Visible_LTE_US"]).toEqual([
			{ by: "plmn", sim: { mccmnc: "311480", gid2: "1A" } },
		]);
		expect(sims("ipados:carrier:Verizon_Visible_LTE_US")).toEqual(["311480|gid2=1A"]);
	});

	it("routes iPhone and iPad bundles by ICCID prefix alone and by carrier ID too", () => {
		expect(sims("ios:carrier:ATT_US")).toEqual(["iccid:8901150"]);
		expect(sims("ipados:carrier:ATT_US")).toEqual(["iccid:8901150"]);
		expect(sims("ios:carrier:Verizon_LTE_US")).toEqual(["311480", "carrierId:310VZW"]);
	});

	it("routes Watch bundles through the Watch IMSI table and its bundle mappings", () => {
		expect(sims("watchos:carrier:Verizon_LTE_US")).toEqual(["311480"]);
		expect(sims("watchos:carrier:Verizon_Visible_LTE_US")).toEqual(["311480|gid2=1A"]);
	});
});

describe("rule keys", () => {
	const rules: readonly SimRule[] = [
		{ by: "plmn", sim: { mccmnc: "310260" } },
		{
			by: "plmn",
			sim: {
				mccmnc: "20404",
				gid1: "6D",
				gid2: "1A",
				spn: "A|B=C",
				imsiPrefix: "2040412",
				iccidPrefix: "891480",
			},
		},
		{ by: "iccid", prefix: "8901150" },
		{ by: "carrierId", id: "310VZW" },
	];

	it("read back every rule the routing tables and profiles write", () => {
		for (const r of rules) expect(parseRuleKey(ruleKey(r))).toEqual(r);
		expect(ruleKey({ by: "plmn", sim: { mccmnc: "310260", gid1: "6D" } })).toBe(
			matcherKey({ mccmnc: "310260", gid1: "6D" }),
		);
	});

	it("refuse a key no rule gives", () => {
		for (const key of [
			"",
			"3102",
			"310260|mcc=1",
			"310260|gid1",
			"310260|gid2=1|gid1=6D",
			"310260|gid1=1|gid1=2",
			"iccid:",
			"imei:1",
		])
			expect(parseRuleKey(key)).toBeUndefined();
	});

	it("select a SIM by PLMN and every qualifier they state, a GID or IMSI by prefix", () => {
		const [bare, qualified, iccid, carrierId] = rules;
		if (bare === undefined || qualified === undefined || iccid === undefined || carrierId === undefined)
			throw new Error("rules");
		expect(selectsSim(bare, { mccmnc: "310260", gid1: "6D38" })).toBe(true);
		expect(selectsSim(bare, { mccmnc: "31026" })).toBe(false);
		const sim = {
			mccmnc: "20404",
			gid1: "6d38ff",
			gid2: "1A",
			spn: " a|b=c ",
			imsi: "204041234",
			iccid: "8914800",
		};
		expect(selectsSim(qualified, sim)).toBe(true);
		expect(selectsSim(qualified, { ...sim, gid1: "6E" })).toBe(false);
		const { gid2: _gid2, ...noGid2 } = sim;
		expect(selectsSim(qualified, noGid2)).toBe(false);
		expect(selectsSim(iccid, { mccmnc: "311480", iccid: "89011500001" })).toBe(true);
		expect(selectsSim(carrierId, { mccmnc: "311480" })).toBe(false);
		expect(rules.map(ruleSpecificity)).toEqual([0, 5, 1, 1]);
	});
});

/** The ids assignIds gives carriers that are plain member lists. */
const ids = (carriers: SourceRef[][], previous: Record<string, string> = {}): string[] =>
	assignIds(carriers, (c) => c, previous).map((x) => x.id);

const im = (platform: SourceRef["platform"], name: string): SourceRef => ({
	platform,
	kind: "carrier",
	name,
});

describe("assignIds", () => {
	it("names a carrier after its primary member, qualifying a name another carrier holds", () => {
		expect(
			ids([
				[im("ios", "ATT_NR_US"), im("ios", "ATT_US")],
				[im("android", "fi_us")],
				[im("ios", "Fi_US")],
				[im("android", "Fi_US")],
			]),
		).toEqual(["ATT_NR_US", "fi_us", "Fi_US", "android-Fi_US"]);
	});

	it("keeps a previous id while it is still one of the carrier's names", () => {
		const previous = { "ios:carrier:ATT_US": "ATT_US", "android:carrier:att_us": "ATT_US" };
		expect(ids([[im("ios", "ATT_NR_US"), im("ios", "ATT_US"), im("android", "att_us")]], previous)).toEqual([
			"ATT_US",
		]);
		expect(ids([[im("ios", "ATT_NR_US")]], { "ios:carrier:ATT_NR_US": "ATT_US" })).toEqual(["ATT_NR_US"]);
	});

	it("keeps the primary member's previous id when two carriers merge with one vote each", () => {
		// Galaxy CCT linked to the Verizon_Comcast_LTE_US bundle keeps the bundle's carrier id, not the pack's.
		const previous = {
			"ios:carrier:Verizon_Comcast_LTE_US": "Verizon_Comcast_LTE_US",
			"samsung:carrier:CCT": "CCT",
		};
		expect(ids([[im("ios", "Verizon_Comcast_LTE_US"), im("samsung", "CCT")]], previous)).toEqual([
			"Verizon_Comcast_LTE_US",
		]);
	});
});

const pixel = (name: string) => ({ platform: "android", kind: "carrier", name }) as const;

describe("isUnnamedRule", () => {
	it("is a Pixel carrier named by a carrier_list.pb rule whose carrier has no name", () => {
		expect(
			["20209", "20404GID1=2801", "310000SPN=BLUEWIRE", "20601IMSI=2060188"].map((n) =>
				isUnnamedRule(pixel(n), false),
			),
		).toEqual([true, true, true, true]);
	});

	it("is not one linking named, a canonical name, a default, or another platform's", () => {
		expect([
			isUnnamedRule(pixel("20826"), true),
			isUnnamedRule(pixel("h3g27202_ie"), false),
			isUnnamedRule({ platform: "android", kind: "default", name: "20209" }, false),
			isUnnamedRule({ platform: "samsung", kind: "carrier", name: "20209" }, false),
		]).toEqual([false, false, false, false]);
	});
});
