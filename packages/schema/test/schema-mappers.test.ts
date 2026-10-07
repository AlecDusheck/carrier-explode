import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";

import { openIpcc } from "@carrier-explode/decode-ios";
import type { CarrierList, CarrierSettings } from "@carrier-explode/decode-android";
import {
	androidProfile,
	carrierListRoutes,
	iosProfile,
	type ConceptValue,
	type Profile,
} from "../src/index.ts";
import { parseSupportedSim } from "../src/ios/identity.ts";
import { normaliseGid } from "../src/sims.ts";
import { aospConfig, fileConfig, layered } from "../src/android/config.ts";
import { androidConcepts } from "../src/android/readers.ts";

function plistNode(x: unknown): string {
	if (typeof x === "boolean") return x ? "<true/>" : "<false/>";
	if (typeof x === "number") return `<integer>${x}</integer>`;
	if (typeof x === "string") return `<string>${x.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string>`;
	if (Array.isArray(x)) return `<array>${x.map(plistNode).join("")}</array>`;
	if (typeof x === "object" && x !== null)
		return `<dict>${Object.entries(x)
			.map(([k, y]) => `<key>${k}</key>${plistNode(y)}`)
			.join("")}</dict>`;
	throw new Error(`cannot encode ${String(x)}`);
}

/** A minimal XML plist writer: enough for dicts, arrays, strings, integers and booleans. */
function plist(v: unknown): string {
	return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0">${plistNode(v)}</plist>`;
}

function bundle(name: string, files: Record<string, unknown>): ReturnType<typeof openIpcc> {
	const enc = new TextEncoder();
	const zip = zipSync(
		Object.fromEntries(
			Object.entries(files).map(([p, v]) => [`Payload/${name}.bundle/${p}`, enc.encode(plist(v))]),
		),
	);
	return openIpcc(zip);
}

/** A reading's state or value; "unset" and undefined as such. */
function value(p: Profile, id: string): unknown {
	const r: ConceptValue | undefined = p.concepts[id];
	if (r === undefined) return undefined;
	return r.kind === "unset" ? "unset" : r.kind === "state" ? r.state : r.value;
}
const because = (p: Profile, id: string): string[] => {
	const r = p.concepts[id];
	return r === undefined || r.kind === "unset" ? [] : r.because.map((b) => b.path);
};

describe("iosProfile", () => {
	const b = bundle("Test_US", {
		"Info.plist": { CFBundleVersion: "72.1" },
		"carrier.plist": {
			CarrierName: "Test",
			SupportedSIMs: ["310410_GID1-FFFF", "310260_GID1-6d", "20404_GID2-1A_ID-891480"],
			IMSConfig: {
				Voice: { EnableVolteByDefault: true },
				Signaling: { RingingTimerSeconds: 45, SipTimers: { T1: 500 }, UseIPSec: true },
				Media: { AudioCodecs: { 104: { EncodingName: "AMR-WB" }, 109: { EncodingName: "EVS" } } },
			},
			MMS: { MaxMessageSize: 1048576, MMSC: "http://mmsc.example", Proxy: "proxy.example:8080" },
			CDMA: {
				"SIP Password": "766E6574",
				"MIP MN-HA Shared Secret": "Default:00",
				"Enable Password Encryption": true,
			},
			apns: [
				{
					"technology-mask": 24,
					configuration: [
						{ apn: "internet", "type-mask": 5, AllowedProtocolMask: 3, username: "", password: "pw" },
					],
				},
			],
			AttachAPN: { "3GPP": { apn: "ims", AllowedProtocolMask: 2 } },
			MVNOOverrides: {
				Configuration_1: {
					SupportedSIMs: ["310410_GID1-42"],
					OverrideConfiguration: {
						CarrierName: "Mvno",
						IMSConfig: { Voice: { EnableVolteByDefault: false } },
					},
				},
				Configuration_2: {
					SupportedSIMs: ["310410_GID1-43"],
					OverrideConfiguration: { RCS: { ShowRCSSwitch: true } },
				},
			},
		},
		// iPhone 16 family: carries the 5G keys, as modern bundles do.
		"overrides_D93_D94_D47_D48.plist": {
			Enable5GAutoByDefault: true,
			IMSConfig: { Signaling: { RingingTimerSeconds: 60 } },
		},
	});
	const p = iosProfile(b, { platform: "ios", kind: "carrier", name: "Test_US" }, "sha");

	it("reads carrier.plist as the bundle's own settings, naming the file each value came from", () => {
		expect(value(p, "ringing-timer")).toBe(45000);
		expect(value(p, "sip-timer-t1")).toBe(500);
		expect(because(p, "sip-ipsec")).toEqual(["carrier.plist:IMSConfig.Signaling.UseIPSec"]);
	});

	it("keeps a board's override file as a variant: carrier.plist with the override on top, where it differs", () => {
		const phone = p.variants.find((v) => v.id === "phones:overrides_D93_D94_D47_D48.plist");
		expect(phone?.when).toEqual({ kind: "board", boards: ["D93", "D94", "D47", "D48"] });
		expect(phone?.concepts["5g"]).toMatchObject({
			kind: "state",
			state: "on",
			because: [{ path: "overrides_D93_D94_D47_D48.plist:Enable5GAutoByDefault" }],
		});
		// Merged dictionaries: the override's ringing timer wins, carrier.plist's other IMS keys stay.
		expect(phone?.concepts["ringing-timer"]).toMatchObject({ value: 60000 });
		expect(phone?.concepts["sip-timer-t1"]).toBeUndefined();
	});

	it("normalises codecs, MMS and APNs", () => {
		expect(value(p, "audio-codecs")).toEqual(["AMR-WB", "EVS"]);
		expect(value(p, "hd-voice-plus")).toBe("on");
		expect(value(p, "mms-proxy")).toBe("proxy.example:8080");
		expect(p.apns[0]).toMatchObject({
			apn: "internet",
			types: ["default", "mms"],
			protocol: "ipv4v6",
			bearers: ["lte", "nr"],
			mmsc: "http://mmsc.example",
			mmsProxy: "proxy.example",
			mmsPort: "8080",
			hasPassword: true,
			path: "carrier.plist:apns[0].configuration[0]",
		});
		expect(p.apns[1]).toMatchObject({ apn: "ims", types: ["ia"], protocol: "ipv6" });
		expect(value(p, "apn-attach")).toBe("ims");
	});

	it("reads an APN's services from tech-type-mask when it has no type-mask", () => {
		const tmus = bundle("TMobile_US", {
			"carrier.plist": { apns: [{ configuration: [{ apn: "tmus", "tech-type-mask": 1048582 }] }] },
		});
		const q = iosProfile(tmus, { platform: "ios", kind: "carrier", name: "TMobile_US" }, "sha");
		// Bits 1, 2 and 20: voicemail (no Android type), MMS and UT.
		expect(q.apns[0]?.types).toEqual(["mms", "xcap"]);
	});

	it("parses SupportedSIMs, an all-FF GID being no GID rule", () => {
		expect(p.identity.sims).toContainEqual({ mccmnc: "310410" });
		expect(p.identity.sims).toContainEqual({ mccmnc: "310260", gid1: "6D" });
		expect(p.identity.sims).toContainEqual({ mccmnc: "20404", gid2: "1A", iccidPrefix: "891480" });
		expect(p.identity.iso).toEqual(["us"]);
	});

	it("keeps MVNO configurations as variants holding only what differs", () => {
		const mvno = p.variants.find((v) => v.id === "mvno:Configuration_1");
		expect(mvno?.when).toEqual({ kind: "sim", sims: [{ mccmnc: "310410", gid1: "42" }] });
		expect(mvno?.concepts.volte).toMatchObject({ kind: "state", state: "no" });
		expect(mvno?.concepts["carrier-name"]).toMatchObject({
			because: [{ path: "carrier.plist:MVNOOverrides.Configuration_1.OverrideConfiguration.CarrierName" }],
		});
		expect(mvno?.concepts["sip-timer-t1"]).toBeUndefined();
	});

	it("calls a feature only an MVNO configuration offers available, naming that configuration's key", () => {
		expect(value(p, "rcs")).toBe("available");
		expect(because(p, "rcs")).toEqual([
			"carrier.plist:MVNOOverrides.Configuration_2.OverrideConfiguration.RCS.ShowRCSSwitch",
		]);
	});

	it("flattens every member into raw but credentials", () => {
		expect(p.raw["carrier.plist:CarrierName"]).toBe("Test");
		expect(p.raw["overrides_D93_D94_D47_D48.plist:Enable5GAutoByDefault"]).toBe(true);
		expect(p.raw["carrier.plist:CDMA.Enable Password Encryption"]).toBe(true);
		expect(Object.keys(p.raw).filter((k) => /(password|secret)$/i.test(k))).toEqual([]);
		expect(JSON.stringify([p.apns, p.variants])).not.toMatch(/"pw"|766E6574/);
	});
});

describe("iosProfile's phones", () => {
	const b = bundle("Test_US", {
		"carrier.plist": { CarrierName: "Test" },
		"overrides_N104_D79_ZZ9.plist": { Show5GSwitch: false },
		"overrides_D93_D94_D47_D48.plist": { Show5GSwitch: true },
	});
	const p = iosProfile(b, { platform: "ios", kind: "carrier", name: "Test_US" }, "sha");

	it("names each override file's phones by its boards alone: which phone a board is, is the device records' to say", () => {
		expect(p.variants.map((v) => v.when)).toEqual([
			{ kind: "board", boards: ["D93", "D94", "D47", "D48"] },
			{ kind: "board", boards: ["N104", "D79", "ZZ9"] },
		]);
		expect(p.variants[0]?.concepts["5g-switch"]).toMatchObject({
			because: [{ path: "overrides_D93_D94_D47_D48.plist:Show5GSwitch" }],
		});
	});
});

describe("SIM rule normalisation", () => {
	it("drops FF padding but keeps zeros", () => {
		expect(normaliseGid("0AFFFF")).toBe("0A");
		expect(normaliseGid("ffff")).toBeUndefined();
		expect(normaliseGid("BAE1000000000000")).toBe("BAE1000000000000");
	});
	it("rejects malformed SupportedSIMs entries", () => {
		expect(parseSupportedSim("310260_FOO-1")).toBeUndefined();
		expect(parseSupportedSim("31")).toBeUndefined();
	});
});

describe("androidProfile", () => {
	const cs: CarrierSettings = {
		canonicalName: "test_us",
		version: "79000000034",
		apns: [
			{
				name: "Internet",
				value: "Fast.Example",
				type: ["DEFAULT", "IA", "MMS"],
				protocol: "IPV6",
				authtype: 0,
				mtu: 1440,
				bearerBitmask: "14|20",
				mmsc: "http://mmsc.example",
				password: "secret",
			},
		],
		configs: {
			carrier_volte_available_bool: { kind: "bool", value: true },
			carrier_nr_availabilities_int_array: { kind: "int_array", value: [1] },
			"imsvoice.ringing_timer_millis_int": { kind: "int", value: 45000 },
			"imsvoice.audio_codec_capability_payload_types_bundle": {
				kind: "bundle",
				value: {
					"imsvoice.amrwb_payload_type_int_array": { kind: "int_array", value: [104] },
					"imsvoice.evs_payload_type_int_array": { kind: "int_array", value: [] },
				},
			},
			"5g_icon_configuration_string": { kind: "text", value: "connected_mmwave:5G_Plus,connected:5G" },
		},
		vendorConfigs: [{ name: "client", value: "AAE=" }],
		unknown: [{ path: "", field: 99, wire: "varint", value: "1" }],
	};
	const list: CarrierList = {
		entries: [
			{ canonicalName: "test_us", carrierIds: [{ mccMnc: "310410" }] },
			{ canonicalName: "other_us", carrierIds: [{ mccMnc: "311480" }] },
			{
				canonicalName: "test_us",
				carrierIds: [{ mccMnc: "310260", mvno: { kind: "gid1", value: "6DFF" } }, { mccMnc: "310410" }],
			},
		],
		unknown: [],
	};
	const p = androidProfile(cs, { platform: "android", kind: "carrier", name: "test_us" }, "sha");

	it("decides feature states from the file's own keys alone, leaving unset what a key it lacks would decide", () => {
		expect(p.concepts.volte).toEqual({ kind: "unset" });
		expect(p.concepts["wifi-calling"]).toEqual({ kind: "unset" });
		expect(value(p, "5g")).toBe("on");
		expect(because(p, "5g")).toEqual(["config:carrier_nr_availabilities_int_array"]);
		expect(value(p, "5g-standalone")).toBe("no");
		expect(value(p, "nr-modes")).toEqual(["NSA"]);
		expect(value(p, "hd-voice-plus")).toBe("no");
	});

	it("normalises values to the iOS units and spellings", () => {
		expect(value(p, "ringing-timer")).toBe(45000);
		expect(value(p, "audio-codecs")).toEqual(["AMR-WB"]);
		expect(value(p, "5g-icon-advanced")).toBe("5G+");
		expect(value(p, "apn-internet")).toBe("fast.example");
		expect(p.apns[0]).toMatchObject({
			types: ["default", "ia", "mms"],
			protocol: "ipv6",
			auth: "none",
			mtu: 1440,
			bearers: ["lte", "nr"],
			hasPassword: true,
			path: "apns[0]",
		});
		// Unset keys without a known default stay unset rather than guessed.
		expect(p.concepts["sip-timer-t1"]).toEqual({ kind: "unset" });
		// A concept Android cannot express has no reading at all.
		expect(p.concepts["wifi-calling-name"]).toBeUndefined();
	});

	it("routes SIMs from carrier_list, not from the file, so a profile is its file's bytes alone", () => {
		expect(carrierListRoutes(list)).toEqual({
			"android:carrier:test_us": [
				{ by: "plmn", sim: { mccmnc: "310410" } },
				{ by: "plmn", sim: { mccmnc: "310260", gid1: "6D" } },
			],
			"android:carrier:other_us": [{ by: "plmn", sim: { mccmnc: "311480" } }],
		});
		expect(p.identity.sims).toEqual([]);
	});

	it("keeps everything in raw", () => {
		expect(p.identity.iso).toEqual(["us"]);
		expect(
			p.raw[
				"config:imsvoice.audio_codec_capability_payload_types_bundle.imsvoice.amrwb_payload_type_int_array"
			],
		).toEqual([104]);
		expect(p.raw["apns[0].value"]).toBe("Fast.Example");
		expect(Object.keys(p.raw).some((k) => k.includes("password"))).toBe(false);
		expect(JSON.stringify(p)).not.toContain("secret");
		expect(p.raw["vendor:client"]).toBe("AAE=");
		expect(p.raw["unknown:#99"]).toBe("1");
		expect(p.variants).toEqual([]);
	});
});

describe("MMS proxy", () => {
	it("reads the same proxy the same on both platforms: HTTP's port 80 is the default either way", async () => {
		const { mmsProxyAddress } = await import("../src/values.ts");
		expect(mmsProxyAddress("Proxy.Mobile.ATT.net", "80")).toBe("proxy.mobile.att.net");
		expect(mmsProxyAddress("proxy.mobile.att.net", undefined)).toBe("proxy.mobile.att.net");
		expect(mmsProxyAddress("10.0.0.1", "8080")).toBe("10.0.0.1:8080");
	});
});

describe("the carrier's status-bar name", () => {
	const named = (images: ReadonlyArray<Record<string, string>>) =>
		iosProfile(
			bundle("TIM_br", { "carrier.plist": { StatusBarImages: images } }),
			{ platform: "ios", kind: "carrier", name: "TIM_br" },
			"sha",
		).identity.display;

	it("is the name most StatusBarImages entries show, not the first's", () => {
		// TIM_br 72.0: the network's TIM shows as VIVO in one entry, TIM in three.
		expect(
			named([
				{ CarrierName: "TIM", StatusBarCarrierName: "VIVO" },
				{ CarrierName: "TIM BRAZIL", StatusBarCarrierName: "TIM" },
				{ CarrierName: "TIM BRAZIL ", StatusBarCarrierName: "TIM" },
				{ CarrierName: "TIM", StatusBarCarrierName: "TIM" },
			]),
		).toBe("TIM");
	});

	it("goes to the earlier entry on a tie, and is absent without one", () => {
		expect(named([{ StatusBarCarrierName: "A" }, { StatusBarCarrierName: "B" }])).toBe("A");
		expect(named([])).toBeUndefined();
	});
});

describe("AOSP's CarrierConfig defaults", () => {
	it("read a literal default from decode-android's generated table, and a computed one as AOSP's sDefaults build it", () => {
		expect(aospConfig("enhanced_4g_lte_on_by_default_bool")?.value).toBe(true);
		expect(aospConfig("carrier_volte_available_bool")).toEqual({
			value: false,
			ref: { path: "aosp:carrier_volte_available_bool", value: false },
		});
		expect(aospConfig("carrier_nr_availabilities_int_array")?.value).toEqual([1, 2]);
		expect(aospConfig("no_such_key_bool")).toBeUndefined();
	});

	it("leave a key AOSP defaults to null unset, so a reader falls through rather than reading an empty value", () => {
		expect(aospConfig("non_roaming_operator_string_array")).toBeUndefined();
		expect(aospConfig("gsm_nonroaming_networks_string_array")).toBeUndefined();
		const read = androidConcepts({ config: layered(fileConfig({}), aospConfig), apns: [] });
		expect(read["home-networks"]).toEqual({ kind: "unset" });
	});
});
