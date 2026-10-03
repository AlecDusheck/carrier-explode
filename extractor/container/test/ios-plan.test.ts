// The planner's cases from scripts/test_plan.py, against ../src/jobs/ios/plan/plan.ts.

import { describe, expect, it } from "vitest";

import { compareVersions } from "../../../src/lib/decode/index.ts";
import { betaCandidates, distinctIpsws, plan, planBetas, planRebuild, type BetaEntry, type Fw, type Held } from "../src/jobs/ios/plan/plan.ts";

const fw = (version: string, build: string, device = "iPhone17,1"): Fw => ({ version, build, device });
const P = [fw("27.0", "24A437"), fw("26.6.2", "23G90"), fw("26.6.1", "23G83"), fw("26.4", "23E246"), fw("26.0", "23A341")];

const held = (...versions: string[]): Held[] =>
  versions.map((v) => {
    const f = P.find((x) => x.version === v);
    if (!f) throw new Error(`no fixture for ${v}`);
    return { version: v, build: f.build, devices: ["iPhone17,1"] };
  });

const versions = (xs: ReadonlyArray<{ readonly version: string }>): string[] => xs.map((x) => x.version);

describe("plan", () => {
  it("takes every missing release, not just the latest", () => {
    expect(versions(plan(held("26.4"), P, [], { cap: 9 }))).toEqual(["26.6.1", "26.6.2", "27.0"]);
  });

  it("never goes below the oldest held image", () => {
    expect(versions(plan(held("26.4"), P, [], { cap: 9 }))).not.toContain("26.0");
  });

  it("caps from the oldest missing, so history fills in order", () => {
    expect(versions(plan(held("26.4"), P, [], { cap: 2 }))).toEqual(["26.6.1", "26.6.2"]);
  });

  it("takes only the newest into an empty bucket", () => {
    expect(versions(plan([], P, [], { cap: 3 }))).toEqual(["27.0"]);
  });

  it("has nothing to do when everything is held", () => {
    expect(plan(held(...versions(P)), P, [], { cap: 3 })).toEqual([]);
  });

  it("takes an explicit version whether held or below the floor", () => {
    const got = plan(held("26.4"), P, [], { cap: 3, only: "26.0" });
    expect(got.map((x) => [x.version, x.build, x.device])).toEqual([["26.0", "23A341", "iPhone17,1"]]);
  });

  it("carries the release date", () => {
    expect(plan([], [{ ...fw("27.0", "24A437"), released: "2026-09-15" }], [], { cap: 3, only: "27.0" })[0]?.released).toBe("2026-09-15");
  });

  it("falls back to a newer device only for releases the preferred one lacks", () => {
    const newer = [fw("28.0", "25A1", "iPhone19,7"), fw("27.0", "24A999", "iPhone19,7")];
    const got = new Map(plan(held("26.6.2"), P, newer, { cap: 9 }).map((x) => [x.version, x]));
    expect(got.get("28.0")?.device).toBe("iPhone19,7");
    expect([got.get("27.0")?.device, got.get("27.0")?.build]).toEqual(["iPhone17,1", "24A437"]);
  });

  it("sets the floor from since, even on an empty bucket", () => {
    expect(versions(plan([], P, [], { cap: 9, since: "26.4" }))).toEqual(["26.4", "26.6.1", "26.6.2", "27.0"]);
  });

  it("picks up a re-issued build of a held version", () => {
    const h: Held[] = [{ version: "27.0", build: "24A400", devices: ["iPhone17,1"] }, ...held("26.4")];
    const got = plan(h, P, [], { cap: 9 });
    expect(got.map((x) => [x.version, x.build])).toContainEqual(["27.0", "24A437"]);
    expect(versions(got)).not.toContain("26.4");
  });

  it("does not fetch a version held from the fallback device twice", () => {
    const h: Held[] = [{ version: "28.0", build: "25A1", devices: ["iPhone19,7"] }, ...held("26.4")];
    expect(versions(plan(h, [fw("28.0", "25A9"), ...P], [], { cap: 9 }))).not.toContain("28.0");
  });

  it("orders versions numerically", () => {
    const got = plan([{ version: "9.3", build: "z", devices: ["iPhone17,1"] }], [fw("10.0", "a"), fw("9.3.5", "b")], [], { cap: 9 });
    expect(versions(got)).toEqual(["9.3.5", "10.0"]);
  });
});

const beta = (version: string, build: string, devices = ["iPhone17,1"]): BetaEntry => ({
  version,
  build,
  beta: true,
  ipsws: new Map(devices.filter((d) => d.startsWith("iPhone")).map((d) => [d, `https://updates.cdn-apple.com/${d}_${build}.ipsw`])),
});

describe("betas", () => {
  const KEYS = ["iOS;24A5430a", "iOS;24A437", "iOS;24B5084k", "iOS;24B5089g", "iOS;24B5084k-sim", "iOS;24B5084k-27B5019j-SDK", "watchOS;24B5089g", "iOS;25A5001a"];

  it("takes only betas past the newest public release", () => {
    expect(betaCandidates(KEYS, [], P)).toEqual(["24B5084k", "24B5089g", "25A5001a"]);
  });

  it("skips betas already held", () => {
    expect(betaCandidates(KEYS, [{ version: "27.2 beta 1", build: "24B5084k", devices: [] }], P)).toEqual(["24B5089g", "25A5001a"]);
  });

  it("leaves a beta whose release shipped alone", () => {
    expect(betaCandidates(["iOS;24B5089g"], [], [fw("27.2", "24B80"), ...P])).toEqual([]);
  });

  it("plans betas oldest first, with Apple's link", () => {
    const got = planBetas([beta("27.2 beta 2", "24B5089g"), beta("27.2 beta 1", "24B5084k")], "iPhone17,1", 9);
    expect(versions(got)).toEqual(["27.2 beta 1", "27.2 beta 2"]);
    expect([got[0]?.build, got[0]?.label, got[0]?.prerelease]).toEqual(["24B5084k", "27.2 beta 1", true]);
    expect(got[0]?.ipsws[0]).toEqual({ device: "iPhone17,1", url: "https://updates.cdn-apple.com/iPhone17,1_24B5084k.ipsw" });
  });

  it("falls back to the newest iPhone the beta has", () => {
    const got = planBetas([beta("28.0 beta 1", "25A5001a", ["iPhone18,1", "iPhone19,2", "iPad16,1"])], "iPhone17,1", 9);
    expect(got[0]?.ipsws[0]?.device).toBe("iPhone19,2");
  });

  it("ignores records that are not betas", () => {
    expect(planBetas([{ ...beta("27.2", "24B80"), beta: false }], "iPhone17,1", 9)).toEqual([]);
  });
});

describe("versions", () => {
  it("sorts a beta between releases", () => {
    const v = ["27.2", "27.2 beta 10", "27.1", "27.2 beta 2", "27.2 RC", "27.2.1"];
    expect([...v].sort(compareVersions)).toEqual(["27.1", "27.2 beta 2", "27.2 beta 10", "27.2 RC", "27.2", "27.2.1"]);
  });
});

describe("rebuild", () => {
  it("takes every held image newest first, keeping its name, leading with the preferred device", () => {
    const h: Held[] = [
      { version: "27.2 beta 2", build: "24C5", devices: ["iPhone18,1"] },
      { version: "27.0", build: "24A437", devices: ["iPhone17,1"], released: "2026-09-15" },
      { version: "26.0", build: "gone", devices: ["iPhone17,1"] },
    ];
    const urls: Record<string, Array<{ device: string; url: string }>> = {
      "24C5": [{ device: "iPhone18,1", url: "x" }, { device: "iPhone17,1", url: "y" }],
      "24A437": [{ device: "iPhone17,1", url: "a" }, { device: "iPhone18,1", url: "b" }],
    };
    const { builds, missing } = planRebuild(h, (b) => urls[b] ?? [], (b) => (b === "24C5" ? "2026-11-02" : undefined), "iPhone17,1");
    expect(builds.map((g) => [g.version, g.label, g.ipsws[0]?.device])).toEqual([
      ["27.2 beta 2", "27.2 beta 2", "iPhone17,1"],
      ["27.0", "27.0", "iPhone17,1"],
    ]);
    expect(builds[1]?.ipsws).toEqual([{ device: "iPhone17,1", url: "a" }, { device: "iPhone18,1", url: "b" }]);
    expect(builds[1]?.released).toBe("2026-09-15");
    // An image held from before release days were recorded gets one.
    expect(builds[0]?.released).toBe("2026-11-02");
    expect(builds[0]?.prerelease).toBe(true);
    expect(missing).toEqual(["gone"]);
  });
});

describe("distinctIpsws", () => {
  it("keeps one entry per file, the planned device's first, then newest", () => {
    const pairs = [
      { device: "iPhone16,1", url: "a" }, { device: "iPhone17,1", url: "b" }, { device: "iPhone17,2", url: "b" },
      { device: "iPhone18,1", url: "c" }, { device: "iPhone15,2", url: "a" },
    ];
    expect(distinctIpsws(pairs, "iPhone17,2")).toEqual([
      { device: "iPhone17,2", url: "b" }, { device: "iPhone18,1", url: "c" }, { device: "iPhone16,1", url: "a" },
    ]);
  });
});
