// Modem package grouping (../src/jobs/ios/modems/group.ts).

import { describe, expect, it } from "vitest";

import { group, modemMembers, packageKey, type MemberInfo } from "../src/jobs/ios/modems/group.ts";
import type { BuildManifest } from "@carrier-explode/decode-ios";

const zi = (name: string, size: number, crc32: number): MemberInfo => ({ name, size, crc32 });
const MAV24 = zi("Firmware/Mav24-3.02.02.Release.bbfw", 114158255, 0x87670ae3);
const MAV25 = zi("Firmware/Mav25-2.10.01.Release.bbfw", 137531115, 0xade9fca3);
const C1 = zi("Firmware/c4000v59/Release/patched/ftab.bin", 208967425, 0x912e2e46);
const ROSE = zi("Firmware/Rose/r2p1/ftab.bin", 1069076, 0x36ef021f);
const T2026 = zi("Firmware/t2026phoneG1/Release/ftab.bin", 29455088, 0x0a662aa0);

type Keys = ReadonlyArray<readonly [string, string]>;

/** A manifest with one identity per board: board -> [(manifest key, IPSW path)]. */
const manifest = (boards: Record<string, Keys>): BuildManifest => ({
  version: "27.0",
  build: "24A437",
  devices: [],
  identities: Object.entries(boards).map(([board, ents]) => ({ board, variant: "Customer Erase Install (IPSW)", paths: new Map(ents) })),
});

const ROSE_KEYS: Keys = [["Rap,RTKitOS", ROSE.name]];
const WIFI_KEYS: Keys = [["Wireless1,WiFiTx", T2026.name]];
const BB = (z: MemberInfo): Keys => [["BasebandFirmware", z.name], ...ROSE_KEYS];
const CELL = (z: MemberInfo): Keys => [["Cellular1,RTKitOS", z.name], ["Cellular1,LLB", z.name], ...ROSE_KEYS];

// 24A437 as its IPSW directories list it: one IPSW per phone, and one shared by two phones with different modems.
const IPSWS = new Map([["u/17,1", ["iPhone17,1"]], ["u/17,3", ["iPhone17,3"]], ["u/17,5", ["iPhone17,5"]], ["u/18,1", ["iPhone18,1", "iPhone18,4"]]]);
const BOARDS = new Map([["iPhone17,1", ["d93ap"]], ["iPhone17,3", ["d47ap"]], ["iPhone17,5", ["v59ap"]], ["iPhone18,1", ["v53ap"]], ["iPhone18,4", ["d23ap"]]]);
const LISTINGS = new Map([
  ["u/17,1", modemMembers([MAV24, ROSE], manifest({ d93ap: BB(MAV24) }))],
  ["u/17,3", modemMembers([MAV24, ROSE], manifest({ d47ap: BB(MAV24) }))],
  ["u/17,5", modemMembers([ROSE, C1], manifest({ v59ap: CELL(C1) }))],
  ["u/18,1", modemMembers([MAV25, ROSE, T2026, C1], manifest({ v53ap: [...BB(MAV25), ...WIFI_KEYS], d23ap: [...CELL(C1), ...WIFI_KEYS] }))],
]);

describe("modemMembers", () => {
  it("keeps only what the manifest names as a modem", () => {
    const m = manifest({ v53ap: [...BB(MAV25), ...WIFI_KEYS], d23ap: CELL(C1) });
    const got = modemMembers([MAV25, ROSE, T2026, C1, zi("Firmware/all_flash/iBoot.im4p", 1, 1)], m);
    expect(got.map((x) => [x.name, x.kind, x.boards])).toEqual([
      ["Mav25-2.10.01.Release.bbfw", "bbfw", ["v53ap"]],
      ["c4000v59/Release/patched/ftab.bin", "ftab", ["d23ap"]],
    ]);
    expect(got[0]?.crc32).toBe("ade9fca3");
    expect(got[1]?.member).toBe("Firmware/c4000v59/Release/patched/ftab.bin");
  });
});

describe("group", () => {
  it("gives one entry per package, with every phone, newest first", () => {
    expect(group(IPSWS, LISTINGS, BOARDS).map((g) => [g.name, g.devices])).toEqual([
      ["c4000v59/Release/patched/ftab.bin", ["iPhone17,5", "iPhone18,4"]],
      ["Mav25-2.10.01.Release.bbfw", ["iPhone18,1"]],
      ["Mav24-3.02.02.Release.bbfw", ["iPhone17,1", "iPhone17,3"]],
    ]);
  });

  it("gives a phone with unknown boards every modem of its IPSW", () => {
    const boards = new Map([...BOARDS].filter(([d]) => d !== "iPhone18,4"));
    expect(group(IPSWS, LISTINGS, boards).find((g) => g.name.startsWith("Mav25"))?.devices).toContain("iPhone18,4");
  });

  it("treats the same name with different bytes as two packages", () => {
    const other = zi(MAV24.name, MAV24.size, 0x1);
    const got = group(
      new Map([["a", ["iPhone17,1"]], ["b", ["iPhone17,2"]]]),
      new Map([["a", modemMembers([MAV24], manifest({ d93ap: BB(MAV24) }))], ["b", modemMembers([other], manifest({ d94ap: BB(other) }))]]),
      new Map(),
    );
    expect(got).toHaveLength(2);
  });

  it("keys packages by name, size and CRC32", () => {
    expect(packageKey({ name: "Mav24-3.02.02.Release.bbfw", size: 114158255, crc32: "87670ae3" })).toBe("Mav24-3.02.02.Release.bbfw|114158255|87670ae3");
  });
});
