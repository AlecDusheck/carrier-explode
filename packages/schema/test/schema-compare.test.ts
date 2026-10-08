import { describe, expect, it } from "vitest";

import {
	compareProfiles,
	PROFILE_SCHEMA,
	type Apn,
	type ConceptValue,
	type Json,
	type Profile,
	type SourceRef,
} from "../src/index.ts";

function profile(
	source: SourceRef,
	concepts: Record<string, ConceptValue>,
	apns: Apn[],
	raw: Profile["raw"] = {},
): Profile {
	return {
		schema: PROFILE_SCHEMA,
		source,
		sha: "x",
		identity: { iso: [], sims: [] },
		apns,
		concepts,
		raw,
		variants: [],
	};
}

const value = (v: Json, fidelity: "exact" | "approx" = "exact"): ConceptValue => ({
	kind: "value",
	value: v,
	because: [],
	fidelity,
});
const on: ConceptValue = { kind: "state", state: "on", because: [], fidelity: "exact" };
const IOS: SourceRef = { platform: "ios", kind: "carrier", name: "Test_US" };
const ANDROID: SourceRef = { platform: "android", kind: "carrier", name: "test_us" };

describe("compareProfiles", () => {
	const a = profile(
		IOS,
		{
			volte: on,
			"mms-max-size": value(1048576),
			"audio-codecs": value(["AMR-WB", "EVS"]),
			"wifi-calling-name": value("Test Wi-Fi"),
			"sip-timer-t1": { kind: "unset" },
			"sip-timer-t2": value(16000),
		},
		[
			{
				apn: "fast.example",
				types: ["default", "mms"],
				protocol: "ipv6",
				path: "carrier.plist:apns[0]",
			},
			{ apn: "ims", types: ["ims"], protocol: "ipv6", path: "carrier.plist:apns[1]" },
		],
	);
	const b = profile(
		ANDROID,
		{
			volte: on,
			"mms-max-size": value(614400),
			"audio-codecs": value(["AMR-WB", "EVS"], "approx"),
			"sip-timer-t1": { kind: "unset" },
			"sip-timer-t2": { kind: "unset" },
			"video-calling": { kind: "state", state: "no", because: [], fidelity: "exact" },
		},
		[
			{
				apn: "FAST.example",
				label: "Internet",
				types: ["mms", "default"],
				protocol: "ipv4v6",
				mtu: 1440,
				path: "apns[0]",
			},
			{
				apn: "ims",
				types: ["ims", "xcap"],
				protocol: "ipv6",
				auth: "chap",
				path: "apns[1]",
			},
			{ apn: "sos", types: ["emergency"], path: "apns[2]" },
		],
	);
	const c = compareProfiles(a, b);
	const status = (id: string): string | undefined =>
		c.groups.flatMap((g) => g.rows).find((r) => r.id === id)?.status;

	it("groups concept rows in registry order; fidelity does not make equal readings differ", () => {
		expect(c.sameFamily).toBe(false);
		expect(c.groups.map((g) => g.group)).toEqual(["features", "voice", "wifi-calling", "messaging"]);
		expect(status("volte")).toBe("same");
		expect(status("audio-codecs")).toBe("same");
		expect(status("mms-max-size")).toBe("different");
		expect(status("wifi-calling-name")).toBe("only-a");
		expect(status("video-calling")).toBe("only-b");
	});

	it("matches a concept only when both sides set the same reading", () => {
		expect(status("sip-timer-t1")).toBeUndefined();
		expect(status("sip-timer-t2")).toBe("different");
	});

	it("matches APNs by name and types, then by name; a field one platform cannot state is no difference, one side leaving it unset is", () => {
		expect(
			c.apns.map((r) =>
				r.status === "matched" ? [r.apn, r.status, r.sameTypes, r.differs] : [r.apn, r.status],
			),
		).toEqual([
			["fast.example", "matched", true, ["protocol"]],
			["ims", "matched", false, ["types", "auth"]],
			["sos", "only-b"],
		]);
	});

	it("diffs raw leaves within one decoder family only", () => {
		expect("raw" in c).toBe(false);
		const older = profile(IOS, {}, [], { "carrier.plist:A": 1, "carrier.plist:B": true });
		const newer = profile({ ...IOS, platform: "ipados" }, {}, [], {
			"carrier.plist:A": 2,
			"carrier.plist:B": true,
			"carrier.plist:C": "x",
		});
		const same = compareProfiles(older, newer);
		expect(same.sameFamily && same.raw).toEqual([
			{ path: "carrier.plist:A", status: "changed", a: 1, b: 2 },
			{ path: "carrier.plist:C", status: "only-b", b: "x" },
		]);
	});
});
