import { describe, expect, it } from "vitest";
import { readConfigValue } from "@carrier-explode/decode-android";
import { androidDocs } from "../src/lib/android/tree-docs.ts";
import { configView } from "../src/lib/components/android/config/views.ts";
import { modemView } from "../src/lib/components/values/registry.ts";
import HandoverRules from "../src/lib/components/android/config/HandoverRules.svelte";

const HANDOVER = "iwlan_handover_policy_string_array";
const docs = androidDocs({ [HANDOVER]: { note: "", constant: "KEY_IWLAN_HANDOVER_POLICY_STRING_ARRAY" } });

describe("a value tree's reading of Android config keys", () => {
	it("reads a documented key with a format", () => {
		expect(docs.read(HANDOVER, HANDOVER, ["source=IWLAN, target=EUTRAN, type=allowed"])).toMatchObject({
			kind: "decoded",
			decoded: { format: "handover-rules" },
		});
	});

	it("marks a key nothing documents as not understood", () => {
		expect(docs.read("vendor_magic_int", "vendor_magic_int", 3)).toMatchObject({ kind: "not-understood" });
	});

	it("reads only top-level keys", () => {
		expect(docs.read(HANDOVER, `bundle.${HANDOVER}`, [])).toBeNull();
	});
});

describe("the view registry", () => {
	it("loads the view for a decoded format", async () => {
		const decoded = readConfigValue(HANDOVER, ["source=IWLAN, target=EUTRAN, type=allowed"]);
		if (decoded?.kind !== "decoded") throw new Error("did not decode");
		const { View, props } = await configView(decoded.decoded);
		expect(View).toBe(HandoverRules);
		expect(props.value).toBe(decoded.decoded.value);
	});

	it("leaves a modem item without a view to its decoded value", () => {
		expect(
			modemView(
				{
					id: "nv:1",
					name: null,
					description: null,
					value: { kind: "number", value: 1 },
					label: null,
					certainty: "opaque",
				},
				[],
			),
		).toBeNull();
	});
});
