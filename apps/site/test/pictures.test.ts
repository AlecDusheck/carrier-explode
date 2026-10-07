import { describe, expect, it } from "vitest";
import { pictureOf } from "../src/lib/server/pictures.ts";

const att = {
	id: "ATT_NR_US",
	name: "AT&T",
	members: [
		"ios:carrier:ATT_aio_NR_US",
		"ios:carrier:ATT_aio_US",
		"ios:carrier:ATT_NR_US",
		"ios:carrier:ATT_US",
		"android:carrier:att_us",
	],
} as const;

describe("pictureOf", () => {
	it("pictures an Apple source by its own bundle, not the first member's", () => {
		expect(pictureOf({ platform: "ios", kind: "carrier", name: "ATT_US" }, att, "us")).toEqual({
			kind: "logo",
			slug: "att",
		});
		expect(pictureOf({ platform: "ios", kind: "carrier", name: "ATT_aio_US" }, att, "us")).toEqual({
			kind: "logo",
			slug: "cricket",
		});
	});

	it("pictures an Android source by the carrier's primary bundle", () => {
		expect(pictureOf({ platform: "android", kind: "carrier", name: "att_us" }, att, "us")).toEqual({
			kind: "logo",
			slug: "att",
		});
	});

	it("pictures a country bundle by its flag, and a source no carrier links by its name", () => {
		expect(pictureOf({ platform: "ios", kind: "country", name: "UnitedStates" }, null, "us")).toEqual({
			kind: "flag",
			cc: "us",
		});
		expect(pictureOf({ platform: "ios", kind: "carrier", name: "New_xx" }, null, null)).toEqual({
			kind: "initials",
			brand: "New_xx",
		});
	});
});
