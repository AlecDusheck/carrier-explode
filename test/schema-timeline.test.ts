import { describe, expect, it } from "vitest";

import { compareVersions } from "../src/lib/decode/index.ts";
import {
  buildIndexes, deviceGroups, head, isVersionSlug, sourceTimeline,
  type AndroidRelease, type AppleRelease, type Profile, type Release, type SourceRef, type Timeline, type TimelineEntry,
} from "../src/lib/schema/index.ts";
import type { OtaRef } from "../src/lib/storage/keys.ts";

const IOS: SourceRef = { platform: "ios", kind: "carrier", name: "Test_US" };
const KEY = "ios:carrier:Test_US";

function apple(id: string, version: string, artifact?: { sha: string; cid: string; version: string }, prerelease = false): AppleRelease {
  return {
    platform: "ios", id, version, prerelease, devices: ["iPhone18,1"], extractedAt: "x", released: `2026-01-${id.slice(-2)}`, modems: [],
    sources: artifact ? { [KEY]: { ...artifact, size: 1 } } : {},
  };
}

function ota(build: string, os: string, extra: Partial<OtaRef> = {}): OtaRef {
  return {
    url: `https://updates.cdn-apple.com/2025010${build.length}/${extra.source ?? KEY}/${build}/${os}.ipcc`, source: KEY, os, build,
    archive: { state: "pending" }, firstSeen: "2026-03-04T00:00:00Z", lastSeen: "2026-03-04T00:00:00Z", live: true, ...extra,
  };
}

const appleLine = (t: Timeline): readonly TimelineEntry[] => (t.family === "apple" ? t.entries : []);
const slugs = (entries: readonly TimelineEntry[]): string[] => entries.map((e) => `${e.slug}${e.changed ? "" : " (same)"}`);

describe("Apple timelines", () => {
  it("merges an image copy and an archived OTA copy of one content into one entry", () => {
    const t = sourceTimeline(IOS, [apple("24A01", "27.0", { sha: "img", cid: "c72", version: "72.0" })], [
      ota("72.0", "27.0", { archive: { state: "archived", sha: "orig", cid: "c72" } }),
      ota("71.1", "26.4"),
    ]);
    const entries = appleLine(t);
    expect(slugs(entries)).toEqual(["72.0", "71.1"]);
    expect(entries[0]?.copies.map((c) => c.via)).toEqual(["image", "ota"]);
    expect(entries.every((e) => isVersionSlug(e.slug))).toBe(true);
  });

  it("keeps an unarchived OTA file apart, taken to be the same content as the image of its version", () => {
    const entries = appleLine(sourceTimeline(IOS, [apple("24A01", "27.0", { sha: "img", cid: "c72", version: "72.0" })], [ota("72.0", "27.0")]));
    expect(entries.map((e) => [e.slug, e.copies[0].via, e.changed])).toEqual([["72.0", "ota", false], ["72.0@ios-27.0", "image", true]]);
  });

  it("names an older content under a reused version by where it first appeared, and fails when it cannot", () => {
    const releases = [apple("24A02", "27.0", { sha: "new", cid: "c2", version: "50.1" }), apple("23A01", "26.0", { sha: "old", cid: "c1", version: "50.1" })];
    expect(slugs(appleLine(sourceTimeline(IOS, releases, [])))).toEqual(["50.1", "50.1@ios-26.0"]);
    const clash = [
      apple("24A03", "27.1", { sha: "n", cid: "c3", version: "50.1" }),
      apple("24A02", "27.0", { sha: "a", cid: "c2", version: "50.1" }),
      apple("24A01", "27.0", { sha: "b", cid: "c1", version: "50.1" }),
    ];
    expect(() => sourceTimeline(IOS, clash, [])).toThrow(/names two contents/);
  });

  it("puts model-specific files on their own line and marks beta-only content", () => {
    const t = sourceTimeline(IOS, [apple("24A05", "27.0 beta 2", { sha: "b", cid: "cb", version: "73.0" }, true)], [ota("33.2", "12.0", { model: "iPhone7,1" })]);
    expect(t.family === "apple" && Object.keys(t.models)).toEqual(["iPhone7,1"]);
    expect(appleLine(t)[0]?.beta).toBe(true);
  });
});

describe("Android timelines", () => {
  const AKEY = "android:carrier:test_us";
  const ANDROID: SourceRef = { platform: "android", kind: "carrier", name: "test_us" };
  const build = (id: string, patch: string, files: Array<[string, string, string[]]>): AndroidRelease => ({
    platform: "android", id, version: "16", patch, prerelease: false, devices: files.flatMap(([, , d]) => d), extractedAt: "x", carrierList: "list",
    sources: { [AKEY]: files.map(([sha, version, devices]) => ({ sha, version, size: 1, devices })) },
  });
  const releases = [
    build("CP3A.260905.009", "2026-09", [["s9", "40", ["frankel", "tokay", "comet"]], ["s6", "40", ["oriole", "raven"]]]),
    build("CP3A.260805.001", "2026-08", [["s9", "40", ["tokay", "comet"]], ["s6old", "39", ["oriole", "raven"]]]),
  ];
  const t = sourceTimeline(ANDROID, releases, []);

  it("keeps one line per device, the same version carrying different files on different devices", () => {
    if (t.family !== "android") throw new Error("expected an Android timeline");
    expect(Object.keys(t.devices)).toEqual(["frankel", "tokay", "comet", "raven", "oriole"]);
    expect(t.devices.tokay?.map((e) => e.slug)).toEqual(["40"]);
    expect(t.devices.oriole?.map((e) => [e.slug, e.changed])).toEqual([["40", true], ["39", true]]);
    expect(t.canonical).toEqual({ s9: "frankel", s6: "raven", s6old: "raven" });
  });

  it("heads on the newest flagship and lists today's device groups", () => {
    expect(head(t)?.line).toBe("frankel");
    expect(deviceGroups(ANDROID, releases, t).map((g) => [g.devices, g.line])).toEqual([[["frankel", "tokay", "comet"], "frankel"], [["raven", "oriole"], "raven"]]);
  });
});

describe("buildIndexes", () => {
  const profile = (source: SourceRef, sha: string, volte: "on" | "no"): Profile => ({
    schema: 1, source, sha, version: "1", identity: { display: source.name, iso: ["us"], sims: [{ mccmnc: "310410" }] },
    apns: [], concepts: { volte: { kind: "state", state: volte, because: [], fidelity: "exact" } }, raw: {}, variants: [],
  });
  const ATT: SourceRef = { platform: "ios", kind: "carrier", name: "ATT_US" };
  const att: SourceRef = { platform: "android", kind: "carrier", name: "att_us" };
  const profiles = new Map([["i1", profile(ATT, "i1", "on")], ["a9", profile(att, "a9", "on")], ["a6", profile(att, "a6", "no")]]);
  const releases: Release[] = [
    { platform: "ios", id: "24A1", version: "27.0", prerelease: false, devices: [], extractedAt: "x", released: "2026-09-15", modems: [], sources: { "ios:carrier:ATT_US": { sha: "i1", cid: "c1", version: "72.1", size: 1 } } },
    { platform: "android", id: "CP3A.1", version: "16", patch: "2026-09", prerelease: false, released: "2026-09-02", devices: ["tokay", "oriole"], extractedAt: "x", carrierList: "l", sources: {
      "android:carrier:att_us": [{ sha: "a9", version: "9", size: 1, devices: ["tokay"] }, { sha: "a6", version: "6", size: 1, devices: ["oriole"] }],
    } },
  ];
  const out = buildIndexes({ releases, otaRefs: [], profiles: (sha) => profiles.get(sha), manifestSims: {} });

  it("links the platforms into one carrier keyed by the Apple bundle name", () => {
    expect(out.carriers).toEqual([{ id: "ATT_US", name: "ATT_US", iso: "us", platforms: ["android", "ios"], updated: "2026-09-15", members: ["android:carrier:att_us", "ios:carrier:ATT_US"] }]);
    expect(out.sources).toEqual({ "android:carrier:att_us": "ATT_US", "ios:carrier:ATT_US": "ATT_US" });
    expect(out.countries).toEqual([{ iso: "us", name: "United States", countryBundles: [], carriers: ["ATT_US"] }]);
    expect(out.releases.map((r) => [r.id, r.sourceCount])).toEqual([["24A1", 1], ["CP3A.1", 1]]);
  });

  it("summarises feature states per device group", () => {
    expect(out.docs[0]?.states).toEqual({
      "android:carrier:att_us": [
        { devices: ["tokay"], slug: "9", line: "tokay", states: { volte: "on" } },
        { devices: ["oriole"], slug: "6", line: "oriole", states: { volte: "no" } },
      ],
      "ios:carrier:ATT_US": [{ devices: "rest", slug: "72.1", states: { volte: "on" } }],
    });
  });
});

/* v1's timeline (main:src/lib/server/timeline.ts), ported here to generate every slug it could produce. */
interface V1Image { build: string; version: string; bundle?: { id: string; build: string } }
interface V1Ref { os: string; build: string; url: string; productType?: string }
interface V1Entry { slug: string; build: string; productType?: string; image?: string; source: "image" | "ota"; id?: string }

function v1Timeline(images: readonly V1Image[], refs: readonly V1Ref[]): V1Entry[] {
  const out: V1Entry[] = [];
  for (const img of images) {
    const b = img.bundle;
    if (!b) continue;
    const last = out[out.length - 1];
    if (last?.id === b.id) continue;
    out.push({ slug: "ios-" + img.version.trim().replace(/\s+/g, "-"), build: b.build, image: img.build, source: "image", id: b.id });
  }
  const seenUrl = new Set<string>();
  for (const r of refs) {
    if (seenUrl.has(r.url)) continue;
    seenUrl.add(r.url);
    const pt = r.productType && r.productType !== "Watch" ? `-${r.productType}` : "";
    out.push({ slug: r.os === "legacy" ? "ota-legacy" : `ota-${r.build}${pt}`, build: r.build, source: "ota", ...(r.productType ? { productType: r.productType } : {}) });
  }
  out.sort((a, b) => Number(!!a.productType) - Number(!!b.productType) || compareVersions(b.build || "0", a.build || "0") || Number(b.source === "image") - Number(a.source === "image"));
  const seen = new Map<string, number>();
  for (const e of out) {
    const n = (seen.get(e.slug) ?? 0) + 1;
    seen.set(e.slug, n);
    if (n > 1) e.slug += e.image ? `-${e.image}` : `-${n}`;
  }
  return out;
}

describe("v1 redirects", () => {
  const images: V1Image[] = [
    { build: "24B10", version: "27.1", bundle: { id: "c73", build: "73.0" } },
    { build: "24A10", version: "27.0", bundle: { id: "c72", build: "72.0" } },
    { build: "24A05", version: "27.0 beta 2", bundle: { id: "c72", build: "72.0" } },
    { build: "24A01", version: "27.0", bundle: { id: "c71", build: "71.0" } },
  ];
  // Listed newest OS first, as v1's carrierRefs sorted them.
  const v1Refs: V1Ref[] = [
    { os: "27.0", build: "72.1", url: "u/72.1/a" },
    { os: "26.4", build: "72.1", url: "u/72.1/b" },
    { os: "26.4", build: "71.1", url: "u/71.1" },
    { os: "iPhone 1", build: "1.1", url: "u/fam", productType: "iPhone" },
    { os: "13.4", build: "41.1", url: "u/ipad", productType: "iPad" },
    { os: "12.0", build: "33.2", url: "u/i71", productType: "iPhone7,1" },
    { os: "legacy", build: "1.0", url: "u/legacy" },
  ];
  const releases: AppleRelease[] = images.map((img) => ({
    platform: "ios", id: img.build, version: img.version, prerelease: img.version.includes("beta"), devices: [], extractedAt: "x", modems: [],
    released: `2026-${img.build.slice(-2)}-01`,
    sources: img.bundle ? { [KEY]: { sha: `sha-${img.build}`, cid: img.bundle.id, version: img.bundle.build, size: 1 } } : {},
  }));
  const otaRefs: OtaRef[] = v1Refs.map((r) => ({
    url: r.url, os: r.os, build: r.build,
    source: r.productType === "iPad" ? "ipados:carrier:Test_US" : KEY,
    ...(r.productType?.includes(",") ? { model: r.productType } : {}),
    archive: { state: "pending" }, firstSeen: `2025-0${(r.build.length % 9) + 1}-0${r.url.length % 9 + 1}`, lastSeen: "2026", live: true,
  }));
  const out = buildIndexes({ releases, otaRefs, profiles: () => undefined, manifestSims: {} });
  const routes = new Map(out.legacy.map((r) => [r.from, r.to]));

  it("resolves every slug v1 produced", () => {
    const v1 = v1Timeline(images, v1Refs).map((e) => e.slug);
    expect(v1.length).toBeGreaterThan(8);
    expect(v1.filter((s) => !routes.has(`/carriers/Test_US/${s}`))).toEqual([]);
    expect(routes.get("/carriers/Test_US")).toBe("/carriers/ios/Test_US");
  });

  it("points model and iPad files at their own line and platform", () => {
    expect(routes.get("/carriers/Test_US/ota-33.2-iPhone7,1")).toBe("/carriers/ios/Test_US/iPhone7%2C1/33.2");
    expect(routes.get("/carriers/Test_US/ota-41.1-iPad")).toBe("/carriers/ipados/Test_US/41.1");
    expect(routes.get("/carriers/Test_US/ios-27.0")).toBe("/carriers/ios/Test_US/72.0");
  });
});
