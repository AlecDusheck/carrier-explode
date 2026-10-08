import { describe, expect, it } from "vitest";

import { galaxyPhones } from "../src/galaxy/phones.ts";
import { fusVersion } from "../src/galaxy/plan.ts";
import { salesCodesToAsk } from "../src/galaxy/sales-codes.ts";
import { SCOPE } from "./scope.ts";

const csv = (...rows: string[]): string =>
	["Retail Branding,Marketing Name,Device,Model", ...rows, ""].join("\r\n");

describe("Google Play's device list", () => {
	it("reads every regional Samsung model on a scoped family, by name, never by codename", () => {
		const phones = galaxyPhones(
			csv(
				'"Samsung","Galaxy S26","m1q","SM-S942U"',
				'"Samsung","Galaxy S26","m1q","SM-S942U1"',
				'"Samsung","Galaxy S26","m1s","SM-S942B"',
				'"Samsung","Galaxy S10 5G","beyondx","SM-G977U"',
				'"Samsung","Galaxy S25 FE","r12s","SM-S731U"',
				'"Samsung","Galaxy Z Flip","bloomq","SM-F700U"',
				'"Samsung","Galaxy Z Flip8","b8q","SM-F776U1"',
				'"Samsung","Galaxy Z Fold8","q8q","SM-F971U"',
				'"Google","Pixel 10","frankel","SM-S942U"',
			),
			SCOPE.samsung,
		);
		expect(phones).toEqual([
			{ model: "SM-S942U", line: { family: "Galaxy S", generation: 26 } },
			{ model: "SM-S942U1", line: { family: "Galaxy S", generation: 26 } },
			{ model: "SM-S942B", line: { family: "Galaxy S", generation: 26 } },
			{ model: "SM-G977U", line: { family: "Galaxy S", generation: 10 } },
			{ model: "SM-F776U1", line: { family: "Galaxy Z Flip", generation: 8 } },
		]);
	});

	it("refuses a list whose layout changed", () => {
		expect(() => galaxyPhones("Brand,Name\r\n", SCOPE.samsung)).toThrow(/header/);
		expect(() => galaxyPhones(csv("Samsung,Galaxy S26,m1q,SM-S942U"), SCOPE.samsung)).toThrow(/quoted/);
	});
});

describe("version.xml", () => {
	it("completes version.xml's PDA/CSC/PHONE to what BinaryInform asks for", () => {
		expect(fusVersion("S931BXXS8BZC1/S931BOXM8BZC1/S931BXXS8BZB5")).toBe(
			"S931BXXS8BZC1/S931BOXM8BZC1/S931BXXS8BZB5/S931BXXS8BZC1",
		);
		expect(fusVersion("X200XXU1AYA1/X200OXM1AYA1/")).toBe(
			"X200XXU1AYA1/X200OXM1AYA1/X200XXU1AYA1/X200XXU1AYA1",
		);
		expect(fusVersion("nonsense")).toBeUndefined();
	});
});

describe("sales codes", () => {
	const codes = ["EUX", "INS", "ZTO", "PEO", "KOO", "ATT"];

	it("asks every code before any answer", () => {
		expect(salesCodesToAsk(codes, {}, "2026-10-07")).toEqual(codes);
	});

	it("asks each package under its first code, and a refusal again only after 30 days", () => {
		const answers = {
			EUX: { package: "OXM" },
			INS: { package: "OXM" },
			ZTO: { package: "OWO" },
			PEO: { package: "OWB" },
			KOO: { refused: "2026-09-08" },
			ATT: { refused: "2026-09-07" },
		};
		expect(salesCodesToAsk(codes, answers, "2026-10-07")).toEqual(["EUX", "ZTO", "PEO", "ATT"]);
	});

	it("asks a package's next code once its first refuses", () => {
		const answers = { EUX: { refused: "2026-10-07" }, INS: { package: "OXM" } };
		expect(salesCodesToAsk(["EUX", "INS"], answers, "2026-10-07")).toEqual(["INS"]);
	});
});
