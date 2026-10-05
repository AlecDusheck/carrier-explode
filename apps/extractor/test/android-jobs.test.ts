/** The android.* extractor jobs' pure parts: the OTA page, the plan policy, and the release merge of sources and modems. */

import { describe, expect, it } from "vitest";
import { AndroidReleaseError, carrierList, mergeModems, mergeSources } from "../container/src/jobs/android-merge.ts";
import { settingsNames, unshadowed, type SettingsFile } from "../container/src/jobs/android-ota.ts";
import { releasePrefix } from "@carrier-explode/storage";
import { BUILD_NUMBERS, firstPatches } from "../src/feeds/pixel-ota/build-numbers.ts";
import { delisted, pixelDevices } from "../src/feeds/pixel-ota/devices.ts";
import { OTA_PAGE, parseOtaPage, type OtaDevice } from "../src/feeds/pixel-ota/page.ts";
import { planBuilds } from "../src/feeds/pixel-ota/plan.ts";
import type { SourceKey } from "@carrier-explode/schema";
import { JOBS, type JobOutput } from "../src/jobs.ts";

const row = (device: string, label: string, build: string): string =>
  `<tr id="${device}${build}"><td>${label}</td><td><a href="https://dl.google.com/dl/android/aosp/${device}-ota-${build}-0000.zip">Link</a></td><td>00</td></tr>`;

const PAGE = `
<h2 id="tokay" data-text='"tokay" for Pixel 9' tabindex="-1">"tokay" for Pixel 9</h2>
<table>${row("tokay", "17.0.0 (CP2A.260805.005, Aug 2026)", "cp2a.260805.005")}
${row("tokay", "17.0.0 (CP2A.260805.005.A1, Aug 2026, AT&amp;T)", "cp2a.260805.005.a1")}
${row("tokay", "17.0.0 (CP3A.260905.009, Sep 2026)", "cp3a.260905.009")}</table>
<h2 id="oriole" data-text='"oriole" for Pixel 6' tabindex="-1">"oriole" for Pixel 6</h2>
<table>${row("oriole", "17.0.0 (CP3A.260905.009, Sep 2026)", "cp3a.260905.009")}</table>
<h2 id="sailfish" data-text='"sailfish" for Pixel' tabindex="-1">"sailfish" for Pixel</h2>
<table>${row("sailfish", "9.0.0 (PQ3A.190801.002, Aug 2019)", "pq3a.190801.002")}
${row("sailfish", "10.0.0 (QP1A.191005.007.A3, Dec 2019)", "qp1a.191005.007.a3")}</table>`;

describe("parseOtaPage", () => {
  it("reads devices, builds, months and variants", () => {
    const [tokay] = parseOtaPage(PAGE);
    expect(tokay?.name).toBe("Pixel 9");
    expect(tokay?.builds.map((b) => [b.build, b.patch, b.variant])).toEqual([
      ["CP2A.260805.005", "2026-08", undefined],
      ["CP2A.260805.005.A1", "2026-08", "AT&T"],
      ["CP3A.260905.009", "2026-09", undefined],
    ]);
  });

  it("fails loudly on a page without devices", () => {
    expect(() => parseOtaPage("<html>terms</html>")).toThrow(/no devices/);
  });

});

// As source.android.com lays out its build numbers (October 2026), cut to a few rows; one row's devices split on a full-width comma.
const build = (id: string, devices: string, patch: string): string =>
  `<tr>
<td>${id}</td>
<td>android-x</td>
<td>Android17</td>
<td>${devices}</td>
<td>${patch}</td>
</tr>`;
const BUILD_NUMBERS_PAGE = `<table><tr><th>Codename</th></tr><tr><td>Android17</td><td>17</td></tr></table>
<h2 id="source-code-tags-and-builds" data-text="Source code tags and builds">Source code tags and builds</h2>
<table><thead><tr><th>Build ID</th><th>Tag</th><th>Version</th><th>Supported devices</th><th>Security patch level</th></tr></thead><tbody>
${build("CP3A.260905.009", "Pixel 6, Pixel 9", "2026-09-05")}
${build("15848949", "", "2026-05-05")}
${build("SD1A.210817.019.C4", "Pixel 6，Pixel 6 Pro", "2021-10-05")}
${build("TQ1A.230205.002", "Pixel 9", "2026-08-05")}
<tr><td>Earliest Gingerbread version</td></tr>
</tbody></table>
<h2 id="build-targets">Device codenames</h2><table><tr><td>Pixel 6</td><td>oriole</td></tr></table>`;

describe("Pixel release days", () => {
  it("read each device name's first security patch month from the build numbers", () => {
    expect(firstPatches(BUILD_NUMBERS_PAGE)).toEqual(new Map([["pixel6", "2021-10"], ["pixel9", "2026-08"], ["pixel6pro", "2021-10"]]));
    expect(() => firstPatches("<html></html>")).toThrow(/layout changed/);
  });

  it("take the earlier of the OTA page's first build and the build numbers' first patch, with the page that gave it", () => {
    expect(pixelDevices(parseOtaPage(PAGE), firstPatches(BUILD_NUMBERS_PAGE))).toEqual([
      { code: "tokay", family: "android", released: "2026-08", boards: [], evidence: OTA_PAGE },
      // The OTA page dropped oriole's first builds; the build numbers kept them.
      { code: "oriole", family: "android", released: "2021-10", boards: [], evidence: BUILD_NUMBERS },
      { code: "sailfish", family: "android", released: "2019-08", boards: [], evidence: OTA_PAGE },
    ]);
  });
});

describe("held builds the OTA page dropped", () => {
  const held = [
    { id: "CP3A.260905.009", devices: ["oriole", "tokay"] },
    { id: "SD1A.210817.019.C4", devices: ["oriole", "raven"] },
  ];

  it("are reported with the devices the page no longer lists them for", () => {
    expect(delisted(parseOtaPage(PAGE), held)).toEqual(["SD1A.210817.019.C4: oriole, raven"]);
  });

  it("are neither planned again nor deleted: no job deletes a release", () => {
    expect(planBuilds(parseOtaPage(PAGE), new Map(held.map((r) => [r.id, new Set(r.devices)])), false).map((b) => b.build)).not.toContain("SD1A.210817.019.C4");
    const deletes = Object.values(JOBS).flatMap((j): readonly string[] => j.deletes);
    expect(deletes.filter((p) => p.startsWith("releases/") || releasePrefix("android").startsWith(p))).toEqual([]);
  });
});

describe("planBuilds", () => {
  const devices: OtaDevice[] = parseOtaPage(PAGE);

  it("plans every general build since Android 10, with every device that lists it", () => {
    expect(planBuilds(devices, new Map(), false)).toEqual([
      { build: "QP1A.191005.007.A3", version: "10", patch: "2019-12", devices: [{ device: "sailfish", url: expect.any(String) }] },
      { build: "CP2A.260805.005", version: "17", patch: "2026-08", devices: [{ device: "tokay", url: expect.stringContaining("tokay-ota-cp2a.260805.005-") }] },
      { build: "CP3A.260905.009", version: "17", patch: "2026-09", devices: [{ device: "oriole", url: expect.any(String) }, { device: "tokay", url: expect.any(String) }] },
    ]);
  });

  it("skips held builds unless a device is missing or rebuild is asked", () => {
    const held = new Map([["CP2A.260805.005", new Set(["tokay"])], ["CP3A.260905.009", new Set(["tokay"])]]);
    expect(planBuilds(devices, held, false).map((b) => b.build)).toEqual(["QP1A.191005.007.A3", "CP3A.260905.009"]);
    expect(planBuilds(devices, held, true).map((b) => b.build)).toEqual(["QP1A.191005.007.A3", "CP2A.260805.005", "CP3A.260905.009"]);
  });
});

describe("CarrierSettings files", () => {
  const file = (where: SettingsFile["in"], name: string): SettingsFile =>
    ({ in: where, bytes: new Uint8Array(), source: `android:carrier:${name}`, version: "1", path: where === "file" ? `${name}.pb` : `others.pb#${name}` });

  it("leaves out an others.pb part named like a file of its own, and says so", () => {
    const left: string[] = [];
    const kept = unshadowed([file("file", "telenor_se"), file("others.pb", "telenor_se"), file("others.pb", "20209")], (f) => left.push(f.path));
    expect(kept.map((f) => f.path)).toEqual(["telenor_se.pb", "others.pb#20209"]);
    expect(left).toEqual(["others.pb#telenor_se"]);
  });

  it("reads every .pb but the label, and refuses anything else", () => {
    expect(settingsNames(["carrier_list.pb", "label", "others.pb"], "product/etc/CarrierSettings")).toEqual(["carrier_list.pb", "others.pb"]);
    expect(() => settingsNames(["carrier_list.pb", "notes.txt"], "product/etc/CarrierSettings")).toThrow(/notes\.txt is not a \.pb/);
  });

  it("refuses any other repeat", () => {
    expect(() => unshadowed([file("others.pb", "x"), file("others.pb", "x")], () => {})).toThrow(/others\.pb#x, others\.pb#x/);
  });
});

describe("release merge", () => {
  const sha = (c: string): string => c.repeat(64);
  const part = (device: string, list: string | null, files: Array<[SourceKey<"android">, string, string]>): JobOutput<"android.ota"> => ({
    build: "B", device, carrierList: list, files: files.map(([source, s, version]) => ({ source, sha: sha(s), version, size: 1 })),
  });

  it("groups devices by identical bytes, most widely shipped first", () => {
    const parts = [
      part("tokay", sha("c"), [["android:carrier:a", "1", "5"], ["android:carrier:b", "2", "6"]]),
      part("comet", sha("c"), [["android:carrier:a", "1", "5"], ["android:carrier:b", "3", "6"]]),
      part("oriole", sha("c"), [["android:carrier:a", "4", "9"]]),
      part("tangorpro", null, []),
    ];
    expect(mergeSources(parts)).toEqual({
      "android:carrier:a": [
        { sha: sha("1"), version: "5", size: 1, devices: ["comet", "tokay"] },
        { sha: sha("4"), version: "9", size: 1, devices: ["oriole"] },
      ],
      "android:carrier:b": [
        { sha: sha("2"), version: "6", size: 1, devices: ["tokay"] },
        { sha: sha("3"), version: "6", size: 1, devices: ["comet"] },
      ],
    });
    expect(carrierList(parts)).toBe(sha("c"));
  });

  it("keeps the same bytes at different versions apart, as others.pb's parts ship them", () => {
    const parts = [
      part("akita", sha("c"), [["android:carrier:20209", "1", "77000000099"]]),
      part("tokay", sha("c"), [["android:carrier:20209", "1", "77000000087"]]),
      part("husky", sha("c"), [["android:carrier:20209", "1", "77000000099"]]),
    ];
    expect(mergeSources(parts)).toEqual({
      "android:carrier:20209": [
        { sha: sha("1"), version: "77000000099", size: 1, devices: ["akita", "husky"] },
        { sha: sha("1"), version: "77000000087", size: 1, devices: ["tokay"] },
      ],
    });
  });

  it("refuses disagreeing carrier lists and builds without any", () => {
    expect(() => carrierList([part("tokay", sha("c"), []), part("oriole", sha("d"), [])])).toThrow(AndroidReleaseError);
    expect(() => carrierList([part("tangorpro", null, [])])).toThrow(AndroidReleaseError);
  });
});

describe("modem merge", () => {
  const sha = (c: string): string => c.repeat(64);
  type Modem = NonNullable<JobOutput<"android.modem">["modem"]>;
  const part = (device: string, modem: Modem | null): JobOutput<"android.modem"> => ({ build: "B", device, modem });
  const shannon = (firmware: string, configs: Modem["configs"]): Modem => ({ family: "shannon", firmware, configs });

  it("groups devices with the same firmware and config shas, leaving out devices without a modem", () => {
    const merged = mergeModems([
      part("tokay", shannon("g5400c-2", { us_tmo: sha("1"), us_vzw: sha("2") })),
      // Same configs, listed in another order.
      part("comet", shannon("g5400c-2", { us_vzw: sha("2"), us_tmo: sha("1") })),
      part("caiman", shannon("g5400c-2", { us_tmo: sha("1"), us_vzw: sha("3") })),
      part("oriole", shannon("g5123b-1", { us_tmo: sha("4") })),
      part("tangorpro", null),
    ]);
    expect(merged).toEqual([
      { family: "shannon", firmware: "g5123b-1", devices: ["oriole"], configs: { us_tmo: sha("4") } },
      { family: "shannon", firmware: "g5400c-2", devices: ["caiman"], configs: { us_tmo: sha("1"), us_vzw: sha("3") } },
      { family: "shannon", firmware: "g5400c-2", devices: ["comet", "tokay"], configs: { us_tmo: sha("1"), us_vzw: sha("2") } },
    ]);
    expect(mergeModems([part("tangorpro", null)])).toEqual([]);
  });
});
