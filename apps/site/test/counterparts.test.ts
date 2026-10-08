import { describe, expect, it } from "vitest";
import type { SourceKey } from "@carrier-explode/schema/types";
import { counterparts, suggestedFirst, suggestions } from "../src/lib/counterparts.ts";

const keyed = (keys: readonly SourceKey[]): Array<{ key: SourceKey }> => keys.map((key) => ({ key }));

/** As the server gives them: each platform's primary first. */
const att = keyed([
	"ios:carrier:ATT_US",
	"android:carrier:att_us",
	"ios:carrier:ATT_NR_US",
	"ipados:carrier:ATT_US",
	"samsung:carrier:ATT",
]);

describe("counterparts", () => {
	it("lists the other platforms in the site's order, then the source's own, leaving it out", () => {
		expect(counterparts("ios:carrier:ATT_US", att)).toEqual([
			{ platform: "android", members: keyed(["android:carrier:att_us"]) },
			{ platform: "samsung", members: keyed(["samsung:carrier:ATT"]) },
			{ platform: "ipados", members: keyed(["ipados:carrier:ATT_US"]) },
			{ platform: "ios", members: keyed(["ios:carrier:ATT_NR_US"]) },
		]);
	});

	it("keeps the given order within a platform", () => {
		expect(counterparts("samsung:carrier:ATT", att)[0]).toEqual({
			platform: "ios",
			members: keyed(["ios:carrier:ATT_US", "ios:carrier:ATT_NR_US"]),
		});
	});

	it("is empty for a source alone in its carrier, or with none", () => {
		expect(counterparts("samsung:carrier:TMB", keyed(["samsung:carrier:TMB"]))).toEqual([]);
		expect(counterparts("samsung:carrier:TMB", [])).toEqual([]);
	});
});

describe("suggestions", () => {
	it("offers one source a platform, other platforms only, at most two", () => {
		expect(suggestions("samsung:carrier:ATT", att)).toEqual(["ios:carrier:ATT_US", "android:carrier:att_us"]);
		expect(suggestions("ios:carrier:ATT_US", att)).toEqual(["android:carrier:att_us", "samsung:carrier:ATT"]);
	});

	it("offers nothing when the carrier is on no other platform", () => {
		expect(suggestions("ios:carrier:ATT_US", keyed(["ios:carrier:ATT_US", "ios:carrier:ATT_NR_US"]))).toEqual(
			[],
		);
	});
});

describe("suggestedFirst", () => {
	it("moves the suggestions to the top in their order, listing each once", () => {
		expect(suggestedFirst(att, ["samsung:carrier:ATT", "android:carrier:att_us"]).map((i) => i.key)).toEqual([
			"samsung:carrier:ATT",
			"android:carrier:att_us",
			"ios:carrier:ATT_US",
			"ios:carrier:ATT_NR_US",
			"ipados:carrier:ATT_US",
		]);
	});
});
