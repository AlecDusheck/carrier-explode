import { describe, expect, it } from "vitest";
import { selectionRows } from "../src/lib/settings.ts";

const plmn = (key: string, match: string) => ({ via: "MCC-MNC", key, match });

describe("selection rows", () => {
	it("lists each rule once with its MCC-MNCs, leaving out GID rules on an MCC-MNC any SIM selects by", () => {
		const rules = [
			plmn("310200", "GID1 544D"),
			plmn("310160", "any SIM"),
			plmn("310160", "GID1 544D"),
			plmn("310200", "any SIM"),
			plmn("311490", "GID1 6D38"),
			plmn("00101", "any SIM"),
		];
		expect(selectionRows(rules)).toEqual([
			{ via: "MCC-MNC", match: "any SIM", keys: ["310160", "310200"] },
			{ via: "MCC-MNC", match: "GID1 6D38", keys: ["311490"] },
			{ via: "MCC-MNC", match: "test networks", keys: ["00101"] },
		]);
	});
});
