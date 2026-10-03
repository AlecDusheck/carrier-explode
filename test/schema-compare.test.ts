import { describe, expect, it } from "vitest";

import { compareProfiles, type Apn, type ConceptValue, type Profile, type SourceRef } from "../src/lib/schema/index.ts";

function profile(source: SourceRef, concepts: Record<string, ConceptValue>, apns: Apn[], raw: Profile["raw"] = {}): Profile {
  return { schema: 1, source, sha: "x", version: "1", identity: { iso: [], sims: [] }, apns, concepts, raw, variants: [] };
}

const v = (value: ConceptValue["value"], fidelity?: ConceptValue["fidelity"]): ConceptValue => ({ value, because: [], ...(fidelity ? { fidelity } : {}) });
const IOS: SourceRef = { platform: "ios", kind: "carrier", name: "Test_US" };
const ANDROID: SourceRef = { platform: "android", kind: "carrier", name: "test_us" };

describe("compareProfiles", () => {
  const a = profile(IOS, {
    volte: { value: "on", state: "on", because: [] },
    "mms-max-size": v(1048576),
    "audio-codecs": v(["AMR-WB", "EVS"]),
    "wifi-calling-name": v("Test Wi-Fi"),
    "sip-timer-t1": v(null),
  }, [
    { apn: "fast.example", types: ["default", "mms"], protocol: "ipv6", hasPassword: false, path: "carrier.plist:apns[0]" },
    { apn: "ims", types: ["ims"], protocol: "ipv6", path: "carrier.plist:apns[1]" },
  ]);
  const b = profile(ANDROID, {
    volte: { value: "on", state: "on", because: [] },
    "mms-max-size": v(614400),
    "audio-codecs": v(["AMR-WB", "EVS"], "approx"),
    "sip-timer-t1": v(null),
    "video-calling": { value: "no", state: "no", because: [] },
  }, [
    { apn: "FAST.example", label: "Internet", types: ["mms", "default"], protocol: "ipv4v6", mtu: 1440, path: "apns[0]" },
    { apn: "ims", types: ["ims", "xcap"], protocol: "ipv6", path: "apns[1]" },
    { apn: "sos", types: ["emergency"], path: "apns[2]" },
  ]);
  const c = compareProfiles(a, b);

  it("groups concept rows in registry order and tells same, different and one-sided apart", () => {
    expect(c.samePlatform).toBe(false);
    expect(c.groups.map((g) => g.group)).toEqual(["features", "voice", "wifi-calling", "messaging"]);
    const row = (id: string) => c.groups.flatMap((g) => g.rows).find((r) => r.id === id);
    expect(row("volte")).toMatchObject({ same: true, onlyA: false, onlyB: false });
    expect(row("audio-codecs")?.same).toBe(true);
    expect(row("mms-max-size")).toMatchObject({ same: false, onlyA: false, onlyB: false });
    expect(row("wifi-calling-name")).toMatchObject({ same: false, onlyA: true });
    expect(row("video-calling")).toMatchObject({ onlyB: true });
    // Both expressible, both unset: equal.
    expect(row("sip-timer-t1")?.same).toBe(true);
    expect(c.counts).toEqual({ same: 3, different: 1, onlyA: 1, onlyB: 1 });
  });

  it("matches APNs by name and types, then by name, ignoring what only one platform states", () => {
    expect(c.apns.map((r) => [r.apn, r.exact, r.a !== undefined, r.b !== undefined, r.differs])).toEqual([
      ["fast.example", true, true, true, ["protocol"]],
      ["ims", false, true, true, ["types"]],
      ["sos", false, false, true, []],
    ]);
  });

  it("diffs raw leaves only within one platform", () => {
    expect(c.raw).toBeUndefined();
    const older = profile(IOS, {}, [], { "carrier.plist:A": 1, "carrier.plist:B": true });
    const newer = profile(IOS, {}, [], { "carrier.plist:A": 2, "carrier.plist:B": true, "carrier.plist:C": "x" });
    expect(compareProfiles(older, newer).raw).toEqual([
      { path: "carrier.plist:A", a: 1, b: 2 },
      { path: "carrier.plist:C", b: "x" },
    ]);
  });
});
