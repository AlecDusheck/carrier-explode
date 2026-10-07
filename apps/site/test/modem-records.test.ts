import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as v from "valibot";
import { basebandSummary, MODEM_SUMMARY_SCHEMA } from "@carrier-explode/decode-ios";
import { modemSummary } from "../src/lib/server/apple/modem-records.ts";

/** decode-ios owns the Apple container fixtures; decode-qualcomm the modem image cut. */
const fx = (name: string) =>
	new Uint8Array(
		readFileSync(join(import.meta.dirname, "../../../packages/decode-ios/test/fixtures/bbfw", name)),
	);
const qc = (name: string) =>
	new Uint8Array(
		readFileSync(join(import.meta.dirname, "../../../packages/decode-qualcomm/test/fixtures/mav25", name)),
	);

describe("modemSummary", () => {
	it("reads back what the decoder writes, unchanged", () => {
		const s = basebandSummary(
			{
				"bbcfg.mbn": fx("bbcfg-cut.mbn"),
				"pt.mbn": fx("pt-cut.mbn"),
				"qdsp6sw.mbn": qc("modem-configs.bin"),
			},
			{ name: "Mav25-2.10.01.Release.bbfw" },
		);
		const stored: unknown = JSON.parse(JSON.stringify(s));
		expect(v.parse(modemSummary, stored)).toEqual(stored);
	});

	it("reads an ftab summary", () => {
		const stored = {
			schema: MODEM_SUMMARY_SCHEMA,
			kind: "ftab",
			package: { name: "ftab.bin", family: "C1" },
			entries: [{ tag: "bver", offset: 48, size: 9 }],
		};
		expect(v.parse(modemSummary, stored)).toEqual(stored);
	});

	it("refuses another schema version", () => {
		expect(
			v.safeParse(modemSummary, { schema: MODEM_SUMMARY_SCHEMA + 1, kind: "ftab", package: {}, entries: [] })
				.success,
		).toBe(false);
	});
});
