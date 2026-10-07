import { describe, it, expect } from "vitest";
import { comboPart } from "../src/lib/combos.ts";
import { plainJson, versionTag } from "../src/lib/format.ts";
import { rareSection } from "../src/lib/platforms.ts";
import { RARITY } from "@carrier-explode/schema";
import { trainVersions } from "../src/lib/android/naming.ts";
import { NAMING } from "../src/lib/naming.ts";
import { defaultNote } from "../src/lib/feature-pages.ts";

describe("plainJson", () => {
	it("matches JSON.stringify for plain values", () => {
		const v = { a: [1, "x", null, { b: true }], c: {}, d: [], e: undefined, f: 'q"' };
		expect(plainJson(v)).toBe(JSON.stringify(v));
		expect(plainJson([undefined])).toBe("[null]");
	});

	it("writes big integers bare and UIDs as UID(n)", () => {
		expect(plainJson({ n: { __int: "18446744073709551615" }, u: { __uid: 3 } })).toBe(
			'{"n":18446744073709551615,"u":UID(3)}',
		);
	});

	it("falls back to String for values JSON cannot write", () => {
		expect(plainJson(undefined)).toBe("undefined");
	});
});

describe("versionTag", () => {
	it("never calls a beta the current release, even as the line's head", () => {
		expect(versionTag({ slug: "73.0", beta: true }, "73.0")).toBe("beta");
	});

	it("calls the head release current, and other releases nothing", () => {
		expect(versionTag({ slug: "72.1", beta: false }, "72.1")).toBe("current release");
		expect(versionTag({ slug: "72.0", beta: false }, "72.1")).toBeNull();
	});
});

describe("rareSection", () => {
	it("calls rows a few others share rare, not unique, with the sharers bound from RARITY", () => {
		expect(rareSection("apple", 4)).toEqual({
			legend: "Rare settings (4)",
			note: `carrier.plist settings at most ${RARITY.maxSharers} other bundles share.`,
		});
	});
});

describe("comboPart", () => {
	it("writes a component with its uplink class", () => {
		expect(comboPart({ rat: "lte", band: 66, dl: "A", ul: "A" })).toBe("B66A↑A");
		expect(comboPart({ rat: "nr", band: 77, dl: "C", ul: "A" }, false)).toBe("n77C");
	});
});

const entryLabel = ({
	platform,
	...e
}: {
	platform: keyof typeof NAMING;
	images: string[];
	ota: readonly string[];
	version: string;
}): string => NAMING[platform].label(e);

describe("version labels", () => {
	const ios = { ota: [] } as const;

	it("writes a run of one release's betas once", () => {
		expect(
			entryLabel({ ...ios, platform: "ios", images: ["27.2 beta", "27.2 beta 2"], version: "72.7.2" }),
		).toBe("iOS 27.2 beta 1–2 image · build 72.7.2");
		expect(entryLabel({ ...ios, platform: "ios", images: ["26.6", "26.6.2"], version: "70.0.1" })).toBe(
			"iOS 26.6 – 26.6.2 image · build 70.0.1",
		);
	});

	it("names the OTA copy and the OS it is published for", () => {
		expect(entryLabel({ platform: "ipados", images: [], ota: ["26.2", "27.0"], version: "62.1" })).toBe(
			"OTA iPadOS 26.2+ · build 62.1",
		);
		expect(entryLabel({ ...ios, platform: "ios", images: ["27.0"], ota: ["27.0"], version: "61.0" })).toBe(
			"iOS 27.0 image + OTA iOS 27.0+ · build 61.0",
		);
	});

	it("names an Android file by its newest release", () => {
		expect(entryLabel({ platform: "android", images: ["15", "16"], ota: [], version: "79000000034" })).toBe(
			"Android 16 · version 79000000034",
		);
	});

	it("names a Pixel OTA file by the Android version of its train's builds", () => {
		// rogers5g_ca 79000000015: an OTA file listed for CP3A, whose indexed build CP3A.260905.009 is Android 17.
		const os = trainVersions([
			{ id: "CP3A.260905.009", version: "17" },
			{ id: "BP4A.251205.006", version: "16" },
		]);
		expect([...os]).toEqual([
			["CP3A", "17"],
			["BP4A", "16"],
		]);
		const ota = ["CP3A"].map((t) => os.get(t) ?? t);
		expect(entryLabel({ platform: "android", images: [], ota, version: "79000000015" })).toBe(
			"OTA Android 17 · version 79000000015",
		);
		expect(NAMING.android.icon({ images: [], ota, version: "79000000015" })).toBe("17");
	});
});

describe("defaultNote", () => {
	it("badges a state only when the layer decided all of it", () => {
		expect(defaultNote({ layer: "aosp", part: "all" })).toMatchObject({
			kind: "badge",
			label: "Android default",
		});
		expect(defaultNote({ layer: "aosp", part: "rest" }).kind).toBe("hint");
		expect(defaultNote({ layer: "imsservice", part: "rest" }).kind).toBe("hint");
	});
});
