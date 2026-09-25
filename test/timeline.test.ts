import { describe, it, expect } from "vitest";
import { buildTimeline, headIndex, type ImageIndex } from "../src/lib/server/timeline.ts";
import type { BundleRef, CountrySummary } from "../src/lib/server/manifest.ts";

const image = (version: string, build: string, carriers: Record<string, [string, string]>, countries: Record<string, [string, string]> = {}): ImageIndex => ({
  version, build, device: "iPhone", extractedAt: "",
  carriers: Object.fromEntries(Object.entries(carriers).map(([k, [id, b]]) => [k, { id, size: 1, build: b }])),
  countries: Object.fromEntries(Object.entries(countries).map(([k, [id, b]]) => [k, { id, size: 1, build: b }])),
});
const ota = (os: string, build: string, extra: Partial<BundleRef> = {}): BundleRef =>
  ({ os, build, url: `https://updates.cdn-apple.com/${build}${extra.productType ?? ""}.ipcc`, ...extra });

describe("buildTimeline", () => {
  const images = [
    image("27.0", "24A437", { ATT_US: ["aaa", "70.1"] }, { India: ["i2", "72.0"] }),
    image("26.4", "23E1", { ATT_US: ["aaa", "70.1"] }, { India: ["i1", "69.0"] }),
    image("26.0", "23A1", { ATT_US: ["bbb", "66.0"] }),
  ];

  it("collapses consecutive images that carry identical bytes into one entry", () => {
    const t = buildTimeline("carriers", "ATT_US", images, [], []);
    expect(t.map((e) => [e.slug, e.ios, e.build])).toEqual([
      ["ios-27.0", ["26.4", "27.0"], "70.1"],
      ["ios-26.0", ["26.0"], "66.0"],
    ]);
    expect(t.every((e) => e.source === "image" && e.src.startsWith("blob:"))).toBe(true);
  });

  it("puts a newer OTA build above the image and an older one below", () => {
    const t = buildTimeline("carriers", "ATT_US", images, [ota("26.5", "71.0"), ota("17.5", "58.1")], []);
    expect(t.map((e) => e.slug)).toEqual(["ota-71.0", "ios-27.0", "ios-26.0", "ota-58.1"]);
  });

  it("lets the image win a tie on build number", () => {
    const t = buildTimeline("carriers", "ATT_US", images, [ota("26.4", "70.1")], []);
    expect(t.map((e) => e.slug)).toEqual(["ios-27.0", "ota-70.1", "ios-26.0"]);
  });

  it("orders builds numerically, not lexically", () => {
    const t = buildTimeline("carriers", "X", [], [ota("9.0", "9.1"), ota("17.0", "58.1"), ota("10.0", "25.1")], []);
    expect(t.map((e) => e.build)).toEqual(["58.1", "25.1", "9.1"]);
  });

  it("merges OTA refs that point at the same file and keeps every iOS key", () => {
    const same = { url: "https://updates.cdn-apple.com/x.ipcc" };
    const t = buildTimeline("carriers", "X", [], [ota("12.1", "34.0", same), ota("12.0", "34.0", same)], []);
    expect(t).toHaveLength(1);
    expect(t[0].ios).toEqual(["12.0", "12.1"]);
  });

  it("sinks per-model variants below plain bundles and gives them distinct slugs", () => {
    const t = buildTimeline("carriers", "X", [], [ota("26.5", "71.0", { productType: "iPad" }), ota("17.5", "58.1")], []);
    expect(t.map((e) => e.slug)).toEqual(["ota-58.1", "ota-71.0-iPad"]);
    expect(new Set(t.map((e) => e.slug)).size).toBe(t.length);
  });

  it("names the 2008-era entry ota-legacy with no iOS key", () => {
    const t = buildTimeline("carriers", "X", [], [ota("legacy", "3.1")], []);
    expect(t[0]).toMatchObject({ slug: "ota-legacy", ios: [] });
  });

  it("keeps Watch refs out of carriers and everything else out of watch", () => {
    const refs = [ota("17.5", "58.1"), ota("Watch 2", "37.1", { productType: "Watch" })];
    expect(buildTimeline("carriers", "ATT_US", images, refs, []).some((e) => e.build === "37.1")).toBe(false);
    const w = buildTimeline("watch", "ATT_US", images, refs, []);
    expect(w.map((e) => [e.slug, e.source])).toEqual([["ota-37.1", "ota"]]);
  });

  it("builds country timelines from images plus iPhone-family OTA country bundles", () => {
    const cdn = [
      { id: "India", family: "iPhone", version: "73.0", minOS: "27.1", url: "https://updates.cdn-apple.com/in.ipcc" },
      { id: "India", family: "Watch", version: "40.0", url: "https://updates.cdn-apple.com/inw.ipcc" },
      { id: "France", family: "iPhone", version: "50.1", url: "https://updates.cdn-apple.com/fr.ipcc" },
    ] as CountrySummary[];
    const t = buildTimeline("countries", "India", images, [], cdn);
    expect(t.map((e) => [e.slug, e.ios])).toEqual([["ota-73.0", ["27.1"]], ["ios-27.0", ["27.0"]], ["ios-26.4", ["26.4"]]]);
  });

  it("does not compare content ids across hashing schemes", () => {
    const a = { ...image("27.0", "24A437", { X: ["same", "70.1"] }), scheme: 2 };
    const b = { ...image("26.4", "23E1", { X: ["same", "70.1"] }), scheme: 1 };
    const t = buildTimeline("carriers", "X", [a, b], [], []);
    // Same id, different scheme: two entries, and "changed" falls back to the build number.
    expect(t.map((e) => [e.slug, e.changed])).toEqual([["ios-27.0", false], ["ios-26.4", true]]);
  });

  it("returns nothing for an unknown name", () => {
    expect(buildTimeline("carriers", "Nope", images, [], [])).toEqual([]);
  });
});

describe("buildTimeline: changed flags and slug uniqueness", () => {
  it("marks an OTA entry with the same build as the image below it as unchanged", () => {
    const images = [image("27.0", "24A437", { X: ["aaa", "70.1"] })];
    const t = buildTimeline("carriers", "X", images, [ota("26.4", "70.1"), ota("17.5", "58.1")], []);
    // ios-27.0 sits above ota-70.1 with the same build: the image adds nothing new.
    expect(t.map((e) => [e.slug, e.changed])).toEqual([["ios-27.0", false], ["ota-70.1", true], ["ota-58.1", true]]);
    const t2 = buildTimeline("carriers", "X", images, [ota("26.4", "70.1")], []);
    expect(t2[0]).toMatchObject({ slug: "ios-27.0", changed: false });
    expect(t2[1]).toMatchObject({ slug: "ota-70.1", changed: true });
  });

  it("keeps slugs unique when two images share an iOS version or two OTA files share a build", () => {
    const images = [image("27.0", "24A500", { X: ["bbb", "70.2"] }), image("27.0", "24A437", { X: ["aaa", "70.1"] })];
    const refs = [ota("17.5", "58.1"), ota("17.6", "58.1", { url: "https://updates.cdn-apple.com/other.ipcc" })];
    const slugs = buildTimeline("carriers", "X", images, refs, []).map((e) => e.slug);
    expect(slugs).toEqual(["ios-27.0", "ios-27.0-24A437", "ota-58.1", "ota-58.1-2"]);
  });
});

describe("contentId", () => {
  it("matches the id the Python packager computes for the same bundle", async () => {
    const { readFileSync } = await import("node:fs");
    const { openIpcc, contentId } = await import("../src/lib/decode/bundle.ts");
    const b = openIpcc(new Uint8Array(readFileSync(new URL("./fixtures/UnitedStates.ipcc", import.meta.url))));
    expect(await contentId(b)).toBe("f419f87a49c354ed92466f53157e4bd7b5fb2f44cbdf566baa48e281ada95e8e");
  });

  it("ignores how the archive was built", async () => {
    const { zipSync, unzipSync } = await import("fflate");
    const { readFileSync } = await import("node:fs");
    const { openIpcc, contentId } = await import("../src/lib/decode/bundle.ts");
    const raw = new Uint8Array(readFileSync(new URL("./fixtures/Germany.ipcc", import.meta.url)));
    const files = unzipSync(raw);
    // Reverse the entry order and store instead of deflate.
    const repacked = zipSync(Object.fromEntries(Object.entries(files).reverse()), { level: 0 });
    expect(await contentId(openIpcc(repacked))).toBe(await contentId(openIpcc(raw)));
    expect(repacked).not.toEqual(raw);
  });
});

describe("guessCarrierQuery", () => {
  const list = ["Verizon_LTE_US", "Verizon_Visible_LTE_US", "TMobile_US", "ATT_US", "ATT_FirstNet_US", "Vodafone_de", "EE_uk", "Orange_fr", "BhartiAirtel_in"]
    .map((name) => ({ name, display: name.replace(/_[A-Za-z]{2}$/, "").replace(/_/g, " ") }));
  const cases: Array<[string | undefined, string | null]> = [
    ["Verizon Business", "verizon"],
    ["T-Mobile USA, Inc.", "tmobile"],
    ["AT&T Mobility LLC", "att"],
    ["Vodafone GmbH", "vodafone"],
    ["Orange S.A.", "orange"],
    ["Bharti Airtel Ltd.", "bhartiairtel"],
    ["EE Limited", null],
    ["Comcast Cable Communications", null],
    ["", null],
    [undefined, null],
  ];
  for (const [org, want] of cases) {
    it(`${JSON.stringify(org)} -> ${JSON.stringify(want)}`, async () => {
      const { guessCarrierQuery } = await import("../src/lib/server/guess.ts");
      expect(guessCarrierQuery(org, list)).toBe(want);
    });
  }
});

describe("carrier and country links", () => {
  const plists = {
    UnitedStates: { ISOAlpha2CountryCode: ["us", "pr"] },
    Australia: { ISOAlpha2CountryCode: ["au", "cx"] },
    ChristmasIsland: { ISOAlpha2CountryCode: ["cx"] },
    Broken: {},
  };

  it("prefers the carrier's own HomeBundleIdentifier", async () => {
    const { homeCountry, isoIndex } = await import("../src/lib/server/related.ts");
    const names = new Set(Object.keys(plists));
    expect(homeCountry({ HomeBundleIdentifier: "com.apple.Australia" }, "us", names, isoIndex(plists))).toBe("Australia");
  });

  it("falls back to the ISO code when the key is missing or names no bundle we hold", async () => {
    const { homeCountry, isoIndex } = await import("../src/lib/server/related.ts");
    const names = new Set(Object.keys(plists)), idx = isoIndex(plists);
    expect(homeCountry({}, "pr", names, idx)).toBe("UnitedStates");
    expect(homeCountry({ HomeBundleIdentifier: "com.apple.Atlantis" }, "au", names, idx)).toBe("Australia");
    expect(homeCountry(undefined, "zz", names, idx)).toBeNull();
    expect(homeCountry(undefined, undefined, names, idx)).toBeNull();
  });

  it("lists a country's carriers by the ISO codes its bundle covers", async () => {
    const { carriersOf } = await import("../src/lib/server/related.ts");
    const carriers = [{ name: "ATT_US", cc: "us" }, { name: "Claro_pr", cc: "pr" }, { name: "Telstra_au", cc: "au" }, { name: "OtherKnown" }];
    expect(carriersOf("UnitedStates", plists, carriers)).toEqual(["ATT_US", "Claro_pr"]);
    expect(carriersOf("Broken", plists, carriers)).toEqual([]);
    expect(carriersOf("Nowhere", plists, carriers)).toEqual([]);
  });
});

describe("betas in the timeline", () => {
  const images = [
    image("27.2 beta 2", "24B5089g", { ATT_US: ["ccc", "72.0"], New_US: ["nnn", "1.0"] }),
    image("27.0", "24A437", { ATT_US: ["aaa", "70.1"] }),
  ];

  it("gives a beta its own slug and marks it, and the default skips it", () => {
    const t = buildTimeline("carriers", "ATT_US", images, [], []);
    expect(t.map((e) => [e.slug, !!e.beta])).toEqual([["ios-27.2-beta-2", true], ["ios-27.0", false]]);
    expect(headIndex(t)).toBe(1);
  });

  it("falls back to the beta when that is all there is", () => {
    const t = buildTimeline("carriers", "New_US", images, [], []);
    expect(headIndex(t)).toBe(0);
  });

  it("is not a beta once a release carries the same bytes", () => {
    const t = buildTimeline("carriers", "ATT_US", [image("27.2", "24B80", { ATT_US: ["ccc", "72.0"] }), ...images], [], []);
    expect(t[0]).toMatchObject({ slug: "ios-27.2", ios: ["27.2 beta 2", "27.2"] });
    expect(t[0].beta).toBeUndefined();
    expect(headIndex(t)).toBe(0);
  });
});
