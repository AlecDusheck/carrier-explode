import { describe, expect, it } from "vitest";

import { compareVersions as v1CompareVersions } from "@carrier-explode/decode-ios";
import {
  buildIndexes, head, indexProfile, indexShas, isVersionSlug, newestFirst, PROFILE_SCHEMA, versionOn,
  type AndroidRelease, type AppleRelease, type Device, type IndexModemConfig, type IndexProfile, type Line, type OtaFile, type OtaListing, type Profile, type Release,
  type SourceKey, type SourceRef, type Timeline,
} from "../src/index.ts";
import type { Label } from "../src/labels.ts";
import { naming } from "../src/naming.ts";
import { pixelGroups, sourceTimeline } from "../src/timeline.ts";
import { compareDotted } from "../src/versions.ts";

/** As the feeds record them: Google's OTA page (each Pixel's first build) and AppleDB (release day, board configs). */
const DEVICES: readonly Device[] = [
  { code: "frankel", family: "android", released: "2025-08", boards: [] },
  { code: "tokay", family: "android", released: "2024-08", boards: [] },
  { code: "comet", family: "android", released: "2024-08", boards: [] },
  { code: "raven", family: "android", released: "2021-10", boards: [] },
  { code: "oriole", family: "android", released: "2021-10", boards: [] },
  { code: "flame", family: "android", released: "2019-10", boards: [] },
  { code: "iPhone18,1", family: "apple", released: "2025-09-19", boards: ["V53AP"] },
  { code: "iPhone13,2", family: "apple", released: "2020-10-23", boards: ["D53gAP"] },
  { code: "iPhone12,8", family: "apple", released: "2020-04-24", boards: ["D79AP"] },
  { code: "iPhone10,1", family: "apple", released: "2017-09-22", boards: ["D20AP"] },
];
const ORDER = newestFirst(DEVICES);

/** Profiles by sha, as the index reads them. */
const indexed = (profiles: Readonly<Record<string, Profile>>): Map<string, IndexProfile> =>
  new Map(Object.entries(profiles).map(([sha, p]) => [sha, indexProfile(p)]));

const IOS: SourceRef = { platform: "ios", kind: "carrier", name: "Test_US" };
const KEY = "ios:carrier:Test_US";

function apple(id: string, label: string, artifact?: { sha: string; cid: string; version: string }, released = `2026-01-${id.slice(-2)}`): AppleRelease {
  return {
    platform: "ios", id, version: label.split(" ")[0] ?? label, label, prerelease: label.includes("beta"), devices: ["iPhone18,1"], extractedAt: "x", released, modems: [],
    sources: artifact ? { [KEY]: { ...artifact, size: 1 } } : {},
  };
}

function listing(os: string | null, extra: Partial<OtaListing> = {}): OtaListing {
  return { source: KEY, os, firstSeenAt: "2026-03-04T00:00:00Z", lastSeenAt: "2026-03-04T00:00:00Z", live: true, ...extra };
}

function file(version: string, url: string, listings: [OtaListing, ...OtaListing[]], extra: Partial<OtaFile> = {}): OtaFile {
  return { url, version, digests: {}, sha: `sha:${url}`, cid: `cid:${url}`, listings, ...extra };
}

const main = (t: Timeline): Line => (t.kind === "apple" ? t.main : []);
const slugs = (entries: Line): string[] => entries.map((e) => `${e.slug}${e.changed ? "" : " (same)"}`);

describe("Apple timelines", () => {
  it("merges an image copy and an OTA copy of one content into one entry", () => {
    const t = sourceTimeline(IOS, [apple("24A01", "27.0", { sha: "img", cid: "c72", version: "72.0" })], [
      file("72.0", "u/72.0", [listing("27.0")], { sha: "orig", cid: "c72" }),
      file("71.1", "u/71.1", [listing("26.4")]),
    ], ORDER);
    expect(slugs(main(t))).toEqual(["72.0", "71.1"]);
    expect(main(t)[0]?.copies.map((c) => c.kind)).toEqual(["image", "ota"]);
    expect(main(t).map((e) => e.sha)).toEqual(["img", "sha:u/71.1"]);
    expect(main(t).every((e) => isVersionSlug(e.slug))).toBe(true);
  });

  it("names an older content under a reused version by where it first appeared, and fails when it cannot", () => {
    const releases = [apple("24A02", "27.0", { sha: "new", cid: "c2", version: "50.1" }), apple("23A01", "26.0", { sha: "old", cid: "c1", version: "50.1" })];
    expect(slugs(main(sourceTimeline(IOS, releases, [], ORDER)))).toEqual(["50.1", "50.1@23a01"]);
    const clash = [
      file("50.1", "u/a", [listing("27.0")], { sha: "a", cid: "ca", published: "2026-02-01" }),
      file("50.1", "u/b", [listing("26.0")], { sha: "b", cid: "cb", published: "2025-01-01" }),
      file("50.1", "u/c", [listing("25.0")], { sha: "c", cid: "cc", published: "2025-01-01" }),
    ];
    expect(() => sourceTimeline(IOS, [], clash, ORDER)).toThrow(/names two contents/);
  });

  it("puts model-specific files on their own line and marks beta-only content", () => {
    const t = sourceTimeline(IOS, [apple("24A05", "27.0 beta 2", { sha: "b", cid: "cb", version: "73.0" })], [file("33.2", "u/i71", [listing("12.0", { model: "iPhone7,1" })])], ORDER);
    expect(t.kind === "apple" && Object.keys(t.models)).toEqual(["iPhone7,1"]);
    expect(main(t)[0]?.beta).toBe(true);
  });

  it("takes beta status from the release's prerelease flag, not its label", () => {
    const release = { ...apple("24A05", "27.0 beta 2", { sha: "b", cid: "cb", version: "73.0" }), prerelease: false };
    expect(main(sourceTimeline(IOS, [release], [], ORDER))[0]?.beta).toBe(false);
  });

  it("orders and names contents the same whatever order releases and files arrive in", () => {
    const releases = [apple("24A02", "27.0", { sha: "x", cid: "cx", version: "50.1" }, "2026-01-01"), apple("24A03", "27.0", { sha: "y", cid: "cy", version: "50.1" }, "2026-01-01")];
    const files = [file("50.1", "u/a", [listing("27.0")], { published: "2026-01-01" }), file("49.0", "u/b", [listing("26.0")])];
    const one = sourceTimeline(IOS, releases, files, ORDER);
    expect(sourceTimeline(IOS, [...releases].reverse(), [...files].reverse(), ORDER)).toEqual(one);
  });

  it("orders versions numerically by segment", () => {
    expect(["9.1", "72.0", "10.0", "79000000034", "72"].sort(compareDotted)).toEqual(["9.1", "10.0", "72.0", "72", "79000000034"]);
  });
});

describe("Android timelines", () => {
  const ANDROID: SourceRef = { platform: "android", kind: "carrier", name: "test_us" };
  const build = (id: string, patch: string, files: Array<[string, string, string[]]>): AndroidRelease => ({
    platform: "android", id, version: "16", patch, devices: files.flatMap(([, , d]) => d), extractedAt: "x", carrierList: "list", modems: [],
    sources: { "android:carrier:test_us": files.map(([sha, version, devices]) => ({ sha, version, size: 1, devices })) },
  });
  const releases = [
    build("CP3A.260905.009", "2026-09", [["s9", "40", ["frankel", "tokay", "comet"]], ["s6", "40", ["oriole", "raven"]]]),
    build("CP3A.260805.001", "2026-08", [["s9", "40", ["tokay", "comet"]], ["s6old", "39", ["oriole", "raven"]]]),
  ];
  const t = sourceTimeline(ANDROID, releases, [], ORDER);

  it("keeps one line per device, one version carrying different files on different devices", () => {
    if (t.kind !== "android") throw new Error("expected an Android timeline");
    expect(Object.keys(t.devices)).toEqual(["frankel", "tokay", "comet", "raven", "oriole"]);
    expect(t.devices.tokay?.map((e) => e.slug)).toEqual(["40"]);
    expect(t.devices.oriole?.map((e) => [e.slug, e.sha, e.changed])).toEqual([["40", "s6", true], ["39", "s6old", true]]);
    expect(t.canonical).toEqual({ s9: "frankel", s6: "raven", s6old: "raven" });
  });

  it("keeps identical bytes under a new version as their own, unchanged entry", () => {
    const t2 = sourceTimeline(ANDROID, [build("B2", "2026-10", [["same", "41", ["tokay"]]]), build("B1", "2026-09", [["same", "40", ["tokay"]]])], [], ORDER);
    expect(t2.kind === "android" && t2.devices.tokay?.map((e) => [e.slug, e.changed])).toEqual([["41", false], ["40", true]]);
  });

  it("heads on the newest device and lists today's device groups", () => {
    expect(head(t)?.line).toBe("frankel");
    expect(pixelGroups(ANDROID, releases, t, ORDER).map((g) => [g.devices, g.line])).toEqual([[["frankel", "tokay", "comet"], "frankel"], [["raven", "oriole"], "raven"]]);
  });

  it("finds a version on a line, the one before it and the line's head, or says what is missing", () => {
    const at = versionOn(t, "oriole", "39");
    expect(at.found && [at.line, at.entry.sha, at.previous, at.latest.slug]).toEqual(["oriole", "s6old", null, "40"]);
    const latest = versionOn(t, null, undefined);
    expect(latest.found && [latest.line, latest.entry.slug, latest.previous]).toEqual(["frankel", "40", null]);
    expect(versionOn(t, "nope", undefined)).toEqual({ found: false, missing: "line" });
    expect(versionOn(t, "tokay", "39")).toEqual({ found: false, missing: "version" });
  });
});

describe("buildIndexes", () => {
  const profile = (source: SourceRef, sha: string, volte: "on" | "no"): Profile => ({
    schema: PROFILE_SCHEMA, source, sha, identity: { display: source.name, iso: ["us"], sims: [{ mccmnc: "310410" }] },
    apns: [], concepts: { volte: { kind: "state", state: volte, because: [], fidelity: "exact" } }, raw: {}, variants: [],
  });
  const ATT: SourceRef = { platform: "ios", kind: "carrier", name: "ATT_US" };
  const att: SourceRef = { platform: "android", kind: "carrier", name: "att_us" };
  const profiles = indexed({ i1: profile(ATT, "i1", "on"), a9: profile(att, "a9", "on"), a6: profile(att, "a6", "no") });
  const releases: Release[] = [
    { platform: "ios", id: "24A1", version: "27.0", label: "27.0", prerelease: false, devices: [], extractedAt: "x", released: "2026-09-15", modems: [], sources: { "ios:carrier:ATT_US": { sha: "i1", cid: "c1", version: "72.1", size: 1 } } },
    { platform: "android", id: "CP3A.1", version: "16", patch: "2026-09", released: "2026-09-02", devices: ["tokay", "oriole"], extractedAt: "x", carrierList: "l", modems: [], sources: {
      "android:carrier:att_us": [{ sha: "a9", version: "9", size: 1, devices: ["tokay"] }, { sha: "a6", version: "6", size: 1, devices: ["oriole"] }],
    } },
  ];
  const out = buildIndexes({ releases, otaFiles: [], devices: DEVICES, labels: [], profiles: (sha) => profiles.get(sha), manifestSims: {}, modemConfigs: () => undefined, carrierIds: {} });

  it("lists what each release changed against the platform's previous one", () => {
    const ios = (id: string, version: string, released: string, sources: Extract<Release, { platform: "ios" }>["sources"]): Release =>
      ({ platform: "ios", id, version, label: version, prerelease: false, devices: [], extractedAt: "x", released, modems: [], sources });
    const rs: Release[] = [
      ios("24A1", "27.0", "2026-09-15", { "ios:carrier:ATT_US": { sha: "i1", cid: "c1", version: "72.1", size: 1 }, "ios:carrier:Gone_US": { sha: "g1", cid: "g", version: "1.0", size: 1 } }),
      ios("24B1", "27.1", "2026-10-15", { "ios:carrier:ATT_US": { sha: "i2", cid: "c2", version: "72.2", size: 1 }, "ios:carrier:New_US": { sha: "n1", cid: "n", version: "2.0", size: 1 } }),
    ];
    const { changes } = buildIndexes({ releases: rs, otaFiles: [], devices: DEVICES, labels: [], profiles: () => undefined, manifestSims: {}, modemConfigs: () => undefined, carrierIds: {} });
    expect(changes["24A1"]).toBeUndefined();
    expect(changes["24B1"]).toEqual([
      { source: "ios:carrier:ATT_US", kind: "changed", from: { line: null, slug: "72.1", version: "72.1" }, to: { line: null, slug: "72.2", version: "72.2" } },
      { source: "ios:carrier:Gone_US", kind: "removed", from: { line: null, slug: "1.0", version: "1.0" } },
      { source: "ios:carrier:New_US", kind: "added", to: { line: null, slug: "2.0", version: "2.0" } },
    ]);
  });

  it("reads exactly the profiles indexShas names", () => {
    const read = new Set<string>();
    buildIndexes({ releases, otaFiles: [], devices: DEVICES, labels: [], profiles: (sha) => (read.add(sha), profiles.get(sha)), manifestSims: {}, modemConfigs: () => undefined, carrierIds: {} });
    expect([...read].sort()).toEqual(indexShas({ releases, otaFiles: [], devices: DEVICES, labels: [] }).sort());
  });

  it("links the platforms into one carrier keyed by the Apple bundle name", () => {
    expect(out.carriers).toEqual([{ id: "ATT_US", name: "ATT_US", iso: "us", members: ["android:carrier:att_us", "ios:carrier:ATT_US"], platforms: ["android", "ios"], updated: "2026-09-15" }]);
    expect(out.sources).toEqual({ "android:carrier:att_us": "ATT_US", "ios:carrier:ATT_US": "ATT_US" });
    expect(out.countries).toEqual([{ iso: "us", name: "United States", sources: [], carriers: ["ATT_US"] }]);
    expect(out.releases.map((r) => [r.id, r.sourceCount])).toEqual([["24A1", 1], ["CP3A.1", 1]]);
  });

  describe("5G radios, as each phone's settings show them", () => {
    const fiveG = (sha: string, source: SourceRef, raw: Profile["raw"]): Profile => ({
      ...profile(source, sha, "on"),
      concepts: { "5g": { kind: "state", state: "on", because: [], fidelity: "exact" }, volte: { kind: "state", state: "on", because: [], fidelity: "exact" } },
      raw,
      variants: [{ id: "phones:o.plist", when: { kind: "device", devices: ["iPhone10,1", "iPhone13,2"] }, concepts: {}, apns: [] }],
    });
    // Apple gives only 5G phones a 5G switch; only a 5G Pixel's Qualcomm or Shannon configurations set NR items.
    const ps = indexed({
      i5: fiveG("i5", ATT, { "overrides_D20_D79.plist:ShowCallForwarded": true, "overrides_D53g_V53.plist:Show5GSwitch": true }),
      a5: fiveG("a5", att, {}),
    });
    const configs = new Map<string, IndexModemConfig>([
      ["q", { sha: "q", selection: [], base: null, radio: "lte" }],
      ["s", { sha: "s", selection: [], base: null, radio: "nr" }],
      ["m", { sha: "m", selection: [], base: null, radio: "unread" }],
    ]);
    const modem = (family: "qualcomm" | "shannon" | "mediatek", devices: string[], sha: string) => ({ family, firmware: family, devices, configs: { A: sha } });
    const rs: Release[] = [
      { platform: "ios", id: "24A1", version: "27.0", label: "27.0", prerelease: false, devices: ["iPhone10,1", "iPhone12,8", "iPhone13,2", "iPhone18,1"], extractedAt: "x", modems: [], sources: { "ios:carrier:ATT_US": { sha: "i5", cid: "c5", version: "73.0", size: 1 } } },
      { platform: "android", id: "CP3A.1", version: "16", patch: "2026-09", devices: ["tokay", "flame", "cubs"], extractedAt: "x", carrierList: "l",
        modems: [modem("shannon", ["tokay"], "s"), modem("qualcomm", ["flame"], "q"), modem("mediatek", ["cubs"], "m")], sources: {
          "android:carrier:att_us": [{ sha: "a5", version: "9", size: 1, devices: ["tokay", "flame", "cubs"] }],
        } },
    ];
    const { phoneStates, phones } = buildIndexes({ releases: rs, otaFiles: [], devices: DEVICES, labels: [], profiles: (sha) => ps.get(sha), manifestSims: {}, modemConfigs: (sha) => configs.get(sha), carrierIds: {} });

    it("lists each current phone's radio; a MediaTek Pixel's configurations do not say, so it keeps 5G", () => {
      // Newest first, by the device records; nothing names them, so each reads as its code.
      expect(phones).toEqual([
        { code: "iPhone18,1", name: "iPhone18,1", platform: "ios", has5G: true },
        { code: "iPhone13,2", name: "iPhone13,2", platform: "ios", has5G: true },
        { code: "iPhone12,8", name: "iPhone12,8", platform: "ios", has5G: false },
        { code: "iPhone10,1", name: "iPhone10,1", platform: "ios", has5G: false },
        { code: "tokay", name: "tokay", platform: "android", has5G: true },
        { code: "flame", name: "flame", platform: "android", has5G: false },
        { code: "cubs", name: "cubs", platform: "android", has5G: true },
      ]);
    });

    it("gives phones without a 5G radio their own groups, with 5G features off", () => {
    const on = { "5g": "on", volte: "on" }, lte = { "5g": "no", volte: "on" };
    const ios = "ios:carrier:ATT_US", android = "android:carrier:att_us";
    // iPhone10,1 and iPhone13,2 read the per-phone variant; iPhone12,8 and the Pixel 4 (flame) have no 5G radio.
    expect(phoneStates).toEqual([
      { device: "iPhone18,1", source: ios, states: on },
      { device: "iPhone13,2", source: ios, states: on },
      { device: "iPhone12,8", source: ios, states: lte },
      { device: "iPhone10,1", source: ios, states: lte },
      { device: "tokay", source: android, states: on },
      { device: "flame", source: android, states: lte },
      { device: "cubs", source: android, states: on },
    ]);
    });
  });

  describe("labels over the data", () => {
    const labels: Label[] = [
      { subject: "device", code: "tokay", field: "name", value: "Pixel 9", origin: "feed", evidence: null },
      { subject: "device", code: "iPhone18,1", field: "name", value: "iPhone 17 Pro", origin: "feed", evidence: null },
      // Google's page lost oriole's first builds and dated it late; a person dates it back.
      { subject: "device", code: "flame", field: "released", value: "2027-01", origin: "human", evidence: null },
      { subject: "carrier", code: "ATT_US", field: "name", value: "AT&T", origin: "model", evidence: null },
      { subject: "modem", code: "Mav25", field: "name", value: "Qualcomm X80", origin: "human", evidence: null },
    ];
    const bbfw = { kind: "bbfw", name: "Mav25-1.bbfw", sha: "0".repeat(64), size: 1, crc32: "0" } as const;
    const rs: Release[] = [
      { platform: "ios", id: "24A1", version: "27.0", label: "27.0", prerelease: false, devices: ["iPhone18,1"], extractedAt: "x", released: "2026-09-15",
        sources: { "ios:carrier:ATT_US": { sha: "i1", cid: "c1", version: "72.1", size: 1 } }, modems: [{ family: "Mav25", devices: ["iPhone18,1"], package: bbfw }, { family: "C1", devices: ["iPhone18,1"], package: bbfw }] },
      { platform: "android", id: "CP3A.1", version: "16", patch: "2026-09", released: "2026-09-02", devices: ["oriole", "flame", "tokay"], extractedAt: "x", carrierList: "l",
        modems: [{ family: "shannon", firmware: "g5", devices: ["oriole", "tokay"], configs: { ATT: "s" } }], sources: {
          "android:carrier:att_us": [{ sha: "a9", version: "9", size: 1, devices: ["oriole", "flame", "tokay"] }],
        } },
    ];
    const configs = new Map<string, IndexModemConfig>([["s", { sha: "s", selection: [{ mccmnc: "310410" }], base: null, radio: "nr" }]]);
    const named = buildIndexes({ releases: rs, otaFiles: [], devices: DEVICES, labels, profiles: (sha) => profiles.get(sha), manifestSims: {}, modemConfigs: (sha) => configs.get(sha), carrierIds: {} });

    it("names phones, and orders them by a person's release day over the feed's", () => {
      expect(named.phones.map((p) => [p.code, p.name])).toEqual([["iPhone18,1", "iPhone 17 Pro"], ["flame", "flame"], ["tokay", "Pixel 9"], ["oriole", "oriole"]]);
      expect(named.releases.find((r) => r.id === "CP3A.1")?.devices).toEqual(["flame", "tokay", "oriole"]);
    });

    it("names a carrier the data names only by a source's name, in its row and its summary", () => {
      expect(named.carriers.map((c) => c.name)).toEqual(["AT&T"]);
      expect(named.docs.map((d) => d.carrier.name)).toEqual(["AT&T"]);
    });

    it("names modem families, by a label or by what the code implies, and a carrier's modems by vendor, newest phone first", () => {
      expect(named.releases.map((r) => r.modemFamilies)).toEqual([
        [{ code: "Mav25", name: "Qualcomm X80 · Mav25" }, { code: "C1", name: "Apple C1" }],
        [{ code: "shannon", name: "Samsung Shannon" }],
      ]);
      expect(named.docs[0]?.modems.map((m) => [m.family, m.devices])).toEqual([[{ code: "shannon", name: "Samsung Shannon" }, ["tokay", "oriole"]]]);
    });

    it("publishes the names of every labelled device and every modem family the releases ship", () => {
      expect(named.names).toEqual([
        { subject: "device", code: "iPhone18,1", name: "iPhone 17 Pro" },
        { subject: "device", code: "tokay", name: "Pixel 9" },
        { subject: "modem", code: "C1", name: "Apple C1" },
        { subject: "modem", code: "Mav25", name: "Qualcomm X80 · Mav25" },
        { subject: "modem", code: "shannon", name: "Samsung Shannon" },
      ]);
    });

    it("keeps a carrier's own name over a model's or a person's, and takes a person's release day over a feed's", () => {
      const n = naming([{ subject: "carrier", code: "X", field: "name", value: "Guess", origin: "human", evidence: null }], DEVICES);
      expect(n.carrier("X", "Own Mobile", true)).toBe("Own Mobile");
      expect(n.carrier("X", "X_US", false)).toBe("Guess");
      expect(n.carrier("Y", "Y_US", false)).toBe("Y_US");
      expect(naming(labels, DEVICES).devices.find((d) => d.code === "flame")?.released).toBe("2027-01");
    });
  });

  it("gives each phone of the current release the feature states of the file it ships", () => {
    expect(out.phoneStates).toEqual([
      { device: "tokay", source: "android:carrier:att_us", states: { volte: "on" } },
      { device: "oriole", source: "android:carrier:att_us", states: { volte: "no" } },
    ]);
  });
});

/** v1's buildTimeline (main:src/lib/server/timeline.ts) for one carrier page, to generate every slug it could produce. */
interface V1Image { build: string; version: string; bundle: { id: string; build: string } }
interface V1Ref { os: string; build: string; url: string; productType?: string }
interface V1Entry { slug: string; build: string; productType?: string; image?: string; source: "image" | "ota"; id?: string }

function v1Timeline(images: readonly V1Image[], refs: readonly V1Ref[]): V1Entry[] {
  const out: V1Entry[] = [];
  for (const img of images) {
    if (out.at(-1)?.id === img.bundle.id) continue;
    out.push({ slug: "ios-" + img.version.trim().replace(/\s+/g, "-"), build: img.bundle.build, image: img.build, source: "image", id: img.bundle.id });
  }
  const seenUrl = new Set<string>();
  for (const r of refs) {
    if (seenUrl.has(r.url)) continue;
    seenUrl.add(r.url);
    const pt = r.productType && r.productType !== "Watch" ? `-${r.productType}` : "";
    out.push({ slug: r.os === "legacy" ? "ota-legacy" : `ota-${r.build}${pt}`, build: r.build, source: "ota", ...(r.productType ? { productType: r.productType } : {}) });
  }
  out.sort((a, b) => Number(!!a.productType) - Number(!!b.productType) || v1CompareVersions(b.build || "0", a.build || "0") || Number(b.source === "image") - Number(a.source === "image"));
  const seen = new Map<string, number>();
  for (const e of out) {
    const n = (seen.get(e.slug) ?? 0) + 1;
    seen.set(e.slug, n);
    if (n > 1) e.slug += e.image ? `-${e.image}` : `-${n}`;
  }
  return out;
}

describe("v1 redirects", () => {
  // Newest first, as v1 read them.
  const images: V1Image[] = [
    { build: "24B10", version: "27.1", bundle: { id: "c73", build: "73.0" } },
    { build: "24A10", version: "27.0", bundle: { id: "c72", build: "72.0" } },
    { build: "24A05", version: "27.0 beta 2", bundle: { id: "c72", build: "72.0" } },
    { build: "24A01", version: "27.0", bundle: { id: "c71", build: "71.0" } },
  ];
  // Newest OS first, as v1's carrierRefs sorted them.
  const v1Refs: V1Ref[] = [
    { os: "27.0", build: "72.1", url: "u/72.1/a" },
    { os: "26.4", build: "72.1", url: "u/72.1/b" },
    { os: "26.4", build: "71.1", url: "u/71.1" },
    { os: "iPhone 1", build: "1.1", url: "u/fam", productType: "iPhone" },
    { os: "13.4", build: "41.1", url: "u/ipad", productType: "iPad" },
    { os: "12.0", build: "33.2", url: "u/i71", productType: "iPhone7,1" },
    { os: "legacy", build: "1.0", url: "u/legacy" },
  ];
  const releases: AppleRelease[] = images.map((img, i) => ({
    platform: "ios", id: img.build, version: img.version.split(" ")[0] ?? img.version, label: img.version, prerelease: img.version.includes("beta"),
    devices: [], extractedAt: "x", modems: [], released: `2026-0${9 - i}-01`,
    sources: { [KEY]: { sha: `sha-${img.build}`, cid: img.bundle.id, version: img.bundle.build, size: 1 } },
  }));
  const otaFiles: OtaFile[] = [...v1Refs.map((r, i) => {
    const source: SourceKey = r.productType === "iPad" ? "ipados:carrier:Test_US" : KEY;
    const model = r.productType?.includes(",") ? { model: r.productType } : {};
    return file(r.build, r.url, [listing(r.os === "legacy" ? null : r.os, { source, ...model })], { published: `2025-0${i + 1}-01` });
  }),
  file("12.1", "u/watch", [listing("Watch 9", { source: "watchos:carrier:Test_US" })]),
  file("15.0", "u/country", [listing("26.0", { source: "ios:country:Testland" })]),
  ];
  const out = buildIndexes({ releases, otaFiles, devices: DEVICES, labels: [], profiles: () => undefined, manifestSims: {}, modemConfigs: () => undefined, carrierIds: {} });
  const routes = new Map(out.legacy.map((r) => [r.from, r.to]));

  it("resolves every slug v1 produced", () => {
    const v1 = v1Timeline(images, v1Refs).map((e) => e.slug);
    expect(v1.length).toBe(10);
    expect(v1.filter((s) => !routes.has(`/carriers/Test_US/${s}`))).toEqual([]);
    expect(routes.get("/carriers/Test_US")).toBe("/ios/carriers/Test_US");
  });

  it("covers v1's Watch and country pages", () => {
    expect(routes.get("/watch/Test_US")).toBe("/watchos/carriers/Test_US");
    expect(routes.get("/watch/Test_US/ota-12.1")).toBe("/watchos/carriers/Test_US/12.1");
    expect(routes.get("/countries/Testland")).toBe("/ios/countries/Testland");
    expect(routes.get("/countries/Testland/ota-15.0")).toBe("/ios/countries/Testland/15.0");
  });

  it("points model and iPad files at their own line and platform", () => {
    expect(routes.get("/carriers/Test_US/ota-33.2-iPhone7,1")).toBe("/ios/carriers/Test_US/iPhone7,1/33.2");
    expect(routes.get("/carriers/Test_US/ota-41.1-iPad")).toBe("/ipados/carriers/Test_US/41.1");
    expect(routes.get("/carriers/Test_US/ios-27.0")).toBe("/ios/carriers/Test_US/72.0");
    // Two files of 72.1: v1 numbered them by OS key; v2 names the older by its publication day.
    expect(routes.get("/carriers/Test_US/ota-72.1")).toBe("/ios/carriers/Test_US/72.1@2025-01-01");
    expect(routes.get("/carriers/Test_US/ota-72.1-2")).toBe("/ios/carriers/Test_US/72.1");
  });
});
