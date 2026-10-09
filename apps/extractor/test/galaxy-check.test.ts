import { describe, expect, it } from "vitest";

import { galaxyPhones } from "../src/galaxy/phones.ts";
import { fusVersion, oldestMonth } from "../src/galaxy/plan.ts";
import {
	LaunchBound,
	mayLaunchSince,
	newestGenerationFirst,
	NO_PROBES,
	salesCodesToAsk,
} from "../src/galaxy/sales-codes.ts";
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

describe("a model's launch", () => {
	it("is dated by its oldest build whose month decodes", () => {
		expect(oldestMonth(["S942BOXM4BZIG", "S942BOXM1AZAQ", "S942BOXM1AZMQ"], "2026-10-07")).toBe("2026-01");
		expect(oldestMonth([], "2026-10-07")).toBeUndefined();
	});

	it("rules a model out for good once a build predates the scope", () => {
		expect(mayLaunchSince(NO_PROBES, "2025-01")).toBe(true);
		expect(mayLaunchSince({ oldest: "2025-01", answers: {} }, "2025-01")).toBe(true);
		expect(mayLaunchSince({ oldest: "2024-02", answers: {} }, "2025-01")).toBe(false);
	});
});

const a = (generation: number) => ({ line: { family: "Galaxy A3", generation } });
const s = (generation: number) => ({ line: { family: "Galaxy S", generation } });

describe("a family's launch bound", () => {
	it("rules out a generation seen older than the scope and every earlier one of its family, no other family", () => {
		const bound = new LaunchBound("2025-01");
		expect(bound.seen(a(36), { oldest: "2025-03", answers: {} })).toBe(true);
		expect(bound.seen(a(35), { oldest: "2024-03", answers: {} })).toBe(false);
		expect([a(36), a(35), a(30), a(3), s(24)].map((m) => bound.open(m))).toEqual([
			true,
			false,
			false,
			false,
			true,
		]);
	});

	it("orders newest generation first", () => {
		expect([a(30), a(37), a(35)].toSorted(newestGenerationFirst).map((m) => m.line.generation)).toEqual([
			37, 35, 30,
		]);
	});
});
