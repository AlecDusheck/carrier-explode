import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { openIpcc, decodeFile, decodedPlist } from "../src/bundle.ts";
import {
	FIELDS,
	ATTACH_APN_TYPE,
	IKE_DH_GROUP,
	IMS_SERVICE_BITS,
	DATA_MODE_BITS,
	describeField,
	describeValue,
} from "../src/fields.ts";
import { maskBits } from "@carrier-explode/binary";
import { describeMessageId } from "../src/cbs.ts";
import { array, defined, record } from "./defined.ts";

const here = dirname(fileURLToPath(import.meta.url));
const labelsOf = (...a: Parameters<typeof describeValue>) => describeValue(...a)?.map((l) => l.label);
const fixture = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", n)));

const plistOf = (bundle: string, file: string) => {
	const b = openIpcc(fixture(bundle));
	return record(decodedPlist(decodeFile(b, file)));
};

describe("describeValue on real bundles", () => {
	it("decodes ATT_US APN type-masks", () => {
		const carrier = plistOf("carrier-att.ipcc", "carrier.plist");
		const masks = array(carrier.apns).map((a) => record(a)["type-mask"]);
		expect(masks).toEqual(expect.arrayContaining([32775, 16, 32774]));
		expect(labelsOf("type-mask", 16)).toEqual(["WirelessModemTraffic (Personal Hotspot data)"]);
		expect(labelsOf("type-mask", 32775)).toEqual([
			"Internet",
			"VVM (visual voicemail)",
			"MMS",
			"EntitlementTraffic",
		]);
		expect(labelsOf("type-mask", record(carrier.OTAActivationAPN)["type-mask"])).toEqual(["OTAActivation"]);
	});

	it("decodes ATT_US override APNs (IMS, SOS, full default APN = 0x108007)", () => {
		const b = openIpcc(fixture("carrier-att.ipcc"));
		const f = defined(b.info.files.find((x) => /^overrides_.*\.plist$/.test(x.path)));
		const apns = array(record(decodedPlist(decodeFile(b, f.path))).apns).map(record);
		const byName = Object.fromEntries(apns.map((a) => [a.apn, a]));
		expect(labelsOf("type-mask", byName.ims["type-mask"])).toEqual(["IMS"]);
		expect(labelsOf("type-mask", byName.sos["type-mask"])).toEqual(["Emergency"]);
		expect(labelsOf("tech-type-mask", 1081351)).toEqual([
			"Internet",
			"VVM (visual voicemail)",
			"MMS",
			"EntitlementTraffic",
			"UT (XCAP / Ut supplementary services)",
		]);
	});

	it("decodes MTU technology-mask and entitlement bits", () => {
		const carrier = plistOf("carrier-att.ipcc", "carrier.plist");
		const mtu = record(array(carrier.MTU)[0]);
		expect(labelsOf("technology-mask", mtu["technology-mask"])).toEqual(["UMTS (GSM/UMTS, 3GPP)", "LTE"]);
		expect(labelsOf("technology-mask", 32)).toEqual(["bit 5"]);
		const ent = record(carrier.CarrierEntitlements).SupportedEntitlements;
		expect(ent).toBe(12173);
		expect(labelsOf("SupportedEntitlements", ent)).toEqual([
			"bit 0",
			"facetime",
			"tethering",
			"VoWiFi",
			"iCloudVoWiFi (Wi-Fi calling on other devices)",
			"bit 9",
			"Multi-SIM (Watch number sharing)",
			"sa-watch (standalone Watch plan)",
			"iphone-plan-transfer",
		]);
	});

	it("decodes Verizon technology-masks, entitlements and FallbackMethod", () => {
		const carrier = plistOf("carrier-verizon.ipcc", "carrier.plist");
		const mtu = array(carrier.MTU).map((m) => record(m)["technology-mask"]);
		expect(mtu).toEqual(expect.arrayContaining([12, 2]));
		expect(labelsOf("technology-mask", 12)).toEqual(["eHRPD", "LTE"]);
		expect(labelsOf("technology-mask", 14)).toEqual(["CDMA 1x", "eHRPD", "LTE"]);
		expect(labelsOf("technology-mask", 28)).toEqual(["eHRPD", "LTE", "NR (5G)"]);
		expect(labelsOf("FallbackMethod", carrier.FallbackMethod)).toEqual(["CDMA 1x"]);
		expect(labelsOf("SupportedEntitlements", 4238745)).toEqual([
			"bit 0",
			"tethering",
			"bit 4",
			"VoWiFi",
			"iCloudVoWiFi (Wi-Fi calling on other devices)",
			"Multi-SIM (Watch number sharing)",
			"sa-watch (standalone Watch plan)",
			"iphone-plan-transfer",
			"5g-service",
			"rcs",
		]);
	});

	it("decodes IPv6SupportedDataModeMask as bit n = DataMode n+1", () => {
		const d = FIELDS.IPv6SupportedDataModeMask;
		expect(d?.default).toBe(0x1b01c);
		expect(d?.confidence).toBe("med");
		expect(d?.bits).toBe(DATA_MODE_BITS);
		expect(labelsOf("IPv6SupportedDataModeMask", 0x1b01c)).toEqual([
			"WCDMA",
			"HSDPA",
			"HSUPA",
			"eHRPD",
			"LTE",
			"NR NSA",
			"NR SA",
		]);
		// values bundles set
		expect(labelsOf("IPv6SupportedDataModeMask", 57372)).toEqual([
			"WCDMA",
			"HSDPA",
			"HSUPA",
			"LTE",
			"EV-DO RevB",
			"NR NSA",
		]);
		expect(labelsOf("IPv6SupportedDataModeMask", 106527)).toEqual([
			"GPRS",
			"EDGE",
			"WCDMA",
			"HSDPA",
			"HSUPA",
			"LTE",
			"NR NSA",
			"NR SA",
		]);
		for (const b of [5, 6, 7, 8]) expect(DATA_MODE_BITS[b], `bit ${b}`).toBeUndefined();
	});

	it("decodes TechSettings masks and enums from a real bundle", () => {
		const carrier = plistOf("watch-redpocket.ipcc", "carrier.plist");
		const ts = record(carrier.TechSettings);
		expect(labelsOf("5wiServiceMask", ts["5wiServiceMask"])).toEqual(["Internet", "VVM (visual voicemail)"]);
		expect(labelsOf("5wiServiceMask", 1)).toEqual(["Internet"]);
		expect(FIELDS.IMSServiceMask?.bits).toBe(IMS_SERVICE_BITS);
		expect(labelsOf("IMSServiceMask", 2, "IMSConfig.Satellite.IMSServiceMask")).toEqual(["SMS"]);
		expect(labelsOf("IMSServiceMask", 3)).toEqual(["Voice", "SMS"]);
		expect(labelsOf("DHGroup", 2)).toEqual(["1024-bit MODP"]);
		for (const g of [1, 2, 5, 14, 15, 16, 18, 21]) expect(IKE_DH_GROUP[g], `group ${g}`).toBeTruthy();
		expect(labelsOf("AllowedPdpTypeMask", 3)).toEqual(["IPv4v6 (dual stack)"]);
	});

	it("reads AllowedProtocolMask as an enum, not bits", () => {
		expect(FIELDS.AllowedProtocolMask?.format).toBe("enum");
		expect(labelsOf("AllowedProtocolMask", 3)).toEqual(["IPv4v6 (dual stack)"]);
		expect(labelsOf("AllowedProtocolMaskInRoamingLTE", 2)).toEqual(["IPv6"]);
		expect(labelsOf("AllowedProtocolMask", 9)).toEqual([]);
	});

	it("labels string enums and message IDs", () => {
		expect(labelsOf("DataIndicatorOverrideForNRMmwave", "NRUWB")).toEqual(["5G UW"]);
		expect(defined(labelsOf("DataIndicatorOverrideForEvo", "5GE"))[0]).toMatch(/^5GE/);
		expect(
			["NRPlus", "NRUWB", "NRUC", "NRCA"].every(
				(v) => defined(labelsOf("DataIndicatorOverrideForNRMmwave", v)).length === 1,
			),
		).toBe(true);
		expect(labelsOf("DataIndicatorOverrideForLTE", "LTE")).toEqual(["LTE"]);
		expect(labelsOf("DataIndicatorOverride", "4G")).toEqual(["4G"]);
		expect(labelsOf("FromServiceID", 4379)).toEqual(["Child abduction (AMBER)"]);
		expect(labelsOf("DHGroup", 14)).toEqual(["2048-bit MODP"]);
		expect(labelsOf("CarrierName", "AT&T")).toBeUndefined();
		expect(labelsOf("no-such-key", 1)).toBeUndefined();
	});
});

describe("high bits", () => {
	it("decodes InternetSlice bits 28-35 exactly", () => {
		const v = 2 ** 28 + 2 ** 31 + 2 ** 32 + 2 ** 35;
		expect(maskBits(v)).toEqual([28, 31, 32, 35]);
		expect(labelsOf("type-mask", v)).toEqual([
			"InternetSlice1",
			"InternetSlice4",
			"InternetSlice5",
			"InternetSlice8",
		]);
		expect(labelsOf("type-mask", 1n << 34n)).toEqual(["InternetSlice7"]);
		expect(labelsOf("type-mask", 2 ** 36)).toEqual(["bit 36"]);
		expect(describeValue("type-mask", 2 ** 36 + 1)).toEqual([
			{ label: "Internet", named: true, bit: 0 },
			{ label: "bit 36", named: false, bit: 36 },
		]);
	});

	it("stays exact up to 2^53 and reads negatives as 64-bit", () => {
		expect(maskBits(2 ** 52 + 1)).toEqual([0, 52]);
		expect(maskBits(-1)).toHaveLength(64);
		expect(maskBits(0)).toEqual([]);
		expect(maskBits(1.5)).toEqual([]);
	});
});

describe("parent-dependent keys", () => {
	it("resolves Type by its nearest known ancestor", () => {
		expect(describeField("Type", "AttachAPN.3GPP")?.values).toBe(ATTACH_APN_TYPE);
		expect(labelsOf("Type", 3, ["AttachAPN", "3GPP"])).toEqual(["WiFiCalling"]);
		expect(
			defined(
				labelsOf("Type", "Non3GPP", "apns[0].configuration[1].NoCellularReconnectCauseCodes[0].Type"),
			)[0],
		).toMatch(/Wi-Fi/);
		expect(describeField("Type", "CarrierEntitlements/Authentication")?.confidence).toBe("low");
		expect(describeField("Type")).toBeUndefined();
		expect(describeField("Type", "Somewhere.Else")).toBeUndefined();
	});

	it("resolves Category and Identifier from a real bundle path", () => {
		expect(labelsOf("Category", 4097, "CellBroadcast.MessageIDParameters3GPP2[0]")).toEqual([
			"Extreme threat",
		]);
		expect(labelsOf("Category", 6, "EmergencyCalling.EmergencyNumbers[2]")).toEqual([
			"Ambulance",
			"Fire Brigade",
		]);
		expect(labelsOf("Identifier", 16386, "TechSettings.ExtraConfigurationAttributeRequestv6[0]")).toEqual([
			"Private use",
		]);
		expect(labelsOf("Identifier", 21, ["TechSettings", "ExtraConfigurationAttributeRequestv4[]"])).toEqual([
			"P_CSCF_IP6_ADDRESS",
		]);
	});

	it("falls back to the plain entry for ordinary keys", () => {
		expect(describeField("type-mask", "apns[0]")).toBe(FIELDS["type-mask"]);
	});
});

describe("field formats", () => {
	it("reads set bits and message ids", () => {
		expect(maskBits(32768)).toEqual([15]);
		expect(maskBits(9)).toEqual([0, 3]);
		expect(maskBits(2 ** 35 + 1)).toEqual([0, 35]);
		expect(describeMessageId(4382)).toMatch(/Operator-defined/);
		expect(describeMessageId(4352)).toMatch(/ETWS/);
		expect(describeMessageId(1)).toBeUndefined();
	});
});

describe("IMSConfig keys resolve through the IMS registry", () => {
	const imsOf = (bundle: string) => record(plistOf(bundle, "carrier.plist").IMSConfig);

	it("types, defaults and enum values under real ATT_RedPocket paths", () => {
		const sig = record(imsOf("watch-redpocket.ipcc").Signaling);
		expect(sig.AccessBarringType).toBe("ACB");
		const abt = defined(describeField("AccessBarringType", "IMSConfig.Signaling.AccessBarringType"));
		expect(abt.format).toBe("enum");
		expect(abt.default).toBe("SSAC");
		expect(
			labelsOf("AccessBarringType", sig.AccessBarringType, "IMSConfig.Signaling.AccessBarringType"),
		).toEqual(["ACB"]);
		expect(labelsOf("AccessBarringType", "Bogus", "IMSConfig.Signaling")).toEqual([]);
		expect(labelsOf("Preconditions", sig.Preconditions, "IMSConfig.Signaling")).toEqual(["Supported"]);
		expect(
			labelsOf("CountryOfOriginationFormat", sig.CountryOfOriginationFormat, "IMSConfig.Signaling"),
		).toEqual(["BOTH"]);
		expect(labelsOf("EmergencyPreferredIdentity", "IMSI", "IMSConfig.Signaling")).toEqual(["IMSI (default)"]);
		expect(labelsOf("AccessNetworkRefreshMethod", "", "IMSConfig.Signaling")).toEqual([
			"empty (off) (default)",
		]);

		const ring = defined(describeField("RingingTimerSeconds", "IMSConfig.Signaling.RingingTimerSeconds"));
		expect(ring).toMatchObject({ type: "integer", default: 40, unit: "s" });
		expect(ring.confidence).toBeUndefined();
		expect(defined(describeField("UseIPSec", "IMSConfig.Signaling")).type).toBe("boolean");
		expect(defined(describeField("AccessNetworkRefreshDelayMilliseconds", "IMSConfig.Signaling")).unit).toBe(
			"ms",
		);
	});

	it("SipTimers keys only resolve under SipTimers", () => {
		const timers = record(record(imsOf("watch-redpocket.ipcc").Signaling).SipTimers);
		expect(Object.keys(timers)).toEqual(expect.arrayContaining(["B", "D", "InviteResponseTimeout"]));
		expect(describeField("D", "IMSConfig.Signaling.SipTimers.D")).toMatchObject({
			type: "integer",
			default: 128000,
			unit: "ms",
		});
		expect(defined(describeField("InviteResponseTimeout", "IMSConfig.Signaling.SipTimers")).default).toBe(
			10000,
		);
		expect(describeField("B", "IMSConfig.Signaling.B")).toBeUndefined();
		expect(describeField("B", "Somewhere.B")).toBeUndefined();
		expect(describeField("T1")).toBeUndefined();
	});

	it("follows overlays, MVNO overrides and legacy names", () => {
		expect(defined(describeField("UseIPSec", "IMSConfigSecondaryOverlay.Signaling.UseIPSec")).type).toBe(
			"boolean",
		);
		expect(
			describeField(
				"SessionExpiresSeconds",
				"MVNOOverrides.Configuration_1.OverrideConfiguration.IMSConfig.Signaling",
			),
		).toBeTruthy();
		expect(defined(describeField("EnableAPOnlyMode", "InitialSetupOverrides.Media.VoiceOnAP")).default).toBe(
			true,
		);
		const legacy = defined(describeField("RingbackTimer", "IMSConfig.Signaling.RingbackTimer"));
		expect(legacy.note).toMatch(/^Legacy name of RingbackTimerSeconds\./);
		expect(defined(describeField("SipTimerT1", "IMSConfig.Signaling.SipTimers")).default).toBe(2000);
	});

	it("keys outside the registry section fall back to FIELDS", () => {
		const cw = imsOf("carrier-cw-wi.ipcc");
		expect(record(cw.SIM).IgnoreISIM).toBe(true);
		expect(describeField("IgnoreISIM", "IMSConfig.SIM.IgnoreISIM")).toBe(FIELDS.IgnoreISIM);
		expect(FIELDS.IgnoreISIM?.default).toBe(false);
		expect(defined(describeField("SIM", "IMSConfig.SIM")).note).toMatch(/impiFormat/);
		const us = imsOf("country-us.ipcc");
		expect(record(us.Voice).EnableVolteByDefault).toBe(true);
		expect(describeField("EnableVolteByDefault", "IMSConfig.Voice")).toBe(FIELDS.EnableVolteByDefault);
		expect(
			defined(describeField("SuppressDisclosingSuspiciousUndetectedEmergency", "IMSConfig.Voice")).default,
		).toBe(false);
		expect(defined(describeField("BlockSilentRedialOverCS", "IMSConfig.Voice")).default).toBe(false);
	});

	it("documents call end-reason entries and their TerminationEvent", () => {
		const sig = record(imsOf("watch-redpocket.ipcc").Signaling);
		const inc = record(sig.IncomingCallEndReasons);
		expect(inc.TemporarilyUnavailable).toEqual({ StatusCode: 480, TerminationEvent: "RemoteHangup" });
		expect(
			defined(
				describeField(
					"TemporarilyUnavailable",
					"IMSConfig.Signaling.IncomingCallEndReasons.TemporarilyUnavailable",
				),
			).note,
		).toMatch(/SIP 480, event TemporarilyUnavailable/);
		expect(defined(describeField("NotFound", "IMSConfig.Signaling.IncomingCallEndReasons")).note).toMatch(
			/Carrier-defined/,
		);
		expect(defined(describeField("RejectedByUser", "IMSConfig.Signaling.CallEndReasons")).note).toMatch(
			/SIP 486, event LocalHangup, Reason "Call Rejected By User"/,
		);
		const p = "IMSConfig.Signaling.IncomingCallEndReasons.TemporarilyUnavailable.TerminationEvent";
		expect(labelsOf("TerminationEvent", record(inc.TemporarilyUnavailable).TerminationEvent, p)).toEqual([
			"ReasonCode 1",
		]);
		expect(labelsOf("TerminationEvent", "CallAudioServiceCrash", p)).toEqual(["ReasonCode 38"]);
		expect(defined(describeField("StatusCode", p.replace("TerminationEvent", "StatusCode"))).type).toBe(
			"integer",
		);
	});

	it("without a path, FIELDS wins and IMS-only keys still resolve", () => {
		expect(describeField("Preconditions")).toBe(FIELDS.Preconditions);
		expect(defined(describeField("AccessBarringType")).default).toBe("SSAC");
		expect(describeField("NoSuchImsKey")).toBeUndefined();
	});
});
