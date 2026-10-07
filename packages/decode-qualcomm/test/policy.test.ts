/** mav25/band-combos.xml: bbcfg.mbn blob 1 of Mav25-2.10.01.Release.bbfw, combo order changed (test/README.md). */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
	bandList,
	comboStats,
	parseBandCombos,
	parseCombo,
	parsePolicyXml,
	walkPolicy,
} from "../src/policy.ts";
import { defined } from "./defined.ts";

const here = dirname(fileURLToPath(import.meta.url));
const combosXml = readFileSync(join(here, "fixtures", "mav25", "band-combos.xml"), "utf8");

describe("policy XML tree", () => {
	const xml = `<?xml version="1.0"?>
<!-- Carrier policy -->
<policy name = "ROW" policy_ver="128.1.1">
  <initial>
    <mcc_list name="home_mccs" include="hplmn ehplmn" />
    <define_fullrat_config><rat_capability base="hardware" /></define_fullrat_config>
  </initial>
  <if>
    <any_of>
      <not> <phone_operating_mode> ONLINE </phone_operating_mode> </not>
      <location_mcc_in list='us_mccs'/>
    </any_of>
    <then><stop /></then>
    <else><rf_bands list="rf_bands_home"/></else>
  </if>
  <svc_mode> FULL &amp; more </svc_mode>
</policy>\0\0`;

	it("builds the tree with each node's role", () => {
		const [comment, policy] = parsePolicyXml(xml);
		expect(comment).toMatchObject({ kind: "comment", text: "Carrier policy" });
		expect(policy).toMatchObject({
			tag: "policy",
			kind: "policy",
			attrs: { name: "ROW", policy_ver: "128.1.1" },
		});
		const roles = Object.fromEntries([...walkPolicy([defined(policy)])].map((n) => [n.tag, n.kind]));
		expect(roles).toEqual({
			policy: "policy",
			initial: "branch",
			mcc_list: "define",
			define_fullrat_config: "define",
			rat_capability: "define",
			if: "branch",
			any_of: "logic",
			not: "logic",
			phone_operating_mode: "condition",
			location_mcc_in: "condition",
			// oxlint-disable-next-line no-thenable -- keyed by policyman XML tag names; never awaited.
			then: "branch",
			stop: "action",
			else: "branch",
			rf_bands: "action",
			svc_mode: "action",
		});
		const any = defined([...walkPolicy([defined(policy)])].find((n) => n.tag === "any_of"));
		expect(any.children[0]?.children[0]?.text).toBe("ONLINE");
		expect(any.children[1]?.attrs).toEqual({ list: "us_mccs" });
		expect(defined(policy?.children.at(-1)).text).toBe("FULL & more");
	});

	it("survives stray and missing end tags", () => {
		const [a] = parsePolicyXml("<a><b></c><d>x</a>");
		expect(a?.children.map((n) => n.tag)).toEqual(["b"]);
		expect(a?.children[0]?.children[0]).toMatchObject({ tag: "d", text: "x" });
	});
});

describe("band_combos_per_plmn.xml", () => {
	const carriers = parseBandCombos(combosXml);

	it("pairs each PLMN list with its carrier tag", () => {
		expect(carriers.map((c) => [c.tag, c.plmns.length, c.combos.length])).toEqual([
			["ATT", 5, 459],
			["TMO", 15, 693],
			["VZW", 12, 652],
			["KDDI-LEGACY", 1, 25],
			["KDDI", 1, 60],
			["US_CELLULAR", 3, 173],
			["SOFTBANK", 1, 146],
			["UNICOM_CN", 2, 63],
			["CMCC", 4, 57],
			["CHINATELECOM_CN", 1, 61],
			["CBN_CN", 1, 57],
		]);
		expect(carriers[0]?.plmns).toEqual(["310-150", "310-280", "310-380", "310-410", "313-100"]);
	});

	it("parses component tokens", () => {
		expect(parseCombo("b1A[4]-b3A[4]A[1]-b41A[4]-n41A[4:30]A[1:30]").components).toEqual([
			{ rat: "lte", band: 1, dl: "A[4]" },
			{ rat: "lte", band: 3, dl: "A[4]", ul: "A[1]" },
			{ rat: "lte", band: 41, dl: "A[4]" },
			{ rat: "nr", band: 41, dl: "A[4:30]", ul: "A[1:30]" },
		]);
		expect(parseCombo("n66AA-n258HH-n258G-dc")).toMatchObject({ nrdc: true, swul: false });
		expect(parseCombo("n2AA-n5A-n66A-n77AA-n77A-swul")).toMatchObject({
			type: "nr",
			nrdc: false,
			swul: true,
		});
		expect([parseCombo("b66A-n77A").type, parseCombo("b2A").type, parseCombo("junk").type]).toEqual([
			"endc",
			"lte",
			undefined,
		]);
		expect(bandList([2, 66], "lte")).toBe("B2 B66");
		expect(bandList([77], "nr")).toBe("n77");
	});

	it("summarises each carrier", () => {
		expect(comboStats(defined(carriers[0]?.combos))).toEqual({
			combos: 459,
			endc: 206,
			nr: 253,
			lte: 0,
			nrdc: 26,
			swul: 43,
			maxComponents: 5,
			nrBands: [2, 5, 66, 77, 258, 260],
			singleBands: [1, 3, 7, 8, 12, 14, 20, 25, 26, 28, 29, 30, 38, 40, 41, 48, 53, 70, 71, 78, 79],
			fr1Bands: [2, 5, 66, 77],
			fr2Bands: [258, 260],
			lteAnchors: [2, 5, 12, 14, 29, 30, 66],
			sulBands: [],
		});
		const kddi = comboStats(defined(carriers[3]?.combos));
		expect([kddi.endc, kddi.nr, kddi.lteAnchors]).toEqual([25, 0, [1, 3, 11, 18, 41, 42]]);
	});

	it("counts only bands a carrier combines, not the single-band list every tag ends with", () => {
		const cu = comboStats(defined(carriers.find((c) => c.tag === "UNICOM_CN")).combos);
		expect(cu.nrBands).toEqual([1, 8, 78]);
		expect(cu.singleBands).toContain(66);
		// Intra-band CA on one band (class C and up) is a combination.
		expect(comboStats(["n78CA", "n1AA"]).nrBands).toEqual([78]);
		expect(comboStats(["n78CA", "n1AA"]).singleBands).toEqual([1]);
	});
});
