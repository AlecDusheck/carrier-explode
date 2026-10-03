import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";

import { openIpcc } from "../src/lib/decode/index.ts";
import type { CarrierList, CarrierSettings } from "../src/lib/decode/android/index.ts";
import { androidProfile, iosProfile, normaliseGid, parseSupportedSim, type ConceptValue, type Profile } from "../src/lib/schema/index.ts";

/* ---------------------------------------------------------------- builders */

/** A minimal XML plist writer: enough for dicts, arrays, strings, integers and booleans. */
function plist(v: unknown): string {
  const node = (x: unknown): string => {
    if (typeof x === "boolean") return x ? "<true/>" : "<false/>";
    if (typeof x === "number") return `<integer>${x}</integer>`;
    if (typeof x === "string") return `<string>${x.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string>`;
    if (Array.isArray(x)) return `<array>${x.map(node).join("")}</array>`;
    if (typeof x === "object" && x !== null) return `<dict>${Object.entries(x).map(([k, y]) => `<key>${k}</key>${node(y)}`).join("")}</dict>`;
    throw new Error(`cannot encode ${String(x)}`);
  };
  return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0">${node(v)}</plist>`;
}

function bundle(name: string, files: Record<string, unknown>): ReturnType<typeof openIpcc> {
  const enc = new TextEncoder();
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([p, v]) => [`Payload/${name}.bundle/${p}`, enc.encode(plist(v))])));
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

/* --------------------------------------------------------------------- iOS */

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
      apns: [{ "technology-mask": 24, configuration: [{ apn: "internet", "type-mask": 5, AllowedProtocolMask: 3, username: "", password: "pw" }] }],
      AttachAPN: { "3GPP": { apn: "ims", AllowedProtocolMask: 2 } },
      MVNOOverrides: {
        Configuration_1: { SupportedSIMs: ["310410_GID1-42"], OverrideConfiguration: { CarrierName: "Mvno", IMSConfig: { Voice: { EnableVolteByDefault: false } } } },
      },
    },
    // iPhone 16 family: carries the 5G keys, as modern bundles do.
    "overrides_D93_D94_D47_D48.plist": { Enable5GAutoByDefault: true, IMSConfig: { Signaling: { RingingTimerSeconds: 60 } } },
  });
  const p = iosProfile(b, { platform: "ios", kind: "carrier", name: "Test_US" }, "sha");

  it("reads the newest phone's settings: carrier.plist with its override on top, naming the file each value came from", () => {
    expect(p.version).toBe("72.1");
    expect(p.concepts["5g"]).toMatchObject({ kind: "state", state: "on", fidelity: "exact" });
    expect(because(p, "5g")[0]).toBe("overrides_D93_D94_D47_D48.plist:Enable5GAutoByDefault");
    // Merged dictionaries: the override's ringing timer wins, carrier.plist's other IMS keys stay.
    expect(value(p, "ringing-timer")).toBe(60000);
    expect(value(p, "sip-timer-t1")).toBe(500);
    expect(because(p, "sip-ipsec")).toEqual(["carrier.plist:IMSConfig.Signaling.UseIPSec"]);
  });

  it("normalises codecs, MMS and APNs", () => {
    expect(value(p, "audio-codecs")).toEqual(["AMR-WB", "EVS"]);
    expect(value(p, "hd-voice-plus")).toBe("on");
    expect(value(p, "mms-proxy")).toBe("proxy.example:8080");
    expect(p.apns[0]).toMatchObject({ apn: "internet", types: ["default", "mms"], protocol: "ipv4v6", bearers: ["lte", "nr"], mmsc: "http://mmsc.example", mmsProxy: "proxy.example", mmsPort: "8080", hasPassword: true, path: "carrier.plist:apns[0].configuration[0]" });
    expect(p.apns[1]).toMatchObject({ apn: "ims", types: ["ia"], protocol: "ipv6" });
    expect(value(p, "apn-attach")).toBe("ims");
  });

  it("parses SupportedSIMs, an all-FF GID being no GID rule", () => {
    expect(p.identity.sims).toContainEqual({ mccmnc: "310410" });
    expect(p.identity.sims).toContainEqual({ mccmnc: "310260", gid1: "6D" });
    expect(p.identity.sims).toContainEqual({ mccmnc: "20404", gid2: "1A", iccidPrefix: "891480" });
    expect(p.identity.iso).toEqual(["us"]);
  });

  it("keeps MVNO configurations as variants holding only what differs", () => {
    const mvno = p.variants.find((v) => v.id === "mvno:Configuration_1");
    expect(mvno?.when).toEqual({ by: "sim", sims: [{ mccmnc: "310410", gid1: "42" }] });
    expect(mvno?.label).toBe("Mvno");
    expect(mvno?.concepts.volte).toMatchObject({ kind: "state", state: "no" });
    expect(mvno?.concepts["carrier-name"]).toMatchObject({ because: [{ path: "carrier.plist:MVNOOverrides.Configuration_1.OverrideConfiguration.CarrierName" }] });
    expect(mvno?.concepts["sip-timer-t1"]).toBeUndefined();
  });

  it("flattens every member into raw", () => {
    expect(p.raw["carrier.plist:CarrierName"]).toBe("Test");
    expect(p.raw["overrides_D93_D94_D47_D48.plist:Enable5GAutoByDefault"]).toBe(true);
    expect(Object.keys(p.raw).filter((k) => /password/i.test(k))).toEqual([]);
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

/* ----------------------------------------------------------------- Android */

describe("androidProfile", () => {
  const cs: CarrierSettings = {
    canonicalName: "test_us",
    version: "79000000034",
    apns: [{ name: "Internet", value: "Fast.Example", type: ["DEFAULT", "IA", "MMS"], protocol: "IPV6", authtype: 0, mtu: 1440, bearerBitmask: "14|20", mmsc: "http://mmsc.example", password: "secret" }],
    configs: {
      carrier_volte_available_bool: { type: "bool", value: true },
      carrier_nr_availabilities_int_array: { type: "int_array", value: [1] },
      "imsvoice.ringing_timer_millis_int": { type: "int", value: 45000 },
      "imsvoice.audio_codec_capability_payload_types_bundle": {
        type: "bundle",
        value: {
          "imsvoice.amrwb_payload_type_int_array": { type: "int_array", value: [104] },
          "imsvoice.evs_payload_type_int_array": { type: "int_array", value: [] },
        },
      },
      "5g_icon_configuration_string": { type: "text", value: "connected_mmwave:5G_Plus,connected:5G" },
    },
    vendorConfigs: [{ name: "client", value: "AAE=" }],
    unknown: [{ path: "", field: 99, wire: "varint", value: "1" }],
  };
  const list: CarrierList = {
    entries: [{ canonicalName: "test_us", carrierIds: [{ mccMnc: "310410" }, { mccMnc: "310260", mvno: { kind: "gid1", value: "6DFF" } }] }],
    unknown: [],
  };
  const p = androidProfile(cs, { platform: "android", kind: "carrier", name: "test_us" }, "sha", list);

  it("decides feature states from the keys, falling back on named AOSP defaults", () => {
    expect(value(p, "volte")).toBe("on");
    expect(because(p, "volte")).toEqual(["config:carrier_volte_available_bool", "default:enhanced_4g_lte_on_by_default_bool"]);
    expect(p.concepts["wifi-calling"]).toMatchObject({ because: [{ path: "default:carrier_wfc_ims_available_bool", value: false }] });
    expect(value(p, "wifi-calling")).toBe("no");
    expect(value(p, "5g-standalone")).toBe("no");
    expect(value(p, "nr-modes")).toEqual(["NSA"]);
    expect(value(p, "hd-voice-plus")).toBe("no");
  });

  it("normalises values to the iOS units and spellings", () => {
    expect(value(p, "ringing-timer")).toBe(45000);
    expect(value(p, "audio-codecs")).toEqual(["AMR-WB"]);
    expect(value(p, "5g-icon-advanced")).toBe("5G+");
    expect(value(p, "apn-internet")).toBe("fast.example");
    expect(p.apns[0]).toMatchObject({ types: ["default", "ia", "mms"], protocol: "ipv6", auth: "none", mtu: 1440, bearers: ["lte", "nr"], hasPassword: true, path: "apns[0]" });
    // Unset keys without a known default stay unset rather than guessed.
    expect(p.concepts["sip-timer-t1"]).toEqual({ kind: "unset" });
    // A concept Android cannot express has no reading at all.
    expect(p.concepts["wifi-calling-name"]).toBeUndefined();
  });

  it("takes SIM rules from carrier_list and keeps everything in raw", () => {
    expect(p.identity.sims).toEqual([{ mccmnc: "310410" }, { mccmnc: "310260", gid1: "6D" }]);
    expect(p.identity.iso).toEqual(["us"]);
    expect(p.raw["config:imsvoice.audio_codec_capability_payload_types_bundle.imsvoice.amrwb_payload_type_int_array"]).toEqual([104]);
    expect(p.raw["apns[0].value"]).toBe("Fast.Example");
    expect(Object.keys(p.raw).some((k) => k.includes("password"))).toBe(false);
    expect(p.raw["vendor:client"]).toBe("AAE=");
    expect(p.raw["unknown:#99"]).toBe("1");
    expect(p.variants).toEqual([]);
  });
});
