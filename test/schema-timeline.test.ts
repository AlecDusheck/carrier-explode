import { describe, expect, it } from "vitest";

import { buildIndexes, deviceGroups, entryForDevice, headIndex, isVersionSlug, sourceTimeline, type Profile, type Release, type ReleaseSource } from "../src/lib/schema/index.ts";
import type { OtaRef } from "../src/lib/storage/keys.ts";

const KEY = "ios:carrier:Test_US";

function ios(id: string, version: string, src?: Partial<ReleaseSource>, prerelease?: boolean): Release {
  return {
    platform: "ios", id, version, devices: ["iPhone18,1"], extractedAt: "2026-01-01",
    ...(prerelease !== undefined ? { prerelease } : {}),
    sources: src ? { [KEY]: [{ sha: "s", version: "1", size: 1, ...src }] } : {},
  };
}

function ota(build: string, os: string, extra: Partial<OtaRef> = {}): OtaRef {
  return { url: `https://apple.example/${build}${extra.productType ?? ""}.ipcc`, source: KEY, os, build, firstSeen: "2026-03-04T00:00:00Z", lastSeen: "2026-03-04T00:00:00Z", live: true, ...extra };
}

const slugs = (entries: readonly { slug: string; changed: boolean }[]): string[] => entries.map((e) => `${e.slug}${e.changed ? "" : " (same)"}`);

describe("iOS timelines", () => {
  it("orders by bundle version, the image winning a tie, per-model variants last", () => {
    const { entries } = sourceTimeline(KEY, "ios", [ios("24A1", "27.0", { sha: "a", cid: "c1", version: "72.0" })], [
      ota("72.0", "27.0", { cid: "c1" }),
      ota("71.1", "26.4"),
      ota("33.2", "12.0", { productType: "iPhone7,1" }),
    ]);
    expect(slugs(entries)).toEqual(["ios-27.0 (same)", "ota-72.0", "ota-71.1", "ota-33.2-iPhone7,1"]);
    expect(entries.every((e) => isVersionSlug(e.slug))).toBe(true);
  });

  it("collapses consecutive images with the same content, marks beta-only copies, keeps slugs unique", () => {
    const releases = [
      ios("24A10", "27.0", { sha: "x", cid: "c2", version: "73.0" }),
      ios("24A5", "27.0 beta 2", { sha: "y", cid: "c2", version: "73.0" }, true),
      ios("23Z9", "26.4", { sha: "z", cid: "c1", version: "72.0" }),
      ios("23Z1", "26.4", { sha: "w", cid: "c0", version: "71.0" }),
    ];
    const { entries } = sourceTimeline(KEY, "ios", releases, []);
    expect(entries.map((e) => e.releases)).toEqual([["24A5", "24A10"], ["23Z9"], ["23Z1"]]);
    expect(entries[0]?.beta).toBeUndefined();
    // Two images of one iOS version: the newest keeps the clean slug.
    expect(slugs(entries)).toEqual(["ios-27.0", "ios-26.4", "ios-26.4-23Z1"]);
    expect(sourceTimeline(KEY, "ios", releases.slice(1, 2), []).entries[0]?.beta).toBe(true);
  });

  it("dates a change by the release day or the OTA first sighting", () => {
    const t = sourceTimeline(KEY, "ios", [], [ota("72.1", "27.0"), ota("72.1", "26.4")]);
    expect(t.entries[0]?.releases).toEqual(["26.4", "27.0"]);
    expect(t.updated).toBe("2026-03-04");
    expect(headIndex(t.entries)).toBe(0);
  });
});

describe("Android timelines per device line", () => {
  const AKEY = "android:carrier:test_us";
  const release = (id: string, patch: string, groups: Array<[string, string[]]>): Release => ({
    platform: "android", id, version: "16", patch, devices: groups.flatMap(([, d]) => d), extractedAt: "x",
    sources: { [AKEY]: groups.map(([sha, devices]) => ({ sha, version: sha, size: 1, devices })) },
  });
  const releases = [
    release("CP3A.260905.009", "2026-09", [["new", ["frankel", "tokay", "comet"]], ["old", ["oriole", "raven"]]]),
    release("CP3A.260805.001", "2026-08", [["new", ["tokay", "comet"]], ["six", ["oriole", "raven"]]]),
  ];
  const { entries } = sourceTimeline(AKEY, "android", releases, []);

  it("keeps one entry per file and device set, suffixing groups without the flagship", () => {
    expect(entries.map((e) => [e.slug, e.devices, e.changed])).toEqual([
      ["android-cp3a.260905.009", ["frankel", "tokay", "comet"], false],
      ["android-cp3a.260905.009-raven", ["raven", "oriole"], true],
      ["android-cp3a.260805.001", ["tokay", "comet"], true],
      ["android-cp3a.260805.001-raven", ["raven", "oriole"], true],
    ]);
    expect(entries.every((e) => isVersionSlug(e.slug))).toBe(true);
  });

  it("picks entries per device and lists today's groups", () => {
    expect(headIndex(entries)).toBe(0);
    expect(entryForDevice(entries, "oriole")).toBe(1);
    expect(entries[headIndex(entries, "oriole")]?.slug).toBe("android-cp3a.260905.009-raven");
    expect(deviceGroups(entries).map((g) => g.devices)).toEqual([["frankel", "tokay", "comet"], ["raven", "oriole"]]);
  });
});

describe("buildIndexes", () => {
  const profile = (platform: "ios" | "android", name: string, sha: string, volte: "on" | "no"): Profile => ({
    schema: 1, source: { platform, kind: "carrier", name }, sha, version: "1",
    identity: { display: name, iso: ["us"], sims: [{ mccmnc: "310410" }] },
    apns: [], concepts: { volte: { value: volte, state: volte, because: [] } }, raw: {}, variants: [],
  });
  const profiles = new Map([
    ["i1", profile("ios", "ATT_US", "i1", "on")],
    ["a9", profile("android", "att_us", "a9", "on")],
    ["a6", profile("android", "att_us", "a6", "no")],
  ]);
  const releases: Release[] = [
    { platform: "ios", id: "24A1", version: "27.0", devices: [], extractedAt: "x", released: "2026-09-15", sources: { "ios:carrier:ATT_US": [{ sha: "i1", version: "72.1", size: 1 }] } },
    { platform: "android", id: "CP3A.1", version: "16", patch: "2026-09", released: "2026-09-02", devices: ["tokay", "oriole"], extractedAt: "x", sources: {
      "android:carrier:att_us": [{ sha: "a9", version: "9", size: 1, devices: ["tokay"] }, { sha: "a6", version: "6", size: 1, devices: ["oriole"] }],
    } },
  ];
  const out = buildIndexes({ releases, otaRefs: [], profiles: (sha) => profiles.get(sha) });

  it("links the platforms into one carrier named and slugged after the iOS bundle", () => {
    expect(out.carriers).toEqual([{ slug: "ATT_US", name: "ATT_US", iso: "us", platforms: ["android", "ios"], updated: "2026-09-15", members: ["android:carrier:att_us", "ios:carrier:ATT_US"] }]);
    expect(out.sources).toEqual({ "android:carrier:att_us": "ATT_US", "ios:carrier:ATT_US": "ATT_US" });
    expect(out.countries).toEqual([{ iso: "us", name: "United States", countryBundles: [], carriers: ["ATT_US"] }]);
    expect(out.releases.map((r) => [r.id, r.sources])).toEqual([["24A1", 1], ["CP3A.1", 1]]);
  });

  it("summarises feature states per device group, so pages need not open artifacts", () => {
    const doc = out.docs[0];
    expect(doc?.states?.["android:carrier:att_us"]).toEqual([
      { devices: ["tokay"], slug: "android-cp3a.1", states: { volte: "on" } },
      { devices: ["oriole"], slug: "android-cp3a.1-oriole", states: { volte: "no" } },
    ]);
    expect(doc?.states?.["ios:carrier:ATT_US"]).toEqual([{ slug: "ios-27.0", states: { volte: "on" } }]);
  });
});
