// Apple's OTA manifest as file records (../src/apple/ota-manifest.ts).

import { describe, expect, it } from "vitest";

import type { OtaListing } from "@carrier-explode/schema/types";
import {
	type Entry,
	listedDigest,
	mergeDigests,
	scopedEntries,
	updateListings,
} from "../src/apple/ota-manifest.ts";
import type { Scope } from "../src/scope.ts";
import { SCOPE } from "./scope.ts";

const ALL: Scope["appleOta"] = { ios: "all", ipados: "all", watchos: "all" };
const scope = (appleOta: Partial<Scope["appleOta"]>): Scope => ({
	...SCOPE,
	appleOta: { ...ALL, ...appleOta },
});
const phones = (majors: number): Partial<Scope["appleOta"]> => ({
	ios: { majors, phones: ["iPhone18,1"] },
	ipados: "none",
	watchos: "none",
});

const entry = (
	url: string,
	source: Entry["listing"]["source"],
	os: string | null,
	model?: string,
): Entry => ({
	url,
	version: "1",
	digests: {},
	listing: { source, os, ...(model === undefined ? {} : { model }) },
});

const ENTRIES = [
	entry("a", "ios:carrier:A", "27.0"),
	entry("b", "ios:carrier:A", "26.4"),
	entry("c", "ios:carrier:B", "27.0", "iPhone7,1"),
	entry("d", "ios:carrier:B", "27.0", "iPhone18,1"),
	entry("e", "ipados:carrier:A", "27.0"),
	entry("f", "watchos:carrier:W", "Watch 4"),
	entry("g", "ios:carrier:A", "legacy"),
	entry("h", "ios:country:US", "27.0.1"),
];

describe("scopedEntries", () => {
	it("keeps every entry for a scope that fetches all", () => {
		expect(scopedEntries(scope({}), ENTRIES)).toEqual(ENTRIES);
	});

	it("keeps, for iPadOS and watchOS, each source's file for the newest OS it is listed for, never a prerelease's", () => {
		const tablets = [
			entry("i1", "ipados:carrier:A", "17.5"),
			entry("i2", "ipados:carrier:A", "26.5"),
			entry("i3", "ipados:carrier:A", "27.1 beta 2"),
			entry("i4", "ipados:carrier:B", "18.4"),
			entry("w1", "watchos:carrier:W", "Watch 3"),
			entry("w2", "watchos:carrier:W", "Watch 4"),
			entry("w3", "watchos:country:US", "26.4"),
			entry("w4", "watchos:country:US", "26.5"),
		];
		const kept = scopedEntries(scope({ ios: "none", ipados: "current", watchos: "current" }), [
			...ENTRIES,
			...tablets,
		]).map((e) => e.url);
		// iPadOS: A's 27.0 file (not its older ones, nor its beta's), and B's only. watchOS: each source's newest, both Watch 4 files of W.
		expect(kept).toEqual(["e", "f", "i4", "w2", "w4"]);
	});

	it("keeps iPhone entries for its phones on the newest majors", () => {
		expect(scopedEntries(scope(phones(1)), ENTRIES).map((e) => e.url)).toEqual(["a", "d", "h"]);
		expect(scopedEntries(scope(phones(2)), ENTRIES).map((e) => e.url)).toEqual(["a", "b", "d", "h"]);
	});
});

describe("mergeDigests", () => {
	it("fills one listing's digests from another's", () => {
		expect(mergeDigests("u", { sha1: "1" }, { sha384: "3" }, {})).toEqual({ sha1: "1", sha384: "3" });
	});

	it("refuses two different digests for one file", () => {
		expect(() => mergeDigests("u", { sha1: "1" }, { sha1: "2" })).toThrow(
			"u: the manifest gives two sha1 digests",
		);
	});
});

const seen = (source: OtaListing["source"], os: string, firstSeenAt: string, live: boolean): OtaListing => ({
	source,
	os,
	firstSeenAt,
	lastSeenAt: firstSeenAt,
	live,
});

describe("updateListings", () => {
	it("keeps a listing the manifest dropped, no longer live, and adds a new one", () => {
		const previous = [seen("ios:carrier:A", "27.0", "t0", true), seen("ios:carrier:A", "26.4", "t0", true)];
		expect(
			updateListings(
				previous,
				[
					{ source: "ios:carrier:A", os: "27.0" },
					{ source: "ios:carrier:A", os: "27.1" },
				],
				"t1",
			),
		).toEqual([
			{ source: "ios:carrier:A", os: "27.0", firstSeenAt: "t0", lastSeenAt: "t1", live: true },
			{ source: "ios:carrier:A", os: "26.4", firstSeenAt: "t0", lastSeenAt: "t0", live: false },
			{ source: "ios:carrier:A", os: "27.1", firstSeenAt: "t1", lastSeenAt: "t1", live: true },
		]);
	});
});

describe("listedDigest", () => {
	it("is the set of listings, whatever their order or repeats", () => {
		const a = { source: "ios:carrier:A", os: "27.0" } as const;
		const b = { source: "ios:carrier:A", os: "27.0", model: "iPhone18,1" } as const;
		expect(listedDigest([a, b])).toBe(listedDigest([b, a, b]));
		expect(listedDigest([a])).not.toBe(listedDigest([b]));
	});
});
