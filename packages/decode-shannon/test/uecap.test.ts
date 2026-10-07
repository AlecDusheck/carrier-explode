/** Fixtures are real Pixel 9 (tokay) uecapconfig files cut to a few combinations (carrier index altered). */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Component, decodeUeCap, ShannonFormatError } from "../src/index.ts";
import { unpackPlmn } from "../src/plmn.ts";

const fixture = (name: string): Uint8Array => readFileSync(join(import.meta.dirname, "fixtures", name));

describe("unpackPlmn", () => {
	it("reads TS 24.008 packed PLMNs, with two- and three-digit MNCs and any-MNC", () => {
		expect(unpackPlmn(0x130062)).toEqual({ mcc: "310", mnc: "260" });
		expect(unpackPlmn(0x44f011)).toEqual({ mcc: "440", mnc: "11" });
		expect(unpackPlmn(0x13f2ff)).toEqual({ mcc: "312", mnc: null });
		expect(() => unpackPlmn(0x1a0062)).toThrow(ShannonFormatError);
	});
});

const label = (c: Component): string =>
	`${c.rat === "NR" ? "n" : ""}${c.band}${c.dlClass}${c.ulClass ? `+${c.ulClass}` : ""}`;

describe("decodeUeCap", () => {
	it("reads EN-DC and NR CA combinations with per-carrier features", () => {
		const f = decodeUeCap(fixture("uecap-combinations.pb"));
		if (f.kind !== "combinations") throw new Error(f.kind);
		expect(f.carrierIndex).toBe(9);
		expect(f.combinations.map((c) => c.map(label).join("-"))).toEqual([
			"n25A+A",
			"2A+A-n41A+A",
			"n41C+A",
			"n71B+A",
			"2A+A-n260H+G",
			"2A+A-n260G+G",
		]);
		expect(f.combinations[2]?.[0]).toEqual({
			rat: "NR",
			band: 41,
			dlClass: "C",
			ulClass: "A",
			dl: [
				{ scsKHz: 30, bandwidthMHz: 100, mimoLayers: 4 },
				{ scsKHz: 30, bandwidthMHz: 80, mimoLayers: 4 },
			],
			ul: [{ scsKHz: 30, bandwidthMHz: 100, mimoLayers: 2 }],
		});
		expect(f.combinations[4]?.[1]).toMatchObject({
			dl: Array.from({ length: 3 }, () => ({ scsKHz: 120, bandwidthMHz: 100, mimoLayers: 2 })),
		});
	});

	it("reads LTE CA combinations, the placeholder files and the PLMN map", () => {
		const lte = decodeUeCap(fixture("uecap-lte.pb"));
		if (lte.kind !== "lte-ca") throw new Error(lte.kind);
		expect(
			lte.combinations.map((c) =>
				c.map((x) => `${x.band}${x.dlClass}${x.dlMimoLayers}${x.ulClass ?? ""}`).join("-"),
			),
		).toEqual(["1A2-3A4A", "1A2-7A2A", "1A2-8A2A", "1C4A"]);
		expect(decodeUeCap(fixture("uecap-empty.pb"))).toEqual({
			kind: "combinations",
			carrierIndex: 0,
			combinations: [],
		});
		const map = decodeUeCap(fixture("uecap-plmn.pb"));
		if (map.kind !== "plmn-map") throw new Error(map.kind);
		expect(map.carriers.map((c) => [c.index, c.name, c.plmns.length])).toEqual([
			[1, "VZW", 12],
			[2, "TMO", 19],
			[3, "ATT", 21],
		]);
		expect(map.carriers[1]?.plmns[7]).toEqual({ mcc: "310", mnc: "260" });
	});
});
