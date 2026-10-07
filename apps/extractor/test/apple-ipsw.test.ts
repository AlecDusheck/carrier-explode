// Merging a bundle's copies from several IPSWs (../src/apple/ipsw.ts).

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { packIpcc, type UnpackedBundle } from "@carrier-explode/decode-ios";
import { mergeCopies } from "../src/apple/ipsw.ts";

const enc = new TextEncoder();
const file = (path: string, text: string): { path: string; bytes: Uint8Array } => ({
	path,
	bytes: enc.encode(text),
});
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Each copy, read when the merge asks for it. */
const reads = (...copies: UnpackedBundle[]): Array<() => Promise<UnpackedBundle>> =>
	copies.map((c) => () => Promise.resolve(c));

describe("mergeCopies", () => {
	const base: UnpackedBundle = {
		name: "T",
		files: [
			file("carrier.plist", "A"),
			file("overrides_N1.plist", "1"),
			file("signatures/overrides_N1.plist", "s1"),
		],
	};

	it("takes the union of the copies' override files", async () => {
		const other: UnpackedBundle = {
			name: "T",
			files: [
				file("carrier.plist", "A"),
				file("overrides_N2.plist", "2"),
				file("signatures/overrides_N2.plist", "s2"),
			],
		};
		expect((await mergeCopies(reads(base, other))).files.map((f) => f.path)).toEqual([
			"carrier.plist",
			"overrides_N1.plist",
			"overrides_N2.plist",
			"signatures/overrides_N1.plist",
			"signatures/overrides_N2.plist",
		]);
	});

	it("fails on a file that differs, naming the bundle, the path and both hashes", async () => {
		const other: UnpackedBundle = { name: "T", files: [file("carrier.plist", "B")] };
		await expect(mergeCopies(reads(base, other))).rejects.toThrow(
			`T.bundle/carrier.plist differs between IPSWs: sha256 ${sha(enc.encode("A"))} vs ${sha(enc.encode("B"))}`,
		);
	});

	it("fails on any other file that only some copies have", async () => {
		const other: UnpackedBundle = { name: "T", files: [...base.files, file("ERI.plist", "e")] };
		await expect(mergeCopies(reads(base, other))).rejects.toThrow(
			`T.bundle/ERI.plist (sha256 ${sha(enc.encode("e"))}) is missing from IPSW 1 of 2`,
		);
	});

	it("packs to the same bytes as a copy that already had every file", async () => {
		const full: UnpackedBundle = { name: "T", files: [...base.files, file("overrides_N2.plist", "2")] };
		expect(sha(packIpcc(await mergeCopies(reads(base, full))))).toBe(sha(packIpcc(full)));
	});

	it("refuses copies of different bundles", async () => {
		await expect(mergeCopies(reads(base, { ...base, name: "U" }))).rejects.toThrow(/merging U/);
	});
});
