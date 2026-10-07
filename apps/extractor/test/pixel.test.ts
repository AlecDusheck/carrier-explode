// A Pixel's CarrierSettings directory read into sources, and an update answer set merged into a file's listings.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { PixelOtaListing } from "@carrier-explode/schema/types";
import { permanent } from "../src/errors.ts";
import { listedFiles, mergeListings } from "../src/pixel/ota.ts";
import { othersParts, PixelError, settingsFile } from "../src/pixel/settings.ts";

const fixture = (name: string): Uint8Array =>
	new Uint8Array(
		readFileSync(
			join(
				import.meta.dirname,
				"../../../packages/firmware/test/fixtures/android/tree/etc/CarrierSettings",
				name,
			),
		),
	);

const varint = (n: number): number[] =>
	n < 0x80 ? [n] : [(n & 0x7f) | 0x80, ...varint(Math.floor(n / 128))];
const field = (key: number, b: readonly number[]): number[] => [key, ...varint(b.length), ...b];
const name = (s: string): number[] => field(0x0a, [...new TextEncoder().encode(s)]);
/** MultiCarrierSettings: version 42, then each part a CarrierSettings naming itself. */
const others = (...parts: string[]): Uint8Array =>
	Uint8Array.from([0x08, 42, ...parts.flatMap((p) => field(0x12, name(p)))]);

describe("CarrierSettings", () => {
	it("reads a file named after its carrier as that carrier's source, and refuses a misnamed one for good", () => {
		const f = settingsFile("spektrummso_us.pb", fixture("spektrummso_us.pb"));
		expect([f.source, f.version.length > 0]).toEqual([
			{ platform: "android", kind: "carrier", name: "spektrummso_us" },
			true,
		]);
		const misnamed = (): unknown => settingsFile("skylo_zz.pb", fixture("spektrummso_us.pb"));
		expect(misnamed).toThrow(PixelError);
		expect(permanent(new PixelError("x"))).toBe(true);
	});

	it("splits others.pb into sources at its version, leaving out a carrier with a file of its own", () => {
		const parts = othersParts(
			others("telenor_se", "zain_iq", "default"),
			new Set(["telenor_se.pb", "carrier_list.pb"]),
		);
		expect(parts.map((p) => [p.source.kind, p.source.name, p.version])).toEqual([
			["carrier", "zain_iq", "42"],
			["default", "default", "42"],
		]);
		expect(() => othersParts(others("zain_iq", "zain_iq"), new Set())).toThrow(/twice/);
	});
});

const file = (n: string, version: string): { name: string; version: string; url: string } => ({
	name: n,
	version,
	url: `https://ssl.gstatic.com/${n}-${version}.pb`,
});
const was = (device: string, train: string, live: boolean): PixelOtaListing => ({
	source: "android:carrier:tmobile_us",
	device,
	train,
	firstSeenAt: "t0",
	lastSeenAt: "t0",
	live,
});

describe("update listings", () => {
	const answers = [
		{
			device: "frankel",
			train: "CP3A",
			files: [file("carrier_list", "9"), file("tmobile_us", "5"), file("no_sim", "2")],
		},
		{ device: "rango", train: "CP3A", files: [file("tmobile_us", "5")] },
	];

	it("lists each CarrierSettings URL with every answer that names it, the carrier list left out", () => {
		const listed = listedFiles(answers);
		expect([...listed.keys()]).toEqual([file("tmobile_us", "5").url, file("no_sim", "2").url]);
		expect(listed.get(file("no_sim", "2").url)?.listings).toEqual([
			{ source: "android:default:no_sim", device: "frankel", train: "CP3A" },
		]);
		expect(() =>
			listedFiles([
				...answers,
				{ device: "x", train: "CP3A", files: [{ ...file("tmobile_us", "5"), version: "6" }] },
			]),
		).toThrow(PixelError);
	});

	it("adds new listings, marks asked ones that left, keeps unasked ones, and calls a new lastSeenAt alone no change", () => {
		const tmo = listedFiles(answers).get(file("tmobile_us", "5").url)?.listings ?? [];
		const first = mergeListings([], tmo, answers, "t1");
		expect([first.changed, first.listings.map((l) => [l.device, l.firstSeenAt, l.live])]).toEqual([
			true,
			[
				["frankel", "t1", true],
				["rango", "t1", true],
			],
		]);
		expect(mergeListings(first.listings, tmo, answers, "t2")).toMatchObject({
			changed: false,
			listings: [{ lastSeenAt: "t2" }, { lastSeenAt: "t2" }],
		});
		const gone = mergeListings(
			[was("frankel", "CP3A", true), was("rango", "BP2A", true)],
			tmo.slice(1),
			answers,
			"t3",
		);
		expect(gone.changed).toBe(true);
		expect(gone.listings.map((l) => [l.device, l.train, l.live, l.lastSeenAt])).toEqual([
			["frankel", "CP3A", false, "t0"],
			["rango", "BP2A", true, "t0"],
			["rango", "CP3A", true, "t3"],
		]);
	});
});
