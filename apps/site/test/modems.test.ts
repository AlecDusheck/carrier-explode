import { describe, it, expect } from "vitest";
import { overrideBoards } from "@carrier-explode/decode-ios";
import { knowsPhone, overridesFor, type PhoneFile } from "../src/lib/apple/phones.ts";
import { withPhones } from "./fixtures/devices.ts";

const pri = (path: string): PhoneFile =>
	withPhones({ path, size: 1, kind: "pri-der", boards: overrideBoards(path) ?? [] });

describe("a version's own files for a phone", () => {
	const files = [pri("overrides_D93_D94_D47_D48.der.pri"), pri("overrides_V63_V64s_V68.der.pri")];

	it("finds the phone's file by the boards in its name", () => {
		expect(overridesFor(files, "iPhone19,2").map((f) => f.path)).toEqual(["overrides_V63_V64s_V68.der.pri"]);
	});

	it("knows a phone the version names a newer model than, so no file means none", () => {
		expect(overridesFor(files, "iPhone15,2")).toEqual([]);
		expect(knowsPhone(files, "iPhone15,2")).toBe(true);
	});

	it("does not know a phone newer than every file it names", () => {
		expect(knowsPhone([pri("overrides_D93_D94_D47_D48.der.pri")], "iPhone19,2")).toBe(false);
	});
});
