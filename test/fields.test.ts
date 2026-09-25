import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { openIpcc, decodeFile } from "../src/lib/decode/bundle.ts";
import {
  FIELDS,
  CONTEXT_FIELDS,
  SERVICE_TYPES,
  RAT_BITS,
  PROTOCOL_FAMILY,
  ATTACH_APN_TYPE,
  BUNDLE_TYPE,
  ENTITLEMENT_CLASSES,
  IKE_DH_GROUP,
  IMS_SERVICE_BITS,
  DATA_MODE_BITS,
  SMS_FORKING_MECHANISM,
  BITMASK_KEYS,
  PLMN_KEYS,
  KEY_NOTES,
  decodeBits,
  maskBits,
  describeField,
  describeValue,
  describeMessageId,
  type FieldDoc,
} from "../src/lib/decode/fields.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", n)));

type Dict = Record<string, unknown>;
const plistOf = (bundle: string, file: string) => {
  const b = openIpcc(fixture(bundle));
  return decodeFile(b, file).plist as Dict;
};

const allDocs = (): Array<[string, FieldDoc]> => [
  ...Object.entries(FIELDS),
  ...Object.entries(CONTEXT_FIELDS).flatMap(([k, list]) => list.map((c) => [`${c.under}/${k}`, c.doc] as [string, FieldDoc])),
];

describe("field table shape", () => {
  it("every entry has a note, a valid confidence and non-empty tables", () => {
    for (const [key, d] of allDocs()) {
      expect(d.note.trim(), key).not.toBe("");
      if (d.confidence !== undefined) expect(["high", "med", "low"], key).toContain(d.confidence);
      if (d.bits) {
        expect(Object.keys(d.bits).length, key).toBeGreaterThan(0);
        for (const [b, label] of Object.entries(d.bits)) {
          expect(Number.isInteger(Number(b)) && Number(b) >= 0, `${key} bit ${b}`).toBe(true);
          expect(label, `${key} bit ${b}`).not.toBe("");
        }
      }
      if (d.values) {
        expect(Object.keys(d.values).length, key).toBeGreaterThan(0);
        for (const label of Object.values(d.values)) expect(label, key).not.toBe("");
      }
      if (d.format === "enum") expect(d.values, key).toBeTruthy();
      if (d.bits) expect(d.format, key).toBe("bitmask");
    }
  });

  it("shared tables have the expected extent", () => {
    expect(Object.keys(SERVICE_TYPES).map(Number)).toEqual([...Array(36).keys()]);
    expect(Object.keys(RAT_BITS)).toHaveLength(5);
    expect(PROTOCOL_FAMILY[3]).toMatch(/IPv4v6/);
    expect(Object.keys(ATTACH_APN_TYPE)).toHaveLength(6);
    expect(Object.keys(BUNDLE_TYPE)).toHaveLength(8);
  });

  it("the service-class keys share one table", () => {
    for (const k of ["type-mask", "tech-type-mask", "serviceMask", "IPCUApnTypemask", "AllowedServicesTypeMaskOnInternet", "IgnoresDeactivateOnNetworkScanServiceMask", "APNEditabilityTypemask", "5wiServiceMask"])
      expect(FIELDS[k].bits, k).toBe(SERVICE_TYPES);
    expect(FIELDS["technology-mask"].bits).toBe(RAT_BITS);
    expect(SERVICE_TYPES[12]).toBe("OMADM");
    expect(SERVICE_TYPES[13]).toBe("OTAInternet");
  });

  it("entitlement enum has named slots 2-22 with gaps at 4, 5 and 9", () => {
    const named = Object.keys(ENTITLEMENT_CLASSES).map(Number);
    expect(named).toEqual([2, 3, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    expect(ENTITLEMENT_CLASSES[12]).toBe("MultiSIM-transfer");
    expect(ENTITLEMENT_CLASSES[14]).toBe("sa-watch-transfer");
    expect(ENTITLEMENT_CLASSES[19]).toMatch(/satellite/);
    expect(FIELDS.SupportedEntitlements.confidence).toBeUndefined();
    expect(FIELDS.SupportedEntitlementsStandaloneMode.bits).toBe(ENTITLEMENT_CLASSES);
  });

  it("technology-mask bits are 1 UMTS, 2 CDMA, 4 eHRPD, 8 LTE, 16 NR", () => {
    expect([1, 2, 4, 8, 16].map((v) => describeValue("technology-mask", v)![0])).toEqual(["UMTS (GSM/UMTS, 3GPP)", "CDMA 1x", "eHRPD", "LTE", "NR (5G)"]);
    expect(FIELDS["technology-mask"].confidence).toBeUndefined();
  });

  it("drops unevidenced masks absent from the corpus", () => {
    for (const k of ["EntitlementServiceMask", "ServiceMask", "enabled-by-default-mask", "TRM RF Mask"]) expect(FIELDS[k], k).toBeUndefined();
  });
});

describe("describeValue on real bundles", () => {
  it("decodes ATT_US APN type-masks", () => {
    const carrier = plistOf("ATT_US.ipcc", "carrier.plist");
    const masks = (carrier.apns as Dict[]).map((a) => a["type-mask"]);
    expect(masks).toEqual(expect.arrayContaining([32775, 16, 32774]));
    expect(describeValue("type-mask", 16)).toEqual(["WirelessModemTraffic (Personal Hotspot data)"]);
    expect(describeValue("type-mask", 32775)).toEqual(["Internet", "VVM (visual voicemail)", "MMS", "EntitlementTraffic"]);
    expect(describeValue("type-mask", (carrier.OTAActivationAPN as Dict)["type-mask"])).toEqual(["OTAActivation"]);
  });

  it("decodes ATT_US override APNs (IMS, SOS, full default APN = 0x108007)", () => {
    const b = openIpcc(fixture("ATT_US.ipcc"));
    const f = b.info.files.find((x) => /^overrides_.*\.plist$/.test(x.path))!;
    const apns = (decodeFile(b, f.path).plist as Dict).apns as Dict[];
    const byName = Object.fromEntries(apns.map((a) => [a.apn, a]));
    expect(describeValue("type-mask", byName.ims["type-mask"])).toEqual(["IMS"]);
    expect(describeValue("type-mask", byName.sos["type-mask"])).toEqual(["Emergency"]);
    expect(describeValue("tech-type-mask", 1081351)).toEqual([
      "Internet",
      "VVM (visual voicemail)",
      "MMS",
      "EntitlementTraffic",
      "UT (XCAP / Ut supplementary services)",
    ]);
  });

  it("decodes MTU technology-mask and entitlement bits", () => {
    const carrier = plistOf("ATT_US.ipcc", "carrier.plist");
    const mtu = (carrier.MTU as Dict[])[0];
    expect(describeValue("technology-mask", mtu["technology-mask"])).toEqual(["UMTS (GSM/UMTS, 3GPP)", "LTE"]);
    expect(describeValue("technology-mask", 32)).toEqual(["bit 5"]);
    const ent = (carrier.CarrierEntitlements as Dict).SupportedEntitlements as number;
    expect(ent).toBe(12173);
    expect(describeValue("SupportedEntitlements", ent)).toEqual([
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
    const carrier = plistOf("Verizon_LTE_US.ipcc", "carrier.plist");
    const mtu = (carrier.MTU as Dict[]).map((m) => m["technology-mask"]);
    expect(mtu).toEqual(expect.arrayContaining([12, 2]));
    expect(describeValue("technology-mask", 12)).toEqual(["eHRPD", "LTE"]);
    expect(describeValue("technology-mask", 14)).toEqual(["CDMA 1x", "eHRPD", "LTE"]);
    expect(describeValue("technology-mask", 28)).toEqual(["eHRPD", "LTE", "NR (5G)"]);
    expect(describeValue("FallbackMethod", carrier.FallbackMethod)).toEqual(["CDMA 1x"]);
    expect(describeValue("SupportedEntitlements", 4238745)).toEqual([
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
    expect(d.default).toBe(0x1b01c);
    expect(d.confidence).toBe("med");
    expect(d.bits).toBe(DATA_MODE_BITS);
    expect(describeValue("IPv6SupportedDataModeMask", 0x1b01c)).toEqual(["WCDMA", "HSDPA", "HSUPA", "eHRPD", "LTE", "NR NSA", "NR SA"]);
    // bundle tally values 57372 and 106527
    expect(describeValue("IPv6SupportedDataModeMask", 57372)).toEqual(["WCDMA", "HSDPA", "HSUPA", "LTE", "EV-DO RevB", "NR NSA"]);
    expect(describeValue("IPv6SupportedDataModeMask", 106527)).toEqual(["GPRS", "EDGE", "WCDMA", "HSDPA", "HSUPA", "LTE", "NR NSA", "NR SA"]);
    for (const b of [5, 6, 7, 8]) expect(DATA_MODE_BITS[b], `bit ${b}`).toBeUndefined();
  });

  it("decodes TechSettings masks and enums from a real bundle", () => {
    const carrier = plistOf("ATT_RedPocket_Watch.ipcc", "carrier.plist");
    const ts = carrier.TechSettings as Dict;
    expect(describeValue("5wiServiceMask", ts["5wiServiceMask"])).toEqual(["Internet", "VVM (visual voicemail)"]);
    expect(describeValue("5wiServiceMask", 1)).toEqual(["Internet"]);
    expect(FIELDS.IMSServiceMask.bits).toBe(IMS_SERVICE_BITS);
    expect(describeValue("IMSServiceMask", 2, "IMSConfig.Satellite.IMSServiceMask")).toEqual(["SMS"]);
    expect(describeValue("IMSServiceMask", 3)).toEqual(["Voice", "SMS"]);
    expect(describeValue("DHGroup", 2)).toEqual(["1024-bit MODP"]);
    for (const g of [1, 2, 5, 14, 15, 16, 18, 21]) expect(IKE_DH_GROUP[g], `group ${g}`).toBeTruthy();
    expect(describeValue("AllowedPdpTypeMask", 3)).toEqual(["IPv4v6 (dual stack)"]);
  });

  it("reads AllowedProtocolMask as an enum, not bits", () => {
    expect(BITMASK_KEYS.has("AllowedProtocolMask")).toBe(false);
    expect(describeValue("AllowedProtocolMask", 3)).toEqual(["IPv4v6 (dual stack)"]);
    expect(describeValue("AllowedProtocolMaskInRoamingLTE", 2)).toEqual(["IPv6"]);
    expect(describeValue("AllowedProtocolMask", 9)).toEqual([]);
  });

  it("labels string enums and message IDs", () => {
    expect(describeValue("DataIndicatorOverrideForNRMmwave", "NRUWB")).toEqual(["5G UW"]);
    expect(describeValue("DataIndicatorOverrideForEvo", "5GE")![0]).toMatch(/^5GE/);
    expect(["NRPlus", "NRUWB", "NRUC", "NRCA"].every((v) => describeValue("DataIndicatorOverrideForNRMmwave", v)!.length === 1)).toBe(true);
    expect(describeValue("DataIndicatorOverrideForLTE", "LTE")).toEqual(["LTE"]);
    expect(describeValue("DataIndicatorOverride", "4G")).toEqual(["4G"]);
    expect(describeValue("FromServiceID", 4379)).toEqual(["Child abduction (AMBER)"]);
    expect(describeValue("DHGroup", 14)).toEqual(["2048-bit MODP"]);
    expect(describeValue("CarrierName", "AT&T")).toBeUndefined();
    expect(describeValue("no-such-key", 1)).toBeUndefined();
  });
});

describe("high bits", () => {
  it("decodes InternetSlice bits 28-35 exactly", () => {
    const v = 2 ** 28 + 2 ** 31 + 2 ** 32 + 2 ** 35;
    expect(maskBits(v)).toEqual([28, 31, 32, 35]);
    expect(describeValue("type-mask", v)).toEqual(["InternetSlice1", "InternetSlice4", "InternetSlice5", "InternetSlice8"]);
    expect(describeValue("type-mask", 1n << 34n)).toEqual(["InternetSlice7"]);
    expect(describeValue("type-mask", 2 ** 36)).toEqual(["bit 36"]);
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
    expect(describeValue("Type", 3, ["AttachAPN", "3GPP"])).toEqual(["WiFiCalling"]);
    expect(describeValue("Type", "Non3GPP", "apns[0].configuration[1].NoCellularReconnectCauseCodes[0].Type")![0]).toMatch(/Wi-Fi/);
    expect(describeField("Type", "CarrierEntitlements/Authentication")?.confidence).toBe("low");
    expect(describeField("Type")).toBeUndefined();
    expect(describeField("Type", "Somewhere.Else")).toBeUndefined();
  });

  it("resolves Category and Identifier from a real bundle path", () => {
    expect(describeValue("Category", 4097, "CellBroadcast.MessageIDParameters3GPP2[0]")).toEqual(["Extreme threat"]);
    expect(describeValue("Category", 6, "EmergencyCalling.EmergencyNumbers[2]")).toEqual(["Ambulance", "Fire Brigade"]);
    expect(describeValue("Identifier", 16386, "TechSettings.ExtraConfigurationAttributeRequestv6[0]")).toEqual(["Private use"]);
    expect(describeValue("Identifier", 21, ["TechSettings", "ExtraConfigurationAttributeRequestv4[]"])).toEqual(["P_CSCF_IP6_ADDRESS"]);
  });

  it("falls back to the plain entry for ordinary keys", () => {
    expect(describeField("type-mask", "apns[0]")).toBe(FIELDS["type-mask"]);
  });
});

describe("backward-compatible exports", () => {
  it("derives the old sets and notes from FIELDS", () => {
    for (const k of ["SupportedEntitlements", "type-mask", "tech-type-mask", "technology-mask", "APNEditabilityTypemask", "IPv6SupportedDataModeMask", "SupportedEntitlementsStandaloneMode", "StaticNATType"])
      expect(BITMASK_KEYS.has(k), k).toBe(true);
    for (const k of ["SupportedPLMNs", "SupportedSIMs", "IntlDataRoamingAllowed", "IntlDataRoamingExceptions", "BlacklistedSIMs", "AllPLMNs"])
      expect(PLMN_KEYS.has(k), k).toBe(true);
    expect(Object.keys(KEY_NOTES)).toHaveLength(Object.keys(FIELDS).length);
    expect(KEY_NOTES["tech-type-mask"]).not.toMatch(/radio technolog/i);
    expect(KEY_NOTES.CarrierName).toBe(FIELDS.CarrierName.note);
  });

  it("keeps decodeBits and describeMessageId", () => {
    expect(decodeBits(32768)).toEqual([15]);
    expect(decodeBits(9)).toEqual([0, 3]);
    expect(decodeBits(-4)).toEqual([]);
    expect(decodeBits(2 ** 35 + 1)).toEqual([0, 35]);
    expect(describeMessageId(4382)).toMatch(/Operator-defined/);
    expect(describeMessageId(4352)).toMatch(/ETWS/);
    expect(describeMessageId(1)).toBeUndefined();
  });
});

describe("IMSConfig keys resolve through the IMS registry", () => {
  const imsOf = (bundle: string) => plistOf(bundle, "carrier.plist").IMSConfig as Dict;

  it("types, defaults and enum values under real ATT_RedPocket paths", () => {
    const sig = imsOf("ATT_RedPocket_Watch.ipcc").Signaling as Dict;
    expect(sig.AccessBarringType).toBe("ACB");
    const abt = describeField("AccessBarringType", "IMSConfig.Signaling.AccessBarringType")!;
    expect(abt.format).toBe("enum");
    expect(abt.default).toBe("SSAC");
    expect(describeValue("AccessBarringType", sig.AccessBarringType, "IMSConfig.Signaling.AccessBarringType")).toEqual(["ACB"]);
    expect(describeValue("AccessBarringType", "Bogus", "IMSConfig.Signaling")).toEqual([]);
    expect(describeValue("Preconditions", sig.Preconditions, "IMSConfig.Signaling")).toEqual(["Supported"]);
    expect(describeValue("CountryOfOriginationFormat", sig.CountryOfOriginationFormat, "IMSConfig.Signaling")).toEqual(["BOTH"]);
    expect(describeValue("EmergencyPreferredIdentity", "IMSI", "IMSConfig.Signaling")).toEqual(["IMSI (default)"]);
    expect(describeValue("AccessNetworkRefreshMethod", "", "IMSConfig.Signaling")).toEqual(["empty (off) (default)"]);

    const ring = describeField("RingingTimerSeconds", "IMSConfig.Signaling.RingingTimerSeconds")!;
    expect(ring).toMatchObject({ type: "integer", default: 40, unit: "s" });
    expect(ring.confidence).toBeUndefined();
    expect(describeField("UseIPSec", "IMSConfig.Signaling")!.type).toBe("boolean");
    expect(describeField("AccessNetworkRefreshDelayMilliseconds", "IMSConfig.Signaling")!.unit).toBe("ms");
  });

  it("SipTimers keys only resolve under SipTimers", () => {
    const timers = (imsOf("ATT_RedPocket_Watch.ipcc").Signaling as Dict).SipTimers as Dict;
    expect(Object.keys(timers)).toEqual(expect.arrayContaining(["B", "D", "InviteResponseTimeout"]));
    expect(describeField("D", "IMSConfig.Signaling.SipTimers.D")).toMatchObject({ type: "integer", default: 128000, unit: "ms" });
    expect(describeField("InviteResponseTimeout", "IMSConfig.Signaling.SipTimers")!.default).toBe(10000);
    expect(describeField("B", "IMSConfig.Signaling.B")).toBeUndefined();
    expect(describeField("B", "Somewhere.B")).toBeUndefined();
    expect(describeField("T1")).toBeUndefined();
  });

  it("follows overlays, MVNO overrides and legacy names", () => {
    expect(describeField("UseIPSec", "IMSConfigSecondaryOverlay.Signaling.UseIPSec")!.type).toBe("boolean");
    expect(describeField("SessionExpiresSeconds", "MVNOOverrides.Configuration_1.OverrideConfiguration.IMSConfig.Signaling")).toBeTruthy();
    expect(describeField("EnableAPOnlyMode", "InitialSetupOverrides.Media.VoiceOnAP")!.default).toBe(true);
    const legacy = describeField("RingbackTimer", "IMSConfig.Signaling.RingbackTimer")!;
    expect(legacy.note).toMatch(/^Legacy name of RingbackTimerSeconds\./);
    expect(describeField("SipTimerT1", "IMSConfig.Signaling.SipTimers")!.default).toBe(2000);
  });

  it("keys outside the registry section fall back to FIELDS", () => {
    const cw = imsOf("CW_wi.ipcc");
    expect((cw.SIM as Dict).IgnoreISIM).toBe(true);
    expect(describeField("IgnoreISIM", "IMSConfig.SIM.IgnoreISIM")).toBe(FIELDS.IgnoreISIM);
    expect(FIELDS.IgnoreISIM.default).toBe(false);
    expect(describeField("SIM", "IMSConfig.SIM")!.note).toMatch(/impiFormat/);
    const us = imsOf("UnitedStates.ipcc");
    expect((us.Voice as Dict).EnableVolteByDefault).toBe(true);
    expect(describeField("EnableVolteByDefault", "IMSConfig.Voice")).toBe(FIELDS.EnableVolteByDefault);
    expect(describeField("SuppressDisclosingSuspiciousUndetectedEmergency", "IMSConfig.Voice")!.default).toBe(false);
    expect(describeField("BlockSilentRedialOverCS", "IMSConfig.Voice")!.default).toBe(false);
  });

  it("documents call end-reason entries and their TerminationEvent", () => {
    const sig = imsOf("ATT_RedPocket_Watch.ipcc").Signaling as Dict;
    const inc = sig.IncomingCallEndReasons as Record<string, Dict>;
    expect(inc.TemporarilyUnavailable).toEqual({ StatusCode: 480, TerminationEvent: "RemoteHangup" });
    expect(describeField("TemporarilyUnavailable", "IMSConfig.Signaling.IncomingCallEndReasons.TemporarilyUnavailable")!.note).toMatch(/SIP 480, event TemporarilyUnavailable/);
    expect(describeField("NotFound", "IMSConfig.Signaling.IncomingCallEndReasons")!.note).toMatch(/Carrier-defined/);
    expect(describeField("RejectedByUser", "IMSConfig.Signaling.CallEndReasons")!.note).toMatch(/SIP 486, event LocalHangup, Reason "Call Rejected By User"/);
    const p = "IMSConfig.Signaling.IncomingCallEndReasons.TemporarilyUnavailable.TerminationEvent";
    expect(describeValue("TerminationEvent", inc.TemporarilyUnavailable.TerminationEvent, p)).toEqual(["ReasonCode 1"]);
    expect(describeValue("TerminationEvent", "CallAudioServiceCrash", p)).toEqual(["ReasonCode 38"]);
    expect(describeField("StatusCode", p.replace("TerminationEvent", "StatusCode"))!.type).toBe("integer");
  });

  it("without a path, FIELDS wins and IMS-only keys still resolve", () => {
    expect(describeField("Preconditions")).toBe(FIELDS.Preconditions);
    expect(describeField("AccessBarringType")!.default).toBe("SSAC");
    expect(describeField("NoSuchImsKey")).toBeUndefined();
  });
});

describe("wave-2 findings", () => {
  it("adds libSystemDetermination defaults (value when absent)", () => {
    for (const k of ["QoSRevokeEnabled", "BlockCallsOverCS", "AllowIMSUnprovisioned", "UseT3402ForPdpBackoff", "IgnoreISIM", "USIMFallbackSupport", "SupportsRTT", "SupportsTTY"])
      expect(FIELDS[k].default, k).toBe(false);
    expect(FIELDS.WifiAccessInfo.default).toBe("ffffffffffff");
    expect(FIELDS.T3396PdpBackOffSeconds).toMatchObject({ default: 0, unit: "s" });
    expect(describeValue("supported", true, "IMSConfig.XCAP.supported")).toBeUndefined();
    expect(describeField("supported", "IMSConfig.XCAP")!.default).toBe(false);
  });

  it("decodes QuickSwitch SMS forking and satellite tier enums", () => {
    expect(describeValue("SMSForkingMechanism", 3)).toEqual(["selective"]);
    expect(Object.keys(SMS_FORKING_MECHANISM)).toHaveLength(5);
    expect(describeValue("Tier", 4, "SatelliteAccessInfo.Tier")).toEqual(["Tier D"]);
    expect(describeValue("TechnologyMask", 24, "NRSlicing.AppCategories[0].TechnologyMask")).toEqual(["LTE", "NR (5G)"]);
  });

  it("resolves generic child keys by parent", () => {
    expect(describeField("Number", "EmergencyCalling.EmergencyNumbers[0].Number")!.type).toBe("string");
    expect(describeField("Title", "CarrierBookmarks[0]")!.confidence).toBeUndefined();
    expect(describeField("Title", "EmergencyCalling.EmergencyNumbers[0]")!.confidence).toBe("med");
    expect(describeField("Mode", "TechSettingsSecondaryOverlay.ChildSAs.FirstChild.Mode")!.default).toBe("Tunnel");
    expect(describeField("LTE", "IMSConfig.SMS.SupportedDomains.LTE")!.type).toBe("boolean");
    expect(describeField("LTE")).toBeUndefined();
    expect(describeValue("Category", 1, "EmergencyCalling.EmergencyNumbers[0]")).toEqual(["Police"]);
  });

  it("notes keys with no iOS 27 reader without touching dyld-backed entries", () => {
    expect(FIELDS.Show4GSwitch.note).toMatch(/No iOS 27 reader found\.$/);
    expect(FIELDS.MVNOOverrides.note).toMatch(/No iOS 27 reader found/);
    expect(FIELDS.CBSignature2.note).not.toMatch(/reader/);
    expect(FIELDS.CBSignature2.confidence).toBeUndefined();
  });

  it("caps CommCenter-only meanings at med", () => {
    for (const k of ["IgnoresDeactivateOnNetworkScanServiceMask", "enableXLAT464", "FirstChild", "NRSlicing", "ServerAddress"]) expect(FIELDS[k].confidence, k).toBe("med");
  });

  it("CoreMotion body-threshold keys are documented", () => {
    expect(FIELDS.CMOnBodyStatusManagerWakeThreshold.note).toMatch(/CoreMotion/);
    expect(Object.keys(FIELDS).filter((k) => k.startsWith("CMOnBodyStatusManager"))).toHaveLength(20);
  });
});
