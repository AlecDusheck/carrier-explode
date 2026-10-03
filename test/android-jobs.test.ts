/** The android.* extractor jobs' pure parts: the OTA page, the plan policy, and the release merge. */

import { describe, expect, it } from "vitest";
import { AndroidReleaseError, carrierList, mergeSources } from "../extractor/container/src/jobs/android-merge.ts";
import { parseOtaPage, type OtaDevice } from "../extractor/container/src/jobs/android-page.ts";
import { planBuilds } from "../extractor/container/src/jobs/android-plan.ts";
import type { JobOutput } from "../extractor/src/jobs.ts";

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
<table>${row("sailfish", "10.0.0 (QP1A.191005.007.A3, Dec 2019)", "qp1a.191005.007.a3")}</table>`;

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

describe("planBuilds", () => {
  const devices: OtaDevice[] = parseOtaPage(PAGE);

  it("plans current devices' general builds, every device per build, retired devices left out", () => {
    expect(planBuilds(devices, new Map(), false)).toEqual([
      { build: "CP2A.260805.005", version: "17", patch: "2026-08", devices: [{ device: "tokay", url: expect.stringContaining("tokay-ota-cp2a.260805.005-") }] },
      { build: "CP3A.260905.009", version: "17", patch: "2026-09", devices: [{ device: "oriole", url: expect.any(String) }, { device: "tokay", url: expect.any(String) }] },
    ]);
  });

  it("skips held builds unless a device is missing or rebuild is asked", () => {
    const held = new Map([["CP2A.260805.005", new Set(["tokay"])], ["CP3A.260905.009", new Set(["tokay"])]]);
    expect(planBuilds(devices, held, false).map((b) => b.build)).toEqual(["CP3A.260905.009"]);
    expect(planBuilds(devices, held, true).map((b) => b.build)).toEqual(["CP2A.260805.005", "CP3A.260905.009"]);
  });
});

describe("release merge", () => {
  const sha = (c: string): string => c.repeat(64);
  const part = (device: string, list: string | null, files: Array<[string, string, string]>): JobOutput<"android.ota"> => ({
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

  it("refuses disagreeing carrier lists and builds without any", () => {
    expect(() => carrierList([part("tokay", sha("c"), []), part("oriole", sha("d"), [])])).toThrow(AndroidReleaseError);
    expect(() => carrierList([part("tangorpro", null, [])])).toThrow(AndroidReleaseError);
  });
});
