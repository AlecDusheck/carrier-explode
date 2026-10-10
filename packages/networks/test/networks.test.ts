import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { networkCarrier, tradeWords, type Carrier } from "../src/index.ts";

/**
 * Real AS organisations from the site's traffic (October 2026), each with the carrier it is, or null for a host, VPN or
 * network none of its country's carriers is; and those of the index's carriers each must be told from. Google Fiber
 * and SFR are known to be wrong: Google Fi and SFR's MVNO LPM.
 */
interface Fixture {
	readonly carriers: ReadonlyArray<readonly [string, string, string]>;
	readonly cases: ReadonlyArray<readonly [string, string, string | null]>;
}
const fixture: Fixture = JSON.parse(readFileSync(new URL("fixtures/networks.json", import.meta.url), "utf8"));
const carriers: Carrier[] = fixture.carriers.map(([id, name, iso]) => ({ id, name, iso }));
/** As tradeWords finds them in the whole carrier list (2,055 carriers, October 2026). */
const TRADE = new Set(["mobile", "telecom", "wireless"]);

describe("networkCarrier", () => {
	for (const [org, cc, id] of fixture.cases)
		it(`${org} (${cc}) -> ${id}`, () => {
			expect(networkCarrier(org, carriers, cc, TRADE)?.id ?? null).toBe(id);
		});

	it("needs an organisation and a country", () => {
		expect(networkCarrier(null, carriers, "us", TRADE)).toBeNull();
		expect(networkCarrier("Verizon Business", carriers, null, TRADE)).toBeNull();
	});
});

describe("tradeWords", () => {
	it("finds the words many names share but few start with, not a brand that starts many", () => {
		const names = ["Boost", "Cox", "Union", "Pine", "Chat", "Viaero", "Nex-Tech", "Leaco"].map(
			(b) => `${b} Wireless`,
		);
		const brand = [
			"Orange B",
			"Orange F",
			"Orange LU",
			"Orange Mali",
			"Orange RCA",
			"Orange SL",
			"Orange JO",
			"F-Orange",
		];
		const list = [...names, ...brand].map((name, i) => ({ id: String(i), name, iso: null }));
		expect([...tradeWords(list)]).toEqual(["wireless"]);
	});
});
