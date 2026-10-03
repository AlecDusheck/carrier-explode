// BuildManifest parsing (../src/jobs/ios/shared/build-manifest.ts) and the catalogue helpers (../src/jobs/ios/catalog.ts).

import { describe, expect, it } from "vitest";

import { appledbEntry, iphoneIpsws } from "../src/jobs/ios/catalog.ts";
import { modemBoards, osImagePath, parseBuildManifest } from "../src/jobs/ios/shared/build-manifest.ts";

const component = (path: string): string => `<dict><key>Info</key><dict><key>Path</key><string>${path}</string></dict></dict>`;
const identity = (board: string, variant: string, parts: Record<string, string>): string =>
  `<dict><key>Info</key><dict><key>DeviceClass</key><string>${board}</string><key>Variant</key><string>${variant}</string></dict>` +
  `<key>Manifest</key><dict>${Object.entries(parts).map(([k, p]) => `<key>${k}</key>${component(p)}`).join("")}</dict></dict>`;

/** iOS 27.0.1 for iPhone17,1 in miniature: two install identities, a recovery one with its own OS. */
const PLIST = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>ProductVersion</key><string>27.0.1</string>
<key>ProductBuildVersion</key><string>24A446</string>
<key>SupportedProductTypes</key><array><string>iPhone17,2</string><string>iPhone17,1</string></array>
<key>BuildIdentities</key><array>
${identity("D93AP", "Customer Erase Install (IPSW)", { OS: "043-70165-666.dmg.aea", BasebandFirmware: "Firmware/Mav24-3.02.02.Release.bbfw", "Rap,RTKitOS": "Firmware/Rose/r2p1/ftab.bin" })}
${identity("D93AP", "Customer Upgrade Install (IPSW)", { OS: "043-70165-666.dmg.aea", BasebandFirmware: "Firmware/Mav24-3.02.02.Release.bbfw" })}
${identity("D94AP", "Customer Erase Install (IPSW)", { OS: "043-70165-666.dmg.aea", "Cellular1,RTKitOS": "Firmware/c4000v59/Release/patched/ftab.bin" })}
${identity("D93AP", "Recovery Customer Install", { OS: "043-68523-763.dmg.aea" })}
</array></dict></plist>`);

describe("parseBuildManifest", () => {
  const m = parseBuildManifest(PLIST);

  it("reads version, build and phones, oldest first", () => {
    expect([m.version, m.build, m.devices]).toEqual(["27.0.1", "24A446", ["iPhone17,1", "iPhone17,2"]]);
    expect(m.identities.map((i) => i.board)).toEqual(["d93ap", "d93ap", "d94ap", "d93ap"]);
  });

  it("finds the root filesystem image, not the recovery OS", () => {
    expect(osImagePath(m)).toBe("043-70165-666.dmg.aea");
  });

  it("refuses two different install images", () => {
    const two = new TextDecoder().decode(PLIST).replace("Customer Upgrade Install (IPSW)</string></dict><key>Manifest</key><dict><key>OS</key>" + component("043-70165-666.dmg.aea"), "Customer Upgrade Install (IPSW)</string></dict><key>Manifest</key><dict><key>OS</key>" + component("other.dmg"));
    expect(() => osImagePath(parseBuildManifest(new TextEncoder().encode(two)))).toThrow(/2 OS images/);
  });

  it("maps each modem package to the boards that use it, not Rose or Wi-Fi", () => {
    expect([...modemBoards(m)]).toEqual([
      ["Firmware/Mav24-3.02.02.Release.bbfw", ["d93ap"]],
      ["Firmware/c4000v59/Release/patched/ftab.bin", ["d94ap"]],
    ]);
  });
});

describe("AppleDB records", () => {
  it("keeps iPhones with a link", () => {
    const devices = {
      "iPhone18,1": { ipsw: "https://updates.cdn-apple.com/a.ipsw" },
      "iPhone18,2": {},
      "iPhone18,3": "iPhone18,1",
      "iPad16,1": { ipsw: "https://updates.cdn-apple.com/b.ipsw" },
    };
    expect([...iphoneIpsws(devices)]).toEqual([["iPhone18,1", "https://updates.cdn-apple.com/a.ipsw"]]);
    expect(iphoneIpsws(null).size).toBe(0);
  });

  it("parses a beta record, cutting the date to the day", () => {
    const e = appledbEntry({ version: "27.2 beta 2", build: "24B5089g", beta: true, released: "2026-11-02", devices: { "iPhone17,1": { ipsw: "u" } } });
    expect([e.version, e.build, e.beta, e.released, [...e.ipsws.keys()]]).toEqual(["27.2 beta 2", "24B5089g", true, "2026-11-02", ["iPhone17,1"]]);
  });

  it("refuses a record without a build", () => {
    expect(() => appledbEntry({ version: "27.2" })).toThrow();
  });
});
