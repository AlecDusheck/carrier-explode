// A Pixel's record joining its build's rows (../src/records.ts withPart).

import { describe, expect, it } from "vitest";

import type { ReleaseRows } from "@carrier-explode/db";
import { withPart } from "../src/records.ts";

const order = (a: string, b: string): number =>
	["frankel", "rango", "tokay"].indexOf(a) - ["frankel", "rango", "tokay"].indexOf(b);

const part = (device: string, firmware: string, configs: Record<string, string>): ReleaseRows => ({
	release: {
		platform: "android",
		id: "B",
		version: "17",
		patch: "2026-09",
		released: null,
		devices: [device],
		sourceCount: 1,
		sortKey: "k",
	},
	modems: [{ name: firmware, family: "shannon", devices: [device], package: null, size: null, kind: null }],
	configs: Object.entries(configs).map(([label, sha]) => ({ device, label, sha })),
});

describe("a Pixel's record joining its build", () => {
	const frankel = part("frankel", "g1", { att: "a", tmo: "t" });

	it("is the build's rows when it is the first", () => {
		expect(withPart(undefined, frankel, "frankel", order)).toEqual(frankel);
	});

	it("adds its device to the build and to a firmware it shares, keeping one row per configuration", () => {
		const both = withPart(frankel, part("rango", "g1", { att: "a", tmo: "t" }), "rango", order);
		expect(both.release.devices).toEqual(["frankel", "rango"]);
		expect(both.modems).toEqual([{ ...frankel.modems[0], devices: ["frankel", "rango"] }]);
		expect(both.configs.map((c) => [c.device, c.sha])).toEqual([
			["frankel", "a"],
			["frankel", "t"],
			["rango", "a"],
			["rango", "t"],
		]);
	});

	it("keeps the other devices' firmware and adds its own", () => {
		const both = withPart(frankel, part("tokay", "g2", { att: "b" }), "tokay", order);
		expect(both.modems.map((m) => [m.name, m.devices])).toEqual([
			["g1", ["frankel"]],
			["g2", ["tokay"]],
		]);
		expect(both.configs.map((c) => c.sha)).toEqual(["a", "t", "b"]);
	});

	it("replaces its own device's rows when indexed again, dropping a firmware it alone had", () => {
		const both = withPart(frankel, part("tokay", "g2", { att: "b" }), "tokay", order);
		const again = withPart(both, part("tokay", "g3", { att: "c" }), "tokay", order);
		expect(again.modems.map((m) => m.name)).toEqual(["g1", "g3"]);
		expect(again.configs.map((c) => c.sha)).toEqual(["a", "t", "c"]);
	});

	it("keeps a firmware carrying different configurations on another device its own modem", () => {
		const both = withPart(frankel, part("rango", "g1", { att: "x", tmo: "t" }), "rango", order);
		expect(both.modems.map((m) => [m.name, m.devices])).toEqual([
			["g1", ["frankel"]],
			["g1", ["rango"]],
		]);
		const third = withPart(both, part("tokay", "g1", { att: "x", tmo: "t" }), "tokay", order);
		expect(third.modems.map((m) => m.devices)).toEqual([["frankel"], ["rango", "tokay"]]);
	});

	it("refuses a record that disagrees on the build", () => {
		const other = part("rango", "g1", { att: "a", tmo: "t" });
		expect(() =>
			withPart(frankel, { ...other, release: { ...other.release, version: "16" } }, "rango", order),
		).toThrow(/disagrees/);
	});
});
