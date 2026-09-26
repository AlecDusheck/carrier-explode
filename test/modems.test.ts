import { describe, it, expect } from "vitest";
import { firstCopyWith, modemView, overrideCandidates } from "../src/lib/server/modems.ts";
import { knowsPhone, overridesFor } from "../src/lib/phones.ts";
import { describeDevices } from "../src/lib/decode/devices.ts";
import type { BundleFile } from "../src/lib/decode/bundle.ts";
import type { ImageModem } from "../src/lib/server/timeline.ts";

const modem = (family: string, kind: "bbfw" | "ftab", devices: string[]): ImageModem => ({
  family, devices, package: { id: family.toLowerCase().padEnd(64, "0"), size: 1, name: family, crc32: "00000000", kind },
});
// 24A437, newest phone first, as scripts/modems.py writes it.
const pri = (path: string): BundleFile => ({ path, size: 1, kind: "pri-der", devices: describeDevices(/^overrides_(.+?)\./.exec(path)![1]) });
const MODEMS = [modem("C1", "ftab", ["iPhone17,5", "iPhone18,4"]), modem("Mav25", "bbfw", ["iPhone18,1"]), modem("Mav24", "bbfw", ["iPhone17,1"])];

describe("modemView", () => {
  it("names the phones and the vendor", () => {
    expect(modemView(MODEMS[0])).toEqual({
      family: "C1", vendor: "apple",
      package: { id: MODEMS[0].package.id, name: "C1", size: 1, kind: "ftab" },
      devices: [{ id: "iPhone17,5", name: "iPhone 16e" }, { id: "iPhone18,4", name: "iPhone Air" }],
    });
  });
});

describe("which copy holds a phone's override files", () => {
  const entry = (slug: string, source: "image" | "ota", build: string, productType?: string) => ({ slug, source, build, productType });
  // Newest first, per-model variants last, as buildTimeline orders them.
  const timeline = [
    entry("ota-73.0", "ota", "73.0"),
    entry("ios-27.0", "image", "72.1"),
    entry("ota-72.1", "ota", "72.1"),
    entry("ios-26.4", "image", "71.0"),
    entry("ota-70.2", "ota", "70.2"),
    entry("ota-73.0-iPhone15,2", "ota", "73.0", "iPhone15,2"),
    entry("ota-73.0-iPad", "ota", "73.0", "iPad"),
  ];
  const slugs = (xs: Array<{ slug: string }>) => xs.map((x) => x.slug);

  it("tries the copy asked for, then OTA copies of the same build, then the newest", () => {
    expect(slugs(overrideCandidates(timeline, timeline[1], "iPhone15,2", 8)))
      .toEqual(["ios-27.0", "ota-72.1", "ota-73.0", "ota-73.0-iPhone15,2", "ota-70.2"]);
    // Another phone's variant and the iPad one are never candidates.
    expect(slugs(overrideCandidates(timeline, timeline[1], "iPhone18,1", 8))).toEqual(["ios-27.0", "ota-72.1", "ota-73.0", "ota-70.2"]);
  });

  it("opens at most `limit` OTA copies", () => {
    expect(slugs(overrideCandidates(timeline, timeline[1], "iPhone18,1", 2))).toEqual(["ios-27.0", "ota-72.1", "ota-73.0"]);
    expect(slugs(overrideCandidates(timeline, timeline[0], "iPhone18,1", 8))).toEqual(["ota-73.0", "ota-72.1", "ota-70.2"]);
  });

  // An iOS 27.0 image cut for an iPhone 16 Pro (Mav24) holds only that family's file.
  const files: Record<string, BundleFile[]> = {
    "ios-27.0": [pri("overrides_D93_D94_D47_D48.der.pri"), pri("overrides_mvno1.der.pri")],
    "ota-72.1": [pri("overrides_D93_D94_D47_D48.der.pri"), pri("overrides_V53_V54_V57.der.pri"), pri("overrides_D73_D74.der.pri")],
    "ota-73.0": [pri("overrides_V53_V54_V57.der.pri")],
  };
  const find = (phone: string, candidates = ["ios-27.0", "ota-72.1", "ota-73.0"]) =>
    firstCopyWith(candidates, async (slug) => files[slug] ?? [], (fs) => overridesFor(fs, phone), (fs) => knowsPhone(fs, phone));

  it("stays on the copy asked for when it has the phone's file", async () => {
    expect(await find("iPhone17,1")).toEqual({ entry: "ios-27.0", files: [pri("overrides_D93_D94_D47_D48.der.pri")] });
  });

  it("falls back to the first OTA copy naming the phone's codename", async () => {
    expect((await find("iPhone18,1"))?.entry).toBe("ota-72.1");
    expect(await find("iPhone15,2")).toEqual({ entry: "ota-72.1", files: [pri("overrides_D73_D74.der.pri")] });
  });

  it("claims no files only for a phone some copy was made for", async () => {
    // V53 is the iPhone 17 Pro (iPhone18,1): copies naming it know the older iPhone 16e.
    expect(await find("iPhone17,5")).toEqual({ entry: null, known: true });
    // No copy names an iPhone Air (iPhone18,4) or anything newer.
    expect(await find("iPhone18,4")).toEqual({ entry: null, known: false });
  });

  it("says none only when every copy was read", async () => {
    const flaky = (slug: string) => (slug === "ota-72.1" ? Promise.reject(new Error("502")) : Promise.resolve(files[slug] ?? []));
    expect(await firstCopyWith(["ios-27.0", "ota-72.1", "ota-73.0"], flaky, (fs) => overridesFor(fs, "iPhone18,4"), () => true)).toBeUndefined();
    // A later copy still answers when an earlier OTA one cannot be read.
    expect((await firstCopyWith(["ios-27.0", "ota-72.1", "ota-73.0"], flaky, (fs) => overridesFor(fs, "iPhone18,1"), () => true))?.entry).toBe("ota-73.0");
    // The copy asked for failing is the page's error, not a miss.
    await expect(firstCopyWith(["ios-27.0"], () => Promise.reject(new Error("gone")), (fs: BundleFile[]) => fs, () => true)).rejects.toThrow("gone");
  });
});
