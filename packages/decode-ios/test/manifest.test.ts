import {
  describe,
  it,
  expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname,
  join } from "node:path";
import { zipSync,
  unzlibSync } from "fflate";

import {
  publishedOn,
  buildIndex,
  buildMccMnc,
  carrierRefs,
  parseManifest,
} from "../src/manifest.ts";
import { compareVersions, versionKey } from "../src/versions.ts";
import type { ManifestIndex } from "../src/manifest.ts";
import type { PlistValue } from "../src/plist.ts";
import { openIpcc, decodeFile, contentTypeOf, decodedPlist, decodedPri } from "../src/bundle.ts";
import { bytesToBase64 } from "@carrier-explode/binary";
import type { OpenedBundle } from "../src/bundle.ts";
import { diffValues, summariseDiff } from "@carrier-explode/values";
import { normalizeApplePng, isPng, isCgBI, pngDimensions } from "../src/png.ts";
import { defined } from "./defined.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", n)));

const enc = new TextEncoder();
const dec = new TextDecoder();
const xmlPlist = (body: string) =>
  enc.encode(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0">${body}</plist>`);

/** Shape the manifest helpers accept. */
type PlistDict = Record<string, PlistValue>;
/** Shape decoded plists come back as. */
type Dict = Record<string, unknown>;

/** Every .ipcc fixture in the repository. */
const FIXTURES = [
  "carrier-att.ipcc",
  "watch-redpocket.ipcc",
  "watch-country-australia.ipcc",
  "carrier-airtel-in.ipcc",
  "carrier-cw-pa.ipcc",
  "carrier-cw-wi.ipcc",
  "country-germany.ipcc",
  "country-us.ipcc",
  "carrier-verizon.ipcc",
  "carrier-att-2009.ipcc",
];

const manifestXml = parseManifest(fixture("manifest.xml")) as PlistDict;
const manifestBin = parseManifest(fixture("manifest.bplist")) as PlistDict;
const index = buildIndex(manifestXml);


describe("manifest version helpers", () => {
  it("splits a dotted version into numeric segments", () => {
    expect(versionKey("26.4")).toEqual([26, 4]);
    expect(versionKey("10.3.2")).toEqual([10, 3, 2]);
    expect(versionKey("0")).toEqual([0]);
  });

  it("maps non-numeric segments to -1 so they sort below every real release", () => {
    expect(versionKey("legacy")).toEqual([-1]);
    expect(versionKey("")).toEqual([-1]);
    expect(versionKey("Watch 1")).toEqual([-1]);
    expect(compareVersions("legacy", "3.1")).toBeLessThan(0);
    expect(compareVersions("legacy", "0")).toBeLessThan(0);
  });

  it("orders numerically, not lexically", () => {
    expect(["9.3", "10.0", "26.5", "18.5", "6.1"].sort(compareVersions)).toEqual([
      "6.1",
      "9.3",
      "10.0",
      "18.5",
      "26.5",
    ]);
    // 26.9 < 26.10 numerically; lexically it would be the other way round.
    expect(compareVersions("26.9", "26.10")).toBeLessThan(0);
    expect(compareVersions("9.3", "10.0")).toBeLessThan(0);
  });

  it("treats a missing trailing segment as zero", () => {
    expect(compareVersions("26", "26.4")).toBeLessThan(0);
    expect(compareVersions("26.4", "26")).toBeGreaterThan(0);
    expect(compareVersions("26", "26.0")).toBe(0);
    expect(compareVersions("26.0.0", "26")).toBe(0);
  });

  it("is reflexive, antisymmetric and stable under repeated sorting", () => {
    const input = ["9.3", "10.0", "26.5", "2.0", "legacy", "26.10", "26.9"];
    for (const a of input) expect(compareVersions(a, a)).toBe(0);
    for (const a of input) {
      for (const b of input) {
        expect(Math.sign(compareVersions(a, b)) + Math.sign(compareVersions(b, a))).toBe(0);
      }
    }
    const once = [...input].sort(compareVersions);
    expect(once).toEqual(["legacy", "2.0", "9.3", "10.0", "26.5", "26.9", "26.10"]);
    expect([...once].sort(compareVersions)).toEqual(once);
  });

  it("collapses every non-numeric label into one equivalence class", () => {
    // Both are [-1], so carrierRefs cannot separate two differently-labelled
    // non-numeric entries by version alone.
    expect(compareVersions("legacy", "Watch 1")).toBe(0);
    expect(compareVersions("Watch 1", "Watch 2")).toBe(0);
  });
});


describe("parseManifest", () => {
  it("returns the root dictionary of the real manifest", () => {
    expect(Object.keys(manifestXml).sort()).toEqual([
      "CarrierBundleSignatures",
      "CarrierBundles",
      "CountryBundleSignatures",
      "CountryBundles",
      "MobileDeviceCarrierBundles",
      "MobileDeviceCarrierBundlesByProductVersion",
      "MobileDeviceCarriers",
      "MobileDeviceCarriersByCarrierID",
      "MobileDeviceCarriersByMccMnc",
      "iTunesMacVersion",
    ]);
    expect(manifestXml.iTunesMacVersion).toBe("12.8.1");
  });

  it("rejects a plist whose root is not a dictionary", () => {
    expect(() => parseManifest(xmlPlist("<array/>"))).toThrow(/not a dictionary/);
    expect(() => parseManifest(xmlPlist("<string>x</string>"))).toThrow(/not a dictionary/);
    expect(() => parseManifest(xmlPlist("<integer>1</integer>"))).toThrow(/not a dictionary/);
    expect(() => parseManifest(xmlPlist("<array><dict/></array>"))).toThrow(/not a dictionary/);
  });

  it("rejects bytes that are neither XML nor a binary plist", () => {
    expect(() => parseManifest(new Uint8Array(0))).toThrow(/not a dictionary/);
    expect(() => parseManifest(enc.encode("definitely not a plist"))).toThrow(/not a dictionary/);
  });
});


describe("buildIndex carriers", () => {
  it("lists exactly the carriers present in the trimmed manifest", () => {
    expect(index.carriers.map((c) => c.name)).toEqual([
      "1and1_de",
      "8ta_za",
      "ATT_US",
      "BhartiAirtel_in",
      "CW_wi",
      "TMobile_US",
      "True_th",
      "Verizon_LTE_US",
    ]);
  });

  it("excludes the bare `signature` key, whose value is raw bytes rather than a dict", () => {
    // MobileDeviceCarrierBundlesByProductVersion carries a 128-byte `signature`
    // sibling alongside the carrier names.
    const byVer = manifestXml.MobileDeviceCarrierBundlesByProductVersion as Dict;
    expect(byVer.signature).toBeInstanceOf(Uint8Array);
    expect((byVer.signature as Uint8Array).length).toBe(128);
    expect(Object.keys(byVer)).toContain("signature");
    expect(index.carriers.map((c) => c.name)).not.toContain("signature");
    expect(carrierRefs(manifestXml, "signature")).toEqual([]);
  });

  it("sorts each carrier's iOS versions numerically", () => {
    const att = index.carriers.find((c) => c.name === "ATT_US")!;
    expect(att.versions).toEqual([
      "3.1", "6.1", "8.0", "8.3", "9.2", "9.3", "10.0", "10.2", "10.3", "10.3.2",
      "11.0", "11.1", "11.2", "12.0", "13.1", "13.2", "13.4", "14.0", "14.1",
      "14.5", "14.6", "15.0", "17.5",
    ]);
    expect(att.versions.indexOf("9.3")).toBeLessThan(att.versions.indexOf("10.0"));
    const tmo = index.carriers.find((c) => c.name === "TMobile_US")!;
    expect(tmo.versions.indexOf("9.3")).toBeLessThan(tmo.versions.indexOf("10.0"));
    expect(tmo.versions.indexOf("17.4")).toBeLessThan(tmo.versions.indexOf("26.4"));
    expect(tmo.versions[tmo.versions.length - 1]).toBe("27.0");
  });

  it("takes latestBuild from the numerically newest version, not the last plist key", () => {
    const latest = Object.fromEntries(index.carriers.map((c) => [c.name, c.latestBuild]));
    expect(latest).toEqual({
      "1and1_de": "70.1",
      "8ta_za": "25.1",
      ATT_US: "58.1",
      BhartiAirtel_in: "39.1",
      CW_wi: "66.1",
      TMobile_US: "72.1",
      True_th: undefined,
      // Verizon publishes a three-segment build number.
      Verizon_LTE_US: "69.1.0",
    });
  });

  it("gathers productTypes out of ByProductType", () => {
    const att = index.carriers.find((c) => c.name === "ATT_US")!;
    // "iPhone" is only the FallbackToByProductVersion marker, so it is excluded.
    expect(att.productTypes).toEqual(["iPad", "iPhone7,1", "iPhone7,2"]);
    // CW_wi carries nothing but that marker.
    expect(index.carriers.find((c) => c.name === "CW_wi")!.productTypes).toEqual([]);
    expect(index.carriers.find((c) => c.name === "8ta_za")!.productTypes).toEqual(["iPad"]);
    // True_th has no ByProductVersion entry at all.
    expect(index.carriers.find((c) => c.name === "True_th")!.productTypes).toEqual([]);
  });

  it("ignores the FallbackToByProductVersion marker, which has no bundles of its own", () => {
    const byVer = manifestXml.MobileDeviceCarrierBundlesByProductVersion as Dict;
    const cw = (byVer.CW_wi as Dict).ByProductType as Dict;
    expect(cw.iPhone).toEqual({ FallbackToByProductVersion: true });
    expect(index.carriers.find((c) => c.name === "CW_wi")!.productTypes).not.toContain("iPhone");
    // carrierRefs yields nothing for it either.
    expect(carrierRefs(manifestXml, "CW_wi").filter((r) => r.productType)).toEqual([]);
  });

  it("flags the legacy-only carrier and keeps it in the list with no versions", () => {
    const legacyOnly = index.carriers.find((c) => c.name === "True_th")!;
    expect(legacyOnly).toEqual({
      name: "True_th",
      versions: [],
      latestBuild: undefined,
      productTypes: [],
      hasLegacy: true,
    });
    expect(index.carriers.filter((c) => c.hasLegacy).map((c) => c.name)).toEqual([
      "ATT_US",
      "BhartiAirtel_in",
      "True_th",
    ]);
  });

  it("reports section counts straight off the root dictionary", () => {
    expect(index.counts).toEqual({
      // 7 carrier dicts plus the bogus `signature` key
      MobileDeviceCarrierBundlesByProductVersion: 8,
      MobileDeviceCarrierBundles: 3,
      MobileDeviceCarriersByMccMnc: 6,
      MobileDeviceCarriers: 12,
      MobileDeviceCarriersByCarrierID: 32,
      carriers: 8,
      countryBundles: 6,
      watchCountryBundles: 1,
      watchCarriers: 4,
    });
    expect(index.iTunesVersion).toBe("12.8.1");
  });

  it("survives an empty root without throwing", () => {
    const empty = buildIndex({});
    expect(empty.carriers).toEqual([]);
    expect(empty.countries).toEqual([]);
    expect(empty.otherKnown).toEqual([]);
    expect(empty.watchCarriers).toEqual([]);
    expect(empty.iTunesVersion).toBe("");
    expect(empty.counts.carriers).toBe(0);
  });
});

describe("buildIndex country bundles", () => {
  it("resolves both families through BundleMappings.BundleMatchEntry", () => {
    expect(index.countries.map((c) => `${c.family}/${c.key}@${c.version}`)).toEqual([
      "Watch/Australia_1@39.1",
      "iPhone/Australia_1@69.1",
      "iPhone/Germany_1@50.1",
      "iPhone/Germany_2@64.1",
      "iPhone/Netherlands_1@58.1",
      "iPhone/Netherlands_2@64.1",
      "iPhone/UnitedStates_1@58.1",
    ]);
    expect(index.countries.filter((c) => c.family === "iPhone")).toHaveLength(6);
    expect(index.countries.filter((c) => c.family === "Watch")).toHaveLength(1);
  });

  it("carries OS.Min across from the mapping slot", () => {
    const minOS = Object.fromEntries(index.countries.map((c) => [`${c.family}/${c.key}`, c.minOS]));
    expect(minOS).toEqual({
      "Watch/Australia_1": "26.4",
      "iPhone/Australia_1": "26.4",
      "iPhone/Germany_1": "15.6",
      "iPhone/Germany_2": "18.5",
      "iPhone/Netherlands_1": "17.4",
      "iPhone/Netherlands_2": "18.5",
      "iPhone/UnitedStates_1": "17.4",
    });
  });

  it("keeps multiple versions of the same country as distinct entries", () => {
    const germany = index.countries.filter((c) => c.id === "Germany");
    expect(germany).toHaveLength(2);
    expect(germany.map((c) => c.version)).toEqual(["50.1", "64.1"]);
    expect(new Set(germany.map((c) => c.url)).size).toBe(2);
    expect(germany.every((c) => c.bundleId === "Germany")).toBe(true);
    const netherlands = index.countries.filter((c) => c.id === "Netherlands");
    expect(netherlands.map((c) => c.key)).toEqual(["Netherlands_1", "Netherlands_2"]);
  });

  it("populates mccs by reverse lookup through CountryId.BundleMapKey", () => {
    const us = index.countries.find((c) => c.id === "UnitedStates")!;
    expect(us.countryIds).toEqual([
      "310", "311", "312", "313", "314", "315", "316", "com.apple.UnitedStates",
    ]);
    expect(index.countries.find((c) => c.id === "Germany")!.countryIds).toEqual([
      "262",
      "com.apple.Germany",
    ]);
    expect(index.countries.find((c) => c.id === "Netherlands")!.countryIds).toEqual([
      "204",
      "com.apple.Netherlands",
    ]);
  });

  it("includes the reverse-DNS CountryId aliases alongside the numeric MCCs", () => {
    // CountryId is keyed by MCC *and* by com.apple.<Country>; the field is
    // named `mccs` but carries both kinds of key.
    for (const c of index.countries) {
      expect(c.countryIds.some((m: string) => m.startsWith("com.apple."))).toBe(true);
    }
  });

  it("gives the Watch and iPhone editions of one country their own entries", () => {
    const au = index.countries.filter((c) => c.id === "Australia");
    expect(au.map((c) => c.family)).toEqual(["Watch", "iPhone"]);
    expect(au[0]?.url).toContain("Australia_Watch.ipcc");
    expect(au[1]?.url).toContain("Australia_iPhone.ipcc");
    expect(au[0]?.countryIds).toEqual(["505", "com.apple.Australia"]);
  });

  it("gives every country entry a usable URL and a version", () => {
    for (const c of index.countries) {
      expect(c.url).toMatch(/^https?:\/\/\S+\.ipcc$/);
      expect(c.version).toMatch(/^\d+(\.\d+)*$/);
      expect(c.id).toBe(c.bundleId);
    }
  });
});

describe("buildIndex otherKnown and watch carriers", () => {
  it("reads CarrierBundles.iPhone.OtherKnownSettings", () => {
    expect(index.otherKnown).toHaveLength(2);
    expect(index.otherKnown.map((r) => [r.os, r.build, r.family])).toEqual([
      ["17.4", "58.1", "iPhone"],
      ["18.0", "59.1", "iPhone"],
    ]);
    for (const r of index.otherKnown) {
      expect(r.url).toContain("OtherKnown_iPhone.ipcc");
      // Apple puts the long digest under the plain Digest key here; it is
      // routed by length, so it surfaces as digest3.
      expect(r.digest).toBeUndefined();
      expect(r.digest3).toMatch(/^[0-9a-f]{96}$/);
    }
  });

  it("collapses CarrierBundles.Watch.Bundles by BundleID", () => {
    expect(index.watchCarriers.map((c) => c.name)).toEqual([
      "1and1_de",
      "BhartiAirtel_in",
      "TMobile_US",
      "Verizon_LTE_US",
    ]);
    const oneAndOne = index.watchCarriers.find((c) => c.name === "1and1_de")!;
    expect(oneAndOne.versions).toEqual(["25.1", "37.1"]);
    expect(oneAndOne.latestBuild).toBe("37.1");
    for (const c of index.watchCarriers) {
      expect(c.productTypes).toEqual(["Watch"]);
      expect(c.hasLegacy).toBe(false);
    }
  });
});


describe("carrierRefs", () => {
  const att = carrierRefs(manifestXml, "ATT_US");

  it("returns every published ref across ByProductVersion, ByProductType and legacy", () => {
    // 23 ByProductVersion + 4 iPad + 12 iPhone7,1 + 12 iPhone7,2 + 1 legacy
    expect(att).toHaveLength(52);
  });

  it("gives every ref a usable URL and a build", () => {
    for (const r of att) {
      expect(r.url).toMatch(/^https?:\/\/\S+\.ipcc$/);
      expect(r.build).toMatch(/^\d+(\.\d+)*$/);
      expect(typeof r.os).toBe("string");
      expect(r.os.length).toBeGreaterThan(0);
    }
  });

  it("tags ByProductType refs with their product type and leaves plain refs untagged", () => {
    const iPad = att.filter((r) => r.productType === "iPad");
    expect(iPad).toHaveLength(4);
    expect(iPad.map((r) => r.os).sort(compareVersions)).toEqual(["6.1", "11.1", "13.3", "13.4"]);
    for (const r of iPad) expect(r.url).toContain("ATT_US_iPad.ipcc");
    expect(att.filter((r) => r.productType === "iPhone7,1")).toHaveLength(12);
    expect(att.filter((r) => r.productType === "iPhone7,2")).toHaveLength(12);
    // The FallbackToByProductVersion marker contributes no refs.
    expect(att.filter((r) => r.productType === "iPhone")).toHaveLength(0);
    expect(att.find((r) => r.os === "17.5")!.productType).toBeUndefined();
  });

  it("includes the legacy MobileDeviceCarrierBundles entry as os === legacy", () => {
    const legacy = att.filter((r) => r.os === "legacy");
    expect(legacy).toHaveLength(1);
    expect(legacy[0]?.build).toBe("3.1");
    expect(legacy[0]?.url).toContain("061-4732.20090203.gj3ef");
    expect(legacy[0]?.digest).toBeUndefined();
    expect(carrierRefs(manifestXml, "True_th")).toEqual([
      {
        os: "legacy",
        build: "3.1",
        url: "http://appldnld.apple.com.edgesuite.net/content.info.apple.com/iPhone/CarrierBundles/061-5960.20090203.67tgr/True_th.ipcc",
        digest: undefined,
        digest3: undefined,
        productType: undefined,
      },
    ]);
  });

  it("exposes both digest widths where the manifest publishes them", () => {
    const newest = att[0];
    expect(newest?.os).toBe("17.5");
    expect(newest?.build).toBe("58.1");
    expect(newest?.digest).toMatch(/^[0-9a-f]{40}$/);
    expect(newest?.digest3).toMatch(/^[0-9a-f]{96}$/);
    // Older entries publish only the 20-byte Digest.
    const old = att.find((r) => r.os === "15.0")!;
    expect(old.digest).toMatch(/^[0-9a-f]{40}$/);
    expect(old.digest3).toBeUndefined();
  });

  it("orders numeric OS keys newest first", () => {
    const numeric = att.filter((r) => r.os !== "legacy").map((r) => r.os);
    for (let i = 1; i < numeric.length; i++) {
      expect(compareVersions(defined(numeric[i - 1]), defined(numeric[i]))).toBeGreaterThanOrEqual(0);
    }
    expect(numeric[0]).toBe("17.5");
    expect(att[att.length - 1]?.os).toBe("legacy");
  });

  it("includes CarrierBundles.Watch entries, labelled `Watch <slot>`", () => {
    const refs = carrierRefs(manifestXml, "1and1_de");
    expect(refs).toHaveLength(7);
    const watch = refs.filter((r) => r.family === "Watch");
    expect(watch.map((r) => [r.os, r.build])).toEqual([
      ["Watch 2", "37.1"],
      ["Watch 1", "25.1"],
    ]);
    for (const r of watch) expect(r.url).toContain("1and1_de_Watch.ipcc");
    expect(refs.filter((r) => r.family === undefined && r.productType === undefined).map((r) => r.os)).toEqual([
      "26.5",
      "26.2",
      "18.5",
      "17.0",
    ]);
  });

  // BUG: carrierRefs is documented "newest first", but CarrierBundles.Watch
  // refs are labelled "Watch <n>" and versionKey("Watch 2") is [-1], so every
  // Watch ref sorts below every numeric iOS key regardless of age.
  // Repro: carrierRefs(root, "1and1_de") puts the Dec-2025 Watch 37.1 bundle
  // after the Sep-2023 iOS 17.0 bundle.
  it.fails("orders a 2025 Watch bundle above a 2023 iPhone bundle", () => {
    const refs = carrierRefs(manifestXml, "1and1_de");
    const watch2 = refs.findIndex((r) => r.os === "Watch 2");
    const ios17 = refs.findIndex((r) => r.os === "17.0");
    expect(watch2).toBeLessThan(ios17);
  });

  it("returns an empty list for an unknown carrier and for an empty root", () => {
    expect(carrierRefs(manifestXml, "Nope_xx")).toEqual([]);
    expect(carrierRefs({}, "ATT_US")).toEqual([]);
  });
});


describe("buildMccMnc", () => {
  const { entries, carrierIds, iccids } = buildMccMnc(manifestXml);
  const byPlmn = Object.fromEntries(entries.map((e) => [e.plmn, e]));

  it("builds one row per MobileDeviceCarriersByMccMnc key, sorted", () => {
    expect(entries).toHaveLength(6);
    expect(new Set(entries.map((e) => e.plmn)).size).toBe(6);
    expect(entries.map((e) => e.plmn)).toEqual([...entries.map((e) => e.plmn)].sort());
  });

  it("does not duplicate a PLMN", () => {
    const byMcc = manifestXml.MobileDeviceCarriersByMccMnc as Dict;
    expect(Object.keys(byMcc)).toHaveLength(6);
    for (const plmn of Object.keys(byMcc)) {
      expect(entries.filter((e) => e.plmn === plmn)).toHaveLength(1);
    }
  });

  it("splits MCC/MNC for 2-digit and 3-digit MNCs", () => {
    expect([byPlmn["20404"]?.mcc, byPlmn["20404"]?.mnc]).toEqual(["204", "04"]);
    expect([byPlmn["20408"]?.mcc, byPlmn["20408"]?.mnc]).toEqual(["204", "08"]);
    expect([byPlmn["204043"]?.mcc, byPlmn["204043"]?.mnc]).toEqual(["204", "043"]);
    expect([byPlmn["310410"]?.mcc, byPlmn["310410"]?.mnc]).toEqual(["310", "410"]);
    expect([byPlmn["311480"]?.mcc, byPlmn["311480"]?.mnc]).toEqual(["311", "480"]);
  });

  it("keeps the BundleName where the entry has one", () => {
    expect(byPlmn["20404"]?.bundle).toBe("Vodafone_nl");
    expect(byPlmn["20408"]?.bundle).toBe("KPN_nl");
  });

  it("handles entries that carry MVNOs but no BundleName", () => {
    for (const plmn of ["20433", "204043", "310410", "311480"]) {
      expect(byPlmn[plmn]?.bundle).toBeUndefined();
      expect(byPlmn[plmn]?.mvnos.length).toBeGreaterThan(0);
    }
    expect(byPlmn["20433"]?.mvnos.map((m) => m.bundle)).toEqual([
      "Truphone_US",
      "Bootstrap_Truphone_US",
    ]);
  });

  it("discriminates MVNO sub-entries by ICCID, GID1 and GID2", () => {
    const vodafone = byPlmn["20404"]?.mvnos;
    expect(vodafone).toHaveLength(27);

    const iccidOnly = vodafone?.find((m) => m.bundle === "Bell_ca")!;
    expect(iccidOnly).toEqual({
      bundle: "Bell_ca",
      iccid: "89302610",
      gid1: undefined,
      gid2: undefined,
    });

    const gid1Only = vodafone?.find((m) => m.bundle === "GigSky_US")!;
    expect(gid1Only).toEqual({ bundle: "GigSky_US", iccid: undefined, gid1: "6F", gid2: undefined });

    // Verizon's resellers are told apart by GID2 *and* a shared ICCID prefix.
    const comcast = vodafone?.find((m) => m.bundle === "Verizon_Comcast_LTE_US")!;
    expect(comcast).toEqual({
      bundle: "Verizon_Comcast_LTE_US",
      iccid: "891480",
      gid1: undefined,
      gid2: "A3",
    });
    const charter = vodafone?.find((m) => m.bundle === "Verizon_Charter_LTE_US")!;
    expect(charter.gid2).toBe("A7");
    expect(charter.iccid).toBe("891480");

    // ICCID + GID1 together.
    const both = vodafone?.find((m) => m.bundle === "TMobile_Vodafone_US")!;
    expect(both).toEqual({
      bundle: "TMobile_Vodafone_US",
      iccid: "89012608611",
      gid1: "28",
      gid2: undefined,
    });
  });

  it("keeps GID2-only MVNOs and repeated bundle names under one PLMN", () => {
    const vz = byPlmn["311480"]?.mvnos;
    expect(vz).toHaveLength(28);
    expect(vz?.every((m) => m.gid2 !== undefined && m.iccid === undefined)).toBe(true);
    // Verizon_MVNO_US appears many times, once per GID2 value.
    const mvno = vz?.filter((m) => m.bundle === "Verizon_MVNO_US");
    expect(mvno?.length).toBeGreaterThan(10);
    expect(new Set(mvno?.map((m) => m.gid2)).size).toBe(mvno?.length);
    expect(vz?.find((m) => m.gid2 === "B100000000000000")!.bundle).toBe("Verizon_Cox_LTE_US");
  });

  it("uses GID1 to split AT&T's own MVNOs", () => {
    const att = byPlmn["310410"]?.mvnos;
    expect(att).toHaveLength(12);
    expect(att?.every((m) => m.gid1 !== undefined)).toBe(true);
    expect(att?.find((m) => m.gid1 === "FFFF")!.bundle).toBe("ATT_US");
    expect(att?.filter((m) => m.bundle === "ATT_Dish_MVNO_US").map((m) => m.gid1)).toEqual([
      "3432",
      "3436",
      "3434",
    ]);
  });

  it("keeps MobileDeviceCarriers out of the PLMN table, because it is keyed by ICCID", () => {
    // MobileDeviceCarriers is keyed by ICCID prefix (890.../891.../892...), not
    // by PLMN, so an mcc/mnc split of those keys would be meaningless.
    for (const iccid of ["890100", "89010700", "8901980"]) {
      expect(byPlmn[iccid]).toBeUndefined();
    }
    expect(entries.every((e) => e.plmn.length <= 6)).toBe(true);
  });

  it("returns the ICCID prefix map as its own sorted lookup", () => {
    expect(iccids).toHaveLength(12);
    expect(iccids.find(([prefix]) => prefix === "890100")).toEqual(["890100", "GTA_gu"]);
    expect(iccids.filter(([, bundle]) => bundle === "ATT_US").map(([prefix]) => prefix)).toEqual([
      "8901150",
      "8901180",
      "8901410",
      "8901980",
    ]);
    expect(iccids.map(([p]) => p)).toEqual([...iccids.map(([p]) => p)].sort());
  });

  it("returns MobileDeviceCarriersByCarrierID pairs sorted by carrier id", () => {
    expect(carrierIds).toHaveLength(32);
    expect(carrierIds[0]).toEqual(["310ALK", "AlaskaWireless_US"]);
    expect(carrierIds[carrierIds.length - 1]).toEqual(["330OPM", "OpenMobile_pr"]);
    expect(carrierIds.map(([id]) => id)).toEqual([...carrierIds.map(([id]) => id)].sort());
    expect(carrierIds.find(([id]) => id === "310VZW")).toEqual(["310VZW", "Zeppelin_US"]);
    for (const [id, bundle] of carrierIds) {
      expect(id).toMatch(/^\d{3}[A-Z]{3}$/);
      expect(typeof bundle).toBe("string");
    }
  });

  it("returns empty results for an empty root", () => {
    expect(buildMccMnc({})).toEqual({ entries: [], carrierIds: [], iccids: [] });
  });
});


describe("manifest XML and binary parity", () => {
  const stripClock = (i: ManifestIndex) => ({ ...i, fetchedAt: "" });

  it("parses the same top-level structure from both encodings", () => {
    expect(Object.keys(manifestBin).sort()).toEqual(Object.keys(manifestXml).sort());
    expect(manifestBin.iTunesMacVersion).toBe(manifestXml.iTunesMacVersion);
    expect(
      (manifestBin.MobileDeviceCarrierBundlesByProductVersion as Dict).signature,
    ).toBeInstanceOf(Uint8Array);
  });

  it("produces a deeply equal buildIndex from the .xml and the .bplist fixture", () => {
    const a = stripClock(buildIndex(manifestXml));
    const b = stripClock(buildIndex(manifestBin));
    expect(b).toEqual(a);
    // toEqual is forgiving about undefined-valued keys; pin the serialisation too.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("produces identical carrierRefs from both encodings, digests included", () => {
    for (const name of ["ATT_US", "1and1_de", "True_th", "Verizon_LTE_US", "CW_wi"]) {
      expect(carrierRefs(manifestBin, name)).toEqual(carrierRefs(manifestXml, name));
    }
    expect(carrierRefs(manifestBin, "ATT_US")[0]?.digest3).toBe(
      carrierRefs(manifestXml, "ATT_US")[0]?.digest3,
    );
  });

  it("produces identical MCC/MNC tables from both encodings", () => {
    expect(buildMccMnc(manifestBin)).toEqual(buildMccMnc(manifestXml));
  });
});


describe("openIpcc", () => {
  it("pulls the bundle name out of the Payload/<Name>.bundle/ prefix", () => {
    expect(openIpcc(fixture("carrier-att.ipcc")).info.bundleName).toBe("ATT_US");
    expect(openIpcc(fixture("carrier-verizon.ipcc")).info.bundleName).toBe("Verizon_LTE_US");
    expect(openIpcc(fixture("country-us.ipcc")).info.bundleName).toBe("UnitedStates");
    expect(openIpcc(fixture("country-germany.ipcc")).info.bundleName).toBe("Germany");
    expect(openIpcc(fixture("carrier-cw-wi.ipcc")).info.bundleName).toBe("CW_wi");
    expect(openIpcc(fixture("carrier-cw-pa.ipcc")).info.bundleName).toBe("CW_pa");
    expect(openIpcc(fixture("carrier-airtel-in.ipcc")).info.bundleName).toBe("BhartiAirtel_in");
    // The Watch country bundle ships under the plain country name.
    expect(openIpcc(fixture("watch-country-australia.ipcc")).info.bundleName).toBe("Australia");
    // The 2009 bundle is named after the carrier, like the modern ones.
    expect(openIpcc(fixture("carrier-att-2009.ipcc")).info.bundleName).toBe("ATT_US");
  });

  it("records the zip prefix and strips it off every listed path", () => {
    const b = openIpcc(fixture("carrier-att.ipcc"));
    expect(b.prefix).toBe("Payload/ATT_US.bundle/");
    for (const f of b.info.files) {
      expect(f.path.startsWith("Payload/")).toBe(false);
      expect(b.entries[b.prefix + f.path]).toBeInstanceOf(Uint8Array);
    }
  });

  it("excludes directory entries from the file list", () => {
    const b = openIpcc(fixture("carrier-att.ipcc"));
    const keys = Object.keys(b.entries);
    expect(keys).toHaveLength(155);
    expect(keys.filter((k) => k.endsWith("/"))).toHaveLength(45);
    expect(keys.filter((k) => !k.endsWith("/"))).toHaveLength(110);
    expect(b.info.files).toHaveLength(110);
    expect(b.info.files.filter((f) => f.path.endsWith("/"))).toHaveLength(0);
  });

  it("excludes __MACOSX and .DS_Store members", () => {
    const zip = zipSync(
      {
        "Payload/Test_xx.bundle/carrier.plist": xmlPlist(
          "<dict><key>k</key><string>v</string></dict>",
        ),
        "Payload/Test_xx.bundle/.DS_Store": enc.encode("junk"),
        "Payload/Test_xx.bundle/sub/.DS_Store": enc.encode("junk"),
        "Payload/Test_xx.bundle/__MACOSX/._carrier.plist": enc.encode("junk"),
        "__MACOSX/Payload/Test_xx.bundle/._carrier.plist": enc.encode("junk"),
      },
      { level: 0 },
    );
    const b = openIpcc(zip);
    expect(b.info.bundleName).toBe("Test_xx");
    expect(b.info.files.map((f) => f.path)).toEqual(["carrier.plist"]);
    expect(b.info.totalSize).toBe(b.entries["Payload/Test_xx.bundle/carrier.plist"]?.length);
  });

  it("classifies by the lower-cased extension, the same way it picks the content type", () => {
    const zip = zipSync({
      "Payload/Test_xx.bundle/Carrier.PLIST": xmlPlist("<dict><key>k</key><string>v</string></dict>"),
      "Payload/Test_xx.bundle/overrides_N1.DER.PRI": new Uint8Array([0x31, 0x00]),
    }, { level: 0 });
    const b = openIpcc(zip);
    expect(b.info.files.map((f) => [f.path, f.kind, contentTypeOf(f.path)])).toEqual([
      ["Carrier.PLIST", "plist", "application/x-plist"],
      ["overrides_N1.DER.PRI", "pri-der", "application/octet-stream"],
    ]);
  });

  it("decodes packager metadata as base64 of UTF-8 JSON", () => {
    const json = JSON.stringify({ name: "Orange España" });
    const zip = zipSync({ "Payload/Test_xx.bundle/a.metadata": enc.encode(bytesToBase64(enc.encode(json)).replace(/(.{8})/g, "$1\n")) }, { level: 0 });
    expect(decodedPlist(decodeFile(openIpcc(zip), "a.metadata"))).toEqual({ name: "Orange España" });
  });

  it("falls back to an empty prefix when there is no .bundle folder", () => {
    const zip = zipSync(
      {
        "carrier.plist": xmlPlist("<dict><key>k</key><string>v</string></dict>"),
        "nested/a.txt": enc.encode("hi"),
      },
      { level: 0 },
    );
    const b = openIpcc(zip);
    expect(b.prefix).toBe("");
    expect(b.info.bundleName).toBe("bundle");
    expect(b.info.files.map((f) => f.path)).toEqual(["carrier.plist", "nested/a.txt"]);
    expect(decodedPlist(decodeFile(b, "carrier.plist"))).toEqual({ k: "v" });
  });

  it("classifies every file kind found in the real bundles", () => {
    const kinds = (n: string) => {
      const out: Record<string, number> = {};
      for (const f of openIpcc(fixture(n)).info.files) out[f.kind] = (out[f.kind] ?? 0) + 1;
      return out;
    };
    expect(kinds("carrier-att.ipcc")).toEqual({ strings: 42, plist: 60, "pri-der": 7, mobileconfig: 1 });
    expect(kinds("carrier-verizon.ipcc")).toEqual({
      dmu: 1,
      xml: 1,
      plist: 28,
      certificate: 1,
      "pri-der": 11,
      mobileconfig: 1,
    });
    expect(kinds("carrier-cw-wi.ipcc")).toEqual({ strings: 41, plist: 65, "pri-der": 9 });
    expect(kinds("carrier-airtel-in.ipcc")).toEqual({ plist: 20, "pri-der": 7, "pri-plain": 1 });
    expect(kinds("carrier-cw-pa.ipcc")).toEqual({ plist: 24, "pri-der": 7, "pri-plain": 2 });
    expect(kinds("country-us.ipcc")).toEqual({ plist: 4 });
    expect(kinds("country-germany.ipcc")).toEqual({ plist: 16 });
    expect(kinds("watch-country-australia.ipcc")).toEqual({ plist: 4 });
    // The 2009 bundle carries PNG status-bar logos and no overrides at all.
    expect(kinds("carrier-att-2009.ipcc")).toEqual({ plist: 21, strings: 18, image: 6 });
  });

  it("treats .der.gri global settings as pri-der and a plaintext .pri as pri-plain", () => {
    const cw = openIpcc(fixture("carrier-cw-wi.ipcc"));
    const gri = cw.info.files.filter((f) => f.path.endsWith(".der.gri"));
    expect(gri).toHaveLength(9);
    expect(gri.map((f) => f.path)).toContain("global_setting_B.der.gri");
    for (const f of gri) expect(f.kind).toBe("pri-der");

    const bh = openIpcc(fixture("carrier-airtel-in.ipcc"));
    expect(bh.info.files.find((f) => f.path === "overrides_N69.pri")!.kind).toBe("pri-plain");
  });

  it("extracts locales from .lproj folders, including region-qualified ones", () => {
    const att = openIpcc(fixture("carrier-att.ipcc"));
    expect(att.info.locales).toHaveLength(42);
    expect(att.info.locales).toEqual([...att.info.locales].sort());
    expect(att.info.locales).toContain("en");
    expect(att.info.locales).toContain("en_GB");
    expect(att.info.locales).toContain("es_419");
    expect(att.info.locales).toContain("zh_TW");
    expect(att.info.files.find((f) => f.path === "en_GB.lproj/carrier.strings")!.locale).toBe(
      "en_GB",
    );
    expect(att.info.files.find((f) => f.path === "carrier.plist")!.locale).toBeUndefined();
  });

  it("handles the 2009 bundle's English-word locale folders", () => {
    const lg = openIpcc(fixture("carrier-att-2009.ipcc"));
    expect(lg.info.locales).toEqual([
      "Dutch", "English", "French", "German", "Italian", "Japanese", "Spanish",
      "da", "fi", "ko", "no", "pl", "pt", "pt_PT", "ru", "sv", "zh_CN", "zh_TW",
    ]);
    expect(lg.info.files.find((f) => f.path === "English.lproj/carrier.strings")!.locale).toBe(
      "English",
    );
    expect(lg.info.deviceStems).toEqual([]);
  });

  it("parses device stems from overrides_* filenames and lists their boards", () => {
    const att = openIpcc(fixture("carrier-att.ipcc"));
    expect(att.info.deviceStems).toEqual([
      "D321_D331_N841",
      "D421_D431_N104_D79",
      "D49",
      "D52g_D53g_D53p_D54p",
      "D63_D64_D16_D17",
      "D73_D74_D27_D28",
      "D83_D84_D37_D38",
    ]);
    const f = att.info.files.find((x) => x.path === "overrides_D63_D64_D16_D17.der.pri")!;
    expect(f.boards).toEqual(["D63", "D64", "D16", "D17"]);
    expect(att.info.files.find((x) => x.path === "carrier.plist")!.boards).toBeUndefined();
  });

  it("recognises a device stem on a plaintext .pri as well as on .der.pri and .plist", () => {
    const bh = openIpcc(fixture("carrier-airtel-in.ipcc"));
    expect(bh.info.deviceStems).toContain("N69");
    expect(
      bh.info.files.find((f) => f.path === "overrides_N69.pri")!.boards,
    ).toEqual(["N69"]);
    expect(
      bh.info.files.find((f) => f.path === "overrides_N69.plist")!.boards,
    ).toEqual(["N69"]);
  });

  it("does not treat global_setting_*.der.gri as a device override", () => {
    const cw = openIpcc(fixture("carrier-cw-wi.ipcc"));
    expect(cw.info.files.find((f) => f.path === "global_setting_B.der.gri")!.boards).toBeUndefined();
    expect(cw.info.deviceStems).not.toContain("global");
  });

  it("totals uncompressed bytes over the listed files only", () => {
    const expected: Array<[string, number, number]> = [
      ["country-us.ipcc", 3619, 4],
      ["watch-country-australia.ipcc", 3052, 4],
      ["country-germany.ipcc", 5924, 16],
      ["carrier-att.ipcc", 227963, 110],
      ["carrier-verizon.ipcc", 397958, 43],
      ["carrier-cw-wi.ipcc", 704580, 115],
      ["carrier-att-2009.ipcc", 24742, 45],
    ];
    for (const [name, total, count] of expected) {
      const b = openIpcc(fixture(name));
      expect(b.info.files).toHaveLength(count);
      expect(b.info.totalSize).toBe(total);
      expect(b.info.totalSize).toBe(b.info.files.reduce((s, f) => s + f.size, 0));
    }
  });

  it("sorts the file list by path", () => {
    const b = openIpcc(fixture("carrier-verizon.ipcc"));
    expect(b.info.files.map((f) => f.path)).toEqual(
      [...b.info.files.map((f) => f.path)].sort((a, c) => a.localeCompare(c)),
    );
  });
});


describe("decodeFile", () => {
  it("decodes a country bundle's binary carrier.plist", () => {
    const b = openIpcc(fixture("country-us.ipcc"));
    const d = decodeFile(b, "carrier.plist");
    expect(d.kind).toBe("plist");
    expect(d.size).toBe(2299);
    expect(d.note).toBeUndefined();
    expect((decodedPlist(d) as Dict).CountryName).toBe("United States of America");
  });

  it("decodes .strings files that are really binary plists", () => {
    const b = openIpcc(fixture("carrier-att.ipcc"));
    const d = decodeFile(b, "de.lproj/carrier.strings");
    expect(d.kind).toBe("strings");
    expect(decodedPlist(d)).toBeTruthy();
    expect(d.text).toBeUndefined();
    expect(Object.keys(decodedPlist(d) as Dict).length).toBeGreaterThan(0);
    // The 2009 bundle's .strings are binary plists too.
    const ls = decodeFile(openIpcc(fixture("carrier-att-2009.ipcc")), "English.lproj/carrier.strings");
    expect(ls.kind).toBe("strings");
    expect((decodedPlist(ls) as Dict)["Pay My Bill_SERVICE_NAME"]).toBe("Pay My Bill");
  });

  it("falls back to text for an old-style text .strings file", () => {
    const b = openIpcc(fixture("carrier-att.ipcc"));
    b.entries[b.prefix + "en.lproj/plain.strings"] = enc.encode('"a" = "b";\n');
    const d = decodeFile(b, "en.lproj/plain.strings");
    expect(d.kind).toBe("strings");
    expect(decodedPlist(d)).toBeUndefined();
    expect(d.text).toBe('"a" = "b";\n');
    expect(d.note).toBeUndefined();
  });

  it("decodes profile.mobileconfig as a plist", () => {
    for (const name of ["carrier-att.ipcc", "carrier-verizon.ipcc"]) {
      const d = decodeFile(openIpcc(fixture(name)), "profile.mobileconfig");
      expect(d.kind).toBe("mobileconfig");
      expect(d.note).toBeUndefined();
      expect(Object.keys(decodedPlist(d) as Dict)).toContain("PayloadType");
      expect(Object.keys(decodedPlist(d) as Dict)).toContain("PayloadContent");
    }
  });

  it("decodes carrier.ims as XML text", () => {
    const d = decodeFile(openIpcc(fixture("carrier-verizon.ipcc")), "carrier.ims");
    expect(d.kind).toBe("xml");
    expect(d.text!.startsWith("<?xml")).toBe(true);
    expect(d.text).toContain("<QIMF>");
    expect(decodedPlist(d)).toBeUndefined();
    expect(d.hex).toBeUndefined();
    expect(d.note).toBeUndefined();
  });

  it("decodes a .der.pri override into a PRI structure", () => {
    const b = openIpcc(fixture("carrier-verizon.ipcc"));
    const d = decodeFile(b, "overrides_D63_D64_D16_D17.der.pri");
    expect(d.kind).toBe("pri-der");
    expect(decodedPri(d)).toBeTruthy();
    expect(decodedPri(d)!.leafCount).toBeGreaterThan(0);
    expect(d.boards).toEqual(["D63", "D64", "D16", "D17"]);
    expect(d.note).toBeUndefined();
  });

  it("decodes a .der.gri global settings blob into a PRI structure", () => {
    const d = decodeFile(openIpcc(fixture("carrier-cw-wi.ipcc")), "global_setting_C.der.gri");
    expect(d.kind).toBe("pri-der");
    expect(decodedPri(d)).toBeTruthy();
    expect(decodedPri(d)!.leafCount).toBeGreaterThan(0);
    expect(d.boards).toBeUndefined();
  });

  it("decodes a plaintext .pri that is actually an XML document", () => {
    const d = decodeFile(openIpcc(fixture("carrier-airtel-in.ipcc")), "overrides_N69.pri");
    expect(d.kind).toBe("pri-plain");
    // The file starts with <?xml, so the plist parser claims it.
    expect(decodedPlist(d)).toBeTruthy();
    expect(decodedPri(d)).toBeUndefined();
    expect(d.note).toBeUndefined();
  });

  it("decodes carrier.dmu as a DMU public key and keeps the hex", () => {
    const d = decodeFile(openIpcc(fixture("carrier-verizon.ipcc")), "carrier.dmu");
    expect(d.kind).toBe("dmu");
    expect(d.size).toBe(260);
    expect(d.hex).toHaveLength(520);
    expect(d.hex!.startsWith("0a02ff10")).toBe(true);
    expect(d.text).toBeUndefined();
    if (d.kind !== "dmu") throw new Error(d.kind);
    expect(d.dmu).toMatchObject({ pkoid: 0x0a, algorithm: "RSA-1024", exponent: "17", modulusBits: 1024, pkoi: 2, pkoidName: "Verizon Wireless" });
    expect(d.note).toBeUndefined();
  });

  it("truncates a large opaque blob to 8 KiB and says so", () => {
    const b = openIpcc(fixture("carrier-att.ipcc"));
    b.entries[b.prefix + "blob.bin"] = new Uint8Array(20000).fill(7);
    const d = decodeFile(b, "blob.bin");
    expect(d.kind).toBe("binary");
    expect(d.hex).toHaveLength(8192 * 2);
    expect(d.size).toBe(20000);
  });

  it("promotes a small printable binary member to text", () => {
    const b = openIpcc(fixture("carrier-att.ipcc"));
    b.entries[b.prefix + "small.bin"] = enc.encode("hello world");
    const d = decodeFile(b, "small.bin");
    expect(d.kind).toBe("binary");
    expect(d.text).toBe("hello world");
    expect(d.hex).toBeUndefined();
  });

  it("reports the 2009 bundle's PNG status-bar logos without inlining them", () => {
    const lg = openIpcc(fixture("carrier-att-2009.ipcc"));
    const d = decodeFile(lg, "Default_CARRIER_ATT.png");
    if (d.kind !== "image") throw new Error(d.kind);
    expect(d.image).toEqual({ width: 31, height: 20, cgbi: true });
    expect(d.hex).toBeUndefined();
    expect(d.text).toBeUndefined();
    expect(lg.info.files.filter((f) => f.kind === "image").map((f) => f.path)).toEqual([
      "Default_CARRIER_ATT M-Cell.png",
      "Default_CARRIER_ATT.png",
      "Default_CARRIER_CINGULAR.png",
      "FSO_CARRIER_ATT M-Cell.png",
      "FSO_CARRIER_ATT.png",
      "FSO_CARRIER_CINGULAR.png",
    ]);
  });

  it("decodes the 2009 bundle's carrier.plist, Info.plist and locversion.plist", () => {
    const lg = openIpcc(fixture("carrier-att-2009.ipcc"));
    const carrier = decodedPlist(decodeFile(lg, "carrier.plist")) as Dict;
    expect(carrier.CarrierName).toBe("AT&T");
    expect(Array.isArray(carrier.StatusBarImages)).toBe(true);
    const info = decodedPlist(decodeFile(lg, "Info.plist")) as Dict;
    expect(info.CFBundleIdentifier).toBe("com.apple.ATT_US");
    expect(info.CFBundleVersion).toBe("3.1");
    const loc = decodedPlist(decodeFile(lg, "English.lproj/locversion.plist")) as Dict;
    expect(loc.LprojLocale).toBe("en");
  });

  it("decodes Verizon's CDMA-era ERI.plist and supported_devices.plist", () => {
    const b = openIpcc(fixture("carrier-verizon.ipcc"));
    expect(Object.keys(decodedPlist(decodeFile(b, "ERI.plist")) as Dict)).toEqual([
      "name",
      "version",
      "roaming_indicator_table",
    ]);
    expect(Object.keys(decodedPlist(decodeFile(b, "supported_devices.plist")) as Dict)).toEqual([
      "SupportedDevicesExactMatch",
      "SupportedSIMOverrides",
    ]);
  });

  it("decodes every member of every fixture without throwing", () => {
    const names = [
      "carrier-att.ipcc", "carrier-verizon.ipcc", "country-us.ipcc", "country-germany.ipcc",
      "watch-country-australia.ipcc", "carrier-cw-wi.ipcc", "carrier-cw-pa.ipcc", "carrier-airtel-in.ipcc",
      "carrier-att-2009.ipcc",
    ];
    let seen = 0;
    for (const name of names) {
      const b = openIpcc(fixture(name));
      for (const f of b.info.files) {
        const d = decodeFile(b, f.path);
        seen++;
        expect(d.path).toBe(f.path);
        expect(d.kind).toBe(f.kind);
        expect(d.size).toBe(f.size);
        // Images carry no payload here: their bytes are served by /api/raw.
        const populated =
          decodedPlist(d) !== undefined ||
          decodedPri(d) !== undefined ||
          d.text !== undefined ||
          d.hex !== undefined ||
          d.kind === "image";
        expect(populated, `${name}:${f.path}`).toBe(true);
      }
    }
    expect(seen).toBe(398);
  });

  it("populates the field that matches the kind for every real file kind", () => {
    const fields = (b: OpenedBundle, p: string) => {
      const d = decodeFile(b, p) as unknown as Record<string, unknown>;
      return ["plist", "pri", "text", "hex"].filter((k) => d[k] !== undefined);
    };
    const vz = openIpcc(fixture("carrier-verizon.ipcc"));
    expect(fields(vz, "carrier.plist")).toEqual(["plist"]);
    expect(fields(vz, "profile.mobileconfig")).toEqual(["plist"]);
    expect(fields(vz, "carrier.ims")).toEqual(["text"]);
    expect(fields(vz, "carrier.dmu")).toEqual(["hex"]);
    expect(fields(vz, "CarrierCA.crt")).toEqual(["text"]); // PEM, not DER
    expect(fields(vz, "overrides_V59.der.pri")).toEqual(["pri"]);
    expect(fields(openIpcc(fixture("carrier-att.ipcc")), "ja.lproj/carrier.strings")).toEqual(["plist"]);
    expect(fields(openIpcc(fixture("carrier-cw-wi.ipcc")), "global_setting_J.der.gri")).toEqual(["pri"]);
    // An image has no inline payload; /api/raw serves the bytes.
    expect(fields(openIpcc(fixture("carrier-att-2009.ipcc")), "FSO_CARRIER_ATT.png")).toEqual([]);
  });

  // Verizon's CarrierCA.crt is PEM, not DER, so it is shown as text.
  it("shows a PEM certificate as text rather than as mislabelled hex", () => {
    const d = decodeFile(openIpcc(fixture("carrier-verizon.ipcc")), "CarrierCA.crt");
    expect(d.text).toBeDefined();
    expect(d.text!.startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
    expect(d.note).not.toBe("DER-encoded X.509 certificate");
  });

  it("still hex-dumps a certificate that really is DER", () => {
    const b = openIpcc(fixture("carrier-verizon.ipcc"));
    b.entries[b.prefix + "der.crt"] = new Uint8Array([0x30, 0x82, 0x01, 0x0a, 0x02, 0x01]);
    const d = decodeFile(b, "der.crt");
    if (d.kind !== "certificate") throw new Error(d.kind);
    expect(d.certificates).toEqual([]);
    expect(d.error).toMatchObject({ reason: "failed", message: expect.any(String) });
    expect(d.hex).toBe("3082010a0201");
    // The bytes are PEM.
    expect(
      dec.decode(b.entries[b.prefix + "CarrierCA.crt"]).startsWith("-----BEGIN CERTIFICATE-----"),
    ).toBe(true);
  });
});

describe("decodeFile error handling", () => {
  it("throws for a path that is not in the bundle", () => {
    const b = openIpcc(fixture("carrier-verizon.ipcc"));
    expect(() => decodeFile(b, "nope.plist")).toThrow("no such file in bundle: nope.plist");
    expect(() => decodeFile(b, "signatures/nope.plist")).toThrow(/no such file in bundle/);
    expect(() => decodeFile(b, "carrier.plist/")).toThrow(/not a file/);
  });

  it("falls back to the raw zip key when the path already carries the prefix", () => {
    const b = openIpcc(fixture("carrier-verizon.ipcc"));
    const d = decodeFile(b, "Payload/Verizon_LTE_US.bundle/carrier.plist");
    expect((decodedPlist(d) as Dict).CarrierName).toBe("Verizon");
    // The reported path is whatever was asked for, not the bundle-relative one.
    expect(d.path).toBe("Payload/Verizon_LTE_US.bundle/carrier.plist");
  });

  it("rejects a directory entry and an empty path", () => {
    const b = openIpcc(fixture("carrier-verizon.ipcc"));
    expect(() => decodeFile(b, "signatures/")).toThrow(/not a file/);
    expect(() => decodeFile(b, "")).toThrow(/not a file/);
  });

  it("degrades a corrupt binary plist to a note plus a hex dump", () => {
    const b = openIpcc(fixture("carrier-att.ipcc"));
    b.entries[b.prefix + "broken.plist"] = enc.encode("bplist00garbage");
    const d = decodeFile(b, "broken.plist");
    expect(d.kind).toBe("plist");
    expect(decodedPlist(d)).toBeUndefined();
    expect(d.error).toMatchObject({ reason: "failed", message: expect.any(String) });
    expect(d.hex).toHaveLength(30);
    expect(d.hex!.startsWith("62706c6973743030")).toBe(true);
  });

  it("degrades a corrupt .strings member the same way", () => {
    const b = openIpcc(fixture("carrier-att.ipcc"));
    b.entries[b.prefix + "en.lproj/broken.strings"] = enc.encode("bplist00truncated");
    const d = decodeFile(b, "en.lproj/broken.strings");
    expect(d.kind).toBe("strings");
    expect(d.error?.reason).toBe("failed");
    expect(d.hex).toBeDefined();
  });

  it("does not throw on a .der.pri holding junk", () => {
    const b = openIpcc(fixture("carrier-att.ipcc"));
    b.entries[b.prefix + "junk.der.pri"] = new Uint8Array([1, 2, 3, 4, 5]);
    expect(() => decodeFile(b, "junk.der.pri")).not.toThrow();
    expect(decodedPri(decodeFile(b, "junk.der.pri"))).toBeTruthy();
  });

  // BUG: a .plist / .mobileconfig member whose bytes are neither "bplist" nor
  // XML skips the parser entirely and is handed to TextDecoder, so binary junk
  // becomes U+FFFD mojibake with no note and no hex to fall back on.
  // Repro: decodeFile on a ".plist" entry holding [0,1,2,3,250,251] returns
  //        text " ��" and note undefined.
  it("flags a .plist member whose content is not a plist at all", () => {
    const b = openIpcc(fixture("carrier-att.ipcc"));
    b.entries[b.prefix + "notaplist.plist"] = new Uint8Array([0, 1, 2, 3, 250, 251]);
    const d = decodeFile(b, "notaplist.plist");
    expect(d.error).toEqual({ reason: "unrecognised" });
    expect(d.hex).toBeDefined();
  });

  it("still returns plain text for a .strings member in the legacy text format", () => {
    const b = openIpcc(fixture("carrier-att.ipcc"));
    b.entries[b.prefix + "en.lproj/legacy.strings"] = enc.encode('"KEY" = "value";\n');
    const d = decodeFile(b, "en.lproj/legacy.strings");
    expect(d.text).toBe('"KEY" = "value";\n');
    expect(d.note).toBeUndefined();
  });
});


describe("bytesToBase64", () => {
  const roundTrip = (b: Uint8Array) => Buffer.from(bytesToBase64(b), "base64");

  it("encodes empty input", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });

  it("encodes small input", () => {
    expect(bytesToBase64(enc.encode("ABC"))).toBe("QUJD");
    expect(bytesToBase64(new Uint8Array([0, 255, 128]))).toBe("AP+A");
    for (let n = 1; n <= 8; n++) {
      const b = new Uint8Array(n).map((_, i) => (i * 31) % 256);
      expect(roundTrip(b).equals(Buffer.from(b))).toBe(true);
    }
  });

  it("handles exactly one 0x8000 chunk", () => {
    const b = new Uint8Array(0x8000).fill(65);
    expect(roundTrip(b).equals(Buffer.from(b))).toBe(true);
  });

  it("handles the bytes either side of the chunk boundary", () => {
    for (const n of [0x8000 - 1, 0x8000, 0x8000 + 1, 0x8000 * 2, 0x8000 * 2 + 5]) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = i % 251;
      expect(roundTrip(b).equals(Buffer.from(b))).toBe(true);
    }
  });

  it("round-trips a real bundle member well over 32 KiB", () => {
    const cw = openIpcc(fixture("carrier-cw-wi.ipcc"));
    const big = defined(cw.entries[cw.prefix + "global_setting_B.der.gri"]);
    expect(big.length).toBeGreaterThan(0x8000 * 8);
    expect(roundTrip(big).equals(Buffer.from(big))).toBe(true);
  });

  it("encodes a subarray view without dragging in the rest of the buffer", () => {
    const backing = new Uint8Array(1000).fill(9);
    expect(bytesToBase64(backing.subarray(10, 13))).toBe(bytesToBase64(new Uint8Array([9, 9, 9])));
  });
});


describe("openIpcc hostile input", () => {
  it("throws cleanly on bytes that are not a ZIP", () => {
    expect(() => openIpcc(enc.encode("not a zip at all, really not"))).toThrow();
    expect(() => openIpcc(new Uint8Array(0))).toThrow();
    expect(() => openIpcc(new Uint8Array(4096).fill(0xab))).toThrow();
  });

  it("throws cleanly on a truncated ZIP", () => {
    const raw = fixture("country-us.ipcc");
    expect(() => openIpcc(raw.subarray(0, 200))).toThrow();
    expect(() => openIpcc(raw.subarray(0, raw.length - 10))).toThrow();
    expect(() => openIpcc(raw.subarray(0, Math.floor(raw.length / 2)))).toThrow();
  });

  it("throws rather than hanging on a ZIP header with no payload", () => {
    const started = Date.now();
    expect(() => openIpcc(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toThrow();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("still opens a valid bundle after the hostile cases", () => {
    expect(openIpcc(fixture("country-us.ipcc")).info.files).toHaveLength(4);
  });
});


describe("diffValues", () => {
  const kinds = (rows: ReturnType<typeof diffValues>) =>
    Object.fromEntries(rows.map((r) => [r.path, r.kind]));

  it("classifies added, removed and changed leaves", () => {
    const rows = diffValues({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, d: 4 });
    expect(kinds(rows)).toEqual({ b: "changed", c: "removed", d: "added" });
    expect(rows.find((r) => r.path === "b")).toEqual({ path: "b", kind: "changed", a: 2, b: 9 });
    expect(rows.find((r) => r.path === "c")).toEqual({ path: "c", kind: "removed", a: 3 });
    expect(rows.find((r) => r.path === "d")).toEqual({ path: "d", kind: "added", b: 4 });
  });

  it("omits equal leaves", () => {
    expect(diffValues({ a: 1 }, { a: 1 })).toEqual([]);
    expect(diffValues({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } })).toEqual([{ path: "b.c", kind: "changed", a: 2, b: 3 }]);
  });

  it("walks nested objects and joins the path with dots", () => {
    expect(
      diffValues({ a: { b: { c: { d: { e: 1 } } } } }, { a: { b: { c: { d: { e: 2 } } } } }),
    ).toEqual([{ path: "a.b.c.d.e", kind: "changed", a: 1, b: 2 }]);
  });

  it("treats objects that differ only in key order as equal", () => {
    expect(diffValues({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } })).toEqual([]);
    // stable() sorts keys, so the same holds inside arrays.
    expect(diffValues({ l: [{ b: 1, a: 2 }] }, { l: [{ a: 2, b: 1 }] })).toEqual([]);
  });

  it("indexes array elements and reports length differences", () => {
    expect(diffValues([1, 2, 3], [1, 2])).toEqual([{ path: "[2]", kind: "removed", a: 3 }]);
    expect(diffValues([1, 2], [1, 2, 3])).toEqual([{ path: "[2]", kind: "added", b: 3 }]);
    expect(diffValues({ d: [1, 2] }, { d: [1, 3] })).toEqual([
      { path: "d[1]", kind: "changed", a: 2, b: 3 },
    ]);
  });

  it("descends into arrays of objects", () => {
    expect(diffValues([{ k: 1 }, { k: 2 }], [{ k: 1 }, { k: 3 }])).toEqual([
      { path: "[1].k", kind: "changed", a: 2, b: 3 },
    ]);
    const rows = diffValues(
      { apns: [{ apn: "a", user: "" }] },
      { apns: [{ apn: "b", user: "" }, { apn: "c" }] },
    );
    expect(kinds(rows)).toEqual({ "apns[0].apn": "changed", "apns[1]": "added" });
  });

  it("distinguishes null, undefined and a missing key", () => {
    // undefined and "absent" are the same thing here.
    expect(diffValues({ a: undefined }, {})).toEqual([]);
    expect(diffValues({}, { a: undefined })).toEqual([]);
    expect(diffValues({ a: null }, {})).toEqual([{ path: "a", kind: "removed", a: null }]);
    expect(diffValues({ a: null }, { a: undefined })).toEqual([
      { path: "a", kind: "removed", a: null },
    ]);
    expect(diffValues({}, { a: null })).toEqual([{ path: "a", kind: "added", b: null }]);
    expect(diffValues({ a: null }, { a: 0 })).toEqual([{ path: "a", kind: "changed", a: null, b: 0 }]);
    expect(diffValues({ a: null }, { a: false })).toEqual([
      { path: "a", kind: "changed", a: null, b: false },
    ]);
    expect(diffValues({ a: null }, { a: null })).toEqual([]);
    // An explicit undefined element makes an array look the same as a shorter one.
    expect(diffValues([1, undefined], [1])).toEqual([]);
  });

  it("compares containers of different shapes as a single changed leaf", () => {
    expect(diffValues({ a: 1 }, [1])).toEqual([{ path: "", kind: "changed", a: { a: 1 }, b: [1] }]);
    expect(diffValues({ a: 1 }, "x")).toEqual([{ path: "", kind: "changed", a: { a: 1 }, b: "x" }]);
    expect(diffValues([1], 1)).toEqual([{ path: "", kind: "changed", a: [1], b: 1 }]);
  });

  it("handles scalar roots and empty containers", () => {
    expect(diffValues(1, 2)).toEqual([{ path: "", kind: "changed", a: 1, b: 2 }]);
    expect(diffValues(1, 1)).toEqual([]);
    expect(diffValues({}, {})).toEqual([]);
    expect(diffValues([], [])).toEqual([]);
    expect(diffValues(undefined, undefined)).toEqual([]);
  });

  it("orders keys deterministically", () => {
    expect(diffValues({ B: 1, a: 1, _z: 1 }, { B: 2, a: 2, _z: 2 }).map((r) => r.path)).toEqual([
      "B",
      "_z",
      "a",
    ]);
    // Order does not depend on which side declares the key.
    expect(diffValues({ b: 1 }, { a: 1 }).map((r) => r.path)).toEqual(["a", "b"]);
  });

  it("diffs two real carrier bundles' carrier.plist", () => {
    const a = decodedPlist(decodeFile(openIpcc(fixture("carrier-att.ipcc")), "carrier.plist"));
    const b = decodedPlist(decodeFile(openIpcc(fixture("carrier-verizon.ipcc")), "carrier.plist"));

    const rows = diffValues(a, b);
    expect(summariseDiff(rows)).toEqual({ added: 61, removed: 67, changed: 57, same: 0 });
    expect(rows.find((r) => r.path === "CarrierName")).toEqual({
      path: "CarrierName",
      kind: "changed",
      a: "AT&T",
      b: "Verizon",
    });
    expect(rows.map((r) => r.path)).toEqual([...rows.map((r) => r.path)].sort());
    expect(rows.some((r) => r.path.includes("."))).toBe(true);
    // Deterministic across runs.
    expect(diffValues(a, b)).toEqual(rows);
  });

  it("reports no differences for a bundle against itself", () => {
    const p = decodedPlist(decodeFile(openIpcc(fixture("carrier-verizon.ipcc")), "carrier.plist"));
    expect(diffValues(p, p)).toEqual([]);
  });

  it("diffs two country bundles' CellBroadcast schemas", () => {
    const us = decodedPlist(decodeFile(openIpcc(fixture("country-us.ipcc")), "carrier.plist")) as Dict;
    const au = decodedPlist(decodeFile(openIpcc(fixture("watch-country-australia.ipcc")), "carrier.plist")) as Dict;
    const rows = diffValues(us, au);
    expect(rows.find((r) => r.path === "CountryName")).toEqual({
      path: "CountryName",
      kind: "changed",
      a: "United States of America",
      b: "Australia",
    });
    expect(rows.some((r) => r.path.startsWith("CellBroadcast.AlertTypes."))).toBe(true);
    expect(rows.some((r) => r.path.startsWith("CellBroadcast.MessageIDParameters3GPP["))).toBe(true);
    expect(summariseDiff(rows).changed).toBeGreaterThan(0);
  });
});

describe("summariseDiff", () => {
  it("counts each kind", () => {
    const rows = diffValues({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, d: 4 });
    expect(summariseDiff(rows)).toEqual({ added: 1, removed: 1, changed: 1, same: 0 });
  });

  it("counts zero for an empty diff", () => {
    expect(summariseDiff([])).toEqual({ added: 0, removed: 0, changed: 0, same: 0 });
    expect(summariseDiff(diffValues({ a: 1 }, { a: 1 }))).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
      same: 0,
    });
  });

  it("totals to the row count", () => {
    const rows = diffValues(
      { a: 1, b: { c: 2, d: 3 }, e: [1, 2] },
      { a: 1, b: { c: 9 }, f: true },
    );
    const counts = summariseDiff(rows);
    expect(counts.added + counts.removed + counts.changed + counts.same).toBe(rows.length);
  });
});


describe("ipcc: assets and packaging leftovers", () => {
  it("classifies and measures a PNG carrier logo without inlining it", () => {
    const b = openIpcc(fixture("carrier-att-2009.ipcc"));
    const png = b.info.files.find((f) => f.kind === "image")!;
    expect(png).toBeTruthy();
    expect(png.path.endsWith(".png")).toBe(true);
    const d = decodeFile(b, png.path);
    if (d.kind !== "image") throw new Error(d.kind);
    expect(d.image?.width).toBeGreaterThan(0);
    // The bytes are served by /api/raw, not embedded in the JSON.
    expect(d.hex).toBeUndefined();
    expect(d.text).toBeUndefined();
  });

  it("classifies images by extension, case-insensitively", () => {
    const b = openIpcc(fixture("carrier-att-2009.ipcc"));
    for (const name of ["a.PNG", "b.jpeg", "c.jpg", "d.gif", "e.tif", "f.tiff", "g.svg"]) {
      b.entries[b.prefix + name] = new Uint8Array([1, 2, 3]);
      expect(decodeFile(b, name).kind, name).toBe("image");
    }
  });

  it("decodes bundle.metadata, which is base64-encoded JSON", () => {
    const b = openIpcc(fixture("watch-redpocket.ipcc"));
    const f = b.info.files.find((x) => x.path === "bundle.metadata")!;
    expect(f.kind).toBe("metadata");
    const d = decodeFile(b, "bundle.metadata");
    const meta = decodedPlist(d) as Record<string, unknown>;
    expect(meta.bundleType).toBe("Carriers");
    expect(meta.device).toBe("Watch");
    expect(Array.isArray(meta.filesModified)).toBe(true);
  });

  it("falls back to text when a .metadata member is not base64 JSON", () => {
    const b = openIpcc(fixture("watch-redpocket.ipcc"));
    b.entries[b.prefix + "broken.metadata"] = enc.encode("plainly not base64 json");
    const d = decodeFile(b, "broken.metadata");
    expect(decodedPlist(d)).toBeUndefined();
    expect(d.text).toBe("plainly not base64 json");
    expect(d.error).toEqual({ reason: "unrecognised", message: "expected base64-encoded JSON" });
  });

  it("annotates the opaque binary members it knows about", () => {
    const vz = openIpcc(fixture("carrier-verizon.ipcc"));
    expect(decodeFile(vz, "carrier.dmu").kind).toBe("dmu");
    const b = openIpcc(fixture("carrier-verizon.ipcc"));
    b.entries[b.prefix + "carrier.prl"] = new Uint8Array([0, 0x57, 0, 3, 3, 0x80]);
    const prl = decodeFile(b, "carrier.prl");
    expect(prl.note).toMatch(/Preferred Roaming List/);
    expect(prl.error?.message).toMatch(/PRL too short/);
    b.entries[b.prefix + "overrides_N1.mcfopota"] = new Uint8Array([4, 0, 1, 0, 0x38]);
    expect(decodeFile(b, "overrides_N1.mcfopota").note).toMatch(/OP-OTA/);
  });

  it("maps members to a servable content type", () => {
    expect(contentTypeOf("a/b/logo.png")).toBe("image/png");
    expect(contentTypeOf("shot.JPG")).toBe("image/jpeg");
    expect(contentTypeOf("tree.xml")).toBe("application/xml");
    expect(contentTypeOf("carrier.ims")).toBe("application/xml");
    expect(contentTypeOf("CarrierCA.crt")).toBe("application/x-x509-ca-cert");
    expect(contentTypeOf("carrier.plist")).toBe("application/x-plist");
    expect(contentTypeOf("carrier.prl")).toBe("application/octet-stream");
  });

  it("still decodes every member of every fixture without throwing", () => {
    for (const name of FIXTURES) {
      const b = openIpcc(fixture(name));
      for (const f of b.info.files) {
        expect(() => decodeFile(b, f.path), `${name}:${f.path}`).not.toThrow();
      }
    }
  });
});


describe("Apple CgBI PNG normalisation", () => {
  const logos = () => {
    const b = openIpcc(fixture("carrier-att-2009.ipcc"));
    return b.info.files
      .filter((f) => f.kind === "image")
      .map((f) => ({ path: f.path, bytes: defined(b.entries[b.prefix + f.path]) }));
  };

  it("recognises the carrier logos as CgBI PNGs", () => {
    const all = logos();
    expect(all).toHaveLength(6);
    for (const { path, bytes } of all) {
      expect(isPng(defined(bytes)), path).toBe(true);
      expect(isCgBI(defined(bytes)), path).toBe(true);
    }
  });

  it("reads dimensions past the CgBI chunk", () => {
    const byPath = Object.fromEntries(logos().map((l) => [l.path, l.bytes]));
    expect(pngDimensions(defined(byPath["Default_CARRIER_ATT.png"]))).toEqual({ width: 31, height: 20 });
    expect(pngDimensions(defined(byPath["Default_CARRIER_ATT M-Cell.png"]))).toEqual({ width: 72, height: 20 });
    expect(pngDimensions(defined(byPath["Default_CARRIER_CINGULAR.png"]))).toEqual({ width: 51, height: 20 });
  });

  it("rewrites every logo into a standard PNG with the same dimensions", () => {
    for (const { path, bytes } of logos()) {
      const out = normalizeApplePng(defined(bytes))!;
      expect(out, path).toBeTruthy();
      expect(isPng(out)).toBe(true);
      expect(isCgBI(out)).toBe(false);
      expect(pngDimensions(out)).toEqual(pngDimensions(defined(bytes)));
      // A standard PNG puts IHDR immediately after the signature.
      expect(dec.decode(out.subarray(12, 16))).toBe("IHDR");
      // IDAT carries a zlib wrapper (0x78 ...).
      const idatAt = out.indexOf(0x49, 30);
      expect(out.length).toBeGreaterThan(50);
      expect(idatAt).toBeGreaterThan(0);
    }
  });

  it("produces an IDAT that inflates back to the expected raw size", () => {
    const { bytes } = defined(logos()[0]);
    const out = normalizeApplePng(bytes)!;
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    // signature(8) + IHDR chunk(12 + 13) = 33
    const idatLen = dv.getUint32(33);
    expect(dec.decode(out.subarray(37, 41))).toBe("IDAT");
    const idat = out.subarray(41, 41 + idatLen);
    const raw = unzlibSync(idat);
    const { width, height } = pngDimensions(out)!;
    expect(raw.length).toBe((width * 4 + 1) * height);
    // Filter byte of every scanline is None.
    for (let y = 0; y < height; y++) expect(raw[y * (width * 4 + 1)]).toBe(0);
  });

  it("leaves a standard PNG alone", () => {
    const { bytes } = defined(logos()[0]);
    const standard = normalizeApplePng(bytes)!;
    expect(normalizeApplePng(standard)).toBeNull();
  });

  it("returns null rather than throwing for input it cannot handle", () => {
    expect(normalizeApplePng(new Uint8Array())).toBeNull();
    expect(normalizeApplePng(enc.encode("not a png at all"))).toBeNull();
    expect(isPng(enc.encode("nope"))).toBe(false);
    expect(pngDimensions(enc.encode("nope"))).toBeNull();
    // Correct signature, truncated body.
    const { bytes } = defined(logos()[0]);
    for (const cut of [9, 20, 30, 48, 100, bytes.length - 1]) {
      expect(() => normalizeApplePng(bytes.subarray(0, cut)), `cut ${cut}`).not.toThrow();
    }
    // Correct signature and CgBI, but a bit depth the converter does not accept.
    const broken = new Uint8Array(bytes);
    broken[24 + 8 + 8] = 4; // IHDR bit depth
    expect(normalizeApplePng(broken)).toBeNull();
  });
});

describe("publishedOn", () => {
  it("reads the date out of every URL scheme Apple has used", () => {
    expect(publishedOn("https://updates.cdn-apple.com/20261001/carrierbundles/142-29613/9763C9C0-86F5-4D14-8B50-2C02ACE04457/ATT_US_iPhone.ipcc")).toBe("2026-10-01");
    expect(publishedOn("http://updates-http.cdn-apple.com/2018/ios/carrierbundles/091-80246-20180504-CC3E1C52-4D8B-11E8-BA4C-38D21A00AB6B/AIS_th_iPhone.ipcc")).toBe("2018-05-04");
    expect(publishedOn("http://appldnld.apple.com/iOS7/CarrierBundles/031-2099.20131204.rVQEN/2degrees_nz_iPhone.ipcc")).toBe("2013-12-04");
    expect(publishedOn("http://appldnld.apple.com.edgesuite.net/content.info.apple.com/iPhone/CarrierBundles/061-4732.20090203.gj3ef/ATT_US.ipcc")).toBe("2009-02-03");
  });

  it("falls back to the year where the path has nothing more", () => {
    expect(publishedOn("https://updates.cdn-apple.com/2020/carrierbundles/001-80023/80B77606-453A-4462-A609-98577E6EE499/Bell_ca_Watch.ipcc")).toBe("2020");
    expect(publishedOn("https://updates.cdn-apple.com/2019/carrierbundles/041-56849-2019503-D84FB36A-6C44-11E9-B635-4CC8AFCA7786/2degrees_nz_iPad.ipcc")).toBe("2019");
    expect(publishedOn("https://updates.cdn-apple.com/202206043/carrierbundles/071-96019/1C8525EF-8FB9-472B-BF6C-17EFB79E7ED3/Cyta_cy_Watch.ipcc")).toBe("2022");
    expect(publishedOn("https://example.com/carrier.ipcc")).toBeUndefined();
  });
});
