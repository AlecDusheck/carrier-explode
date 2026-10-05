// The Alerts tab's cell-broadcast row, read off real and hand-made bundles.

import { readFileSync } from "node:fs";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { decodedPlist, decodeFile, openIpcc } from "@carrier-explode/decode-ios";
import { isRecord } from "@carrier-explode/values";
import { cbsRow } from "../src/lib/server/apple/cbs.ts";
import type { CbsRow } from "../src/lib/server/apple/cbs.ts";

/** decode-ios owns the .ipcc fixtures. */
const fixture = (n: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../packages/decode-ios/test/fixtures/${n}`, import.meta.url)));

const enc = new TextEncoder();
const xmlPlist = (body: string) =>
  enc.encode(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0">${body}</plist>`);

/** A bundle's cell-broadcast row, read as the Alerts tab reads it. */
function rowOf(bytes: Uint8Array): CbsRow {
  const b = openIpcc(bytes);
  const plist = decodedPlist(decodeFile(b, "carrier.plist"));
  if (!isRecord(plist)) throw new Error("carrier.plist is not a dict");
  return cbsRow(plist, b.info.files.filter((f) => f.path.endsWith("CBMessage.strings")).flatMap((f) => f.locale ?? []));
}


describe("cbsRow against the real UnitedStates bundle", () => {
  it("reads the country's names and codes", () => {
    const row = rowOf(fixture("country-us.ipcc"));
    expect(row.countryName).toBe("United States of America");
    expect(row.iso).toEqual(["us"]);
    expect(row.hasCellBroadcast).toBe(true);
  });

  it("maps the exact 3GPP message identifier ranges", () => {
    const row = rowOf(fixture("country-us.ipcc"));
    expect(row.mappings).toEqual([
      { from: 4370, to: 4370, alertType: "Presidential", configuration: "Configuration_us" },
      { from: 4371, to: 4378, alertType: "Emergency", configuration: "Configuration_us" },
      { from: 4379, to: 4379, alertType: "AMBER", configuration: "Configuration_us" },
      { from: 4383, to: 4383, alertType: "Presidential", configuration: "Configuration_us" },
      { from: 4384, to: 4391, alertType: "Emergency", configuration: "Configuration_us" },
      { from: 4392, to: 4392, alertType: "AMBER", configuration: "Configuration_us" },
      { from: 4396, to: 4397, alertType: "PublicSafety", configuration: "Configuration_us" },
      { from: 4398, to: 4399, alertType: "Test", configuration: "Configuration_us" },
      { from: 4400, to: 4400, alertType: "WHAM", configuration: "Configuration_WHAM" },
    ]);
    // 4380-4382 and 4393-4395 are deliberately unmapped in the US bundle.
    for (const id of [4380, 4381, 4382, 4393, 4394, 4395]) {
      expect(row.mappings.some((m) => id >= m.from && id <= m.to)).toBe(false);
    }
  });

  it("reports the alert types, with Presidential locked on", () => {
    const row = rowOf(fixture("country-us.ipcc"));
    expect(row.alertTypes.map((a) => a.name)).toEqual([
      "AMBER", "Emergency", "Presidential", "PublicSafety", "Test", "WHAM",
    ]);
    const presidential = row.alertTypes.find((a) => a.name === "Presidential")!;
    expect(presidential.userConfigurable).toBe(false);
    expect(presidential.enabledByDefault).toBe(true);
    expect(presidential.switchName).toBe("National Alert");
    expect(presidential.notificationTitle).toBe("National Alert");
    expect(presidential.soundAlertDeviceInMute).toBe(true);
  });

  it("reports the silent WHAM geofencing-trigger alert type", () => {
    const row = rowOf(fixture("country-us.ipcc"));
    expect(row.alertTypes.find((a) => a.name === "WHAM")).toEqual({
      name: "WHAM",
      enabledByDefault: true,
      userConfigurable: false,
      switchName: "",
      notificationTitle: "",
      soundAlertDeviceInMute: undefined,
      soundIsMutableInDND: undefined,
    });
    expect(row.mappings.find((m) => m.from === 4400)!.alertType).toBe("WHAM");
  });

  it("reads the Emergency and Test alert types' switches", () => {
    const row = rowOf(fixture("country-us.ipcc"));
    const emergency = row.alertTypes.find((a) => a.name === "Emergency")!;
    expect(emergency.userConfigurable).toBe(true);
    expect(row.alertTypes.find((a) => a.name === "Test")!.enabledByDefault).toBe(false);
  });

  it("reports the AppleSafetyAlert ranges", () => {
    const row = rowOf(fixture("country-us.ipcc"));
    expect(row.appleSafetyAlertRanges).toEqual([
      { from: 4370, to: 4378 },
      { from: 4383, to: 4391 },
      { from: 4396, to: 4397 },
    ]);
  });

  it("reports geofencing and duplicate detection", () => {
    const row = rowOf(fixture("country-us.ipcc"));
    expect(row.geofencing).toBe(true);
    expect(row.duplicateWindowMinutes).toBe(30);
    expect(row.interSimDuplicateDetection).toBe(true);
    expect(row.intraSimDuplicateDetection).toBe(true);
    expect(row.switchGroupTitle).toBe("Government Alerts");
    expect(row.languages).toEqual(["en"]);
  });

  it("reports the alert configurations and emergency numbers", () => {
    const row = rowOf(fixture("country-us.ipcc"));
    expect(row.alertConfigurations).toEqual([
      { name: "Configuration_WHAM", sound: "Text", vibration: "Default" },
      { name: "Configuration_us", sound: "cbs_alert_us.caf", vibration: "cbs_vibe_us.plist" },
      {
        name: "Configuration_eq",
        sound: "cbs_local_earthquake_us.caf",
        vibration: "cbs_vibe_ca.plist",
      },
    ]);
    expect(row.emergencyNumbers).toEqual(["911"]);
    expect(row.amlDestination).toBeUndefined();
    // UnitedStates.ipcc ships no CBMessage.strings.
    expect(row.cbMessageLocales).toEqual([]);
  });

  it("reads the AML SMS destination and multi-ISO list out of the Watch bundle", () => {
    const row = rowOf(fixture("watch-country-australia.ipcc"));
    expect(row.amlDestination).toBe("1262612626");
    expect(row.iso).toEqual(["au", "cx", "cc"]);
    expect(row.switchGroupTitle).toBe("AusAlert");
    expect(row.emergencyNumbers).toEqual(["000"]);
    expect(row.alertTypes.map((a) => a.name)).toEqual([
      "CriticalAusAlert", "Exercise", "PriorityAusAlert", "StateLocalTest", "WHAM",
    ]);
  });

  it("handles a bundle with no GeofencingConfiguration or DuplicateDetectionParameters", () => {
    const row = rowOf(fixture("country-germany.ipcc"));
    expect(row.hasCellBroadcast).toBe(true);
    expect(row.geofencing).toBeUndefined();
    expect(row.duplicateWindowMinutes).toBeUndefined();
    expect(row.interSimDuplicateDetection).toBeUndefined();
    expect(row.intraSimDuplicateDetection).toBeUndefined();
    expect(row.switchGroupTitle).toBe("Cell Broadcast Alerts");
    expect(row.languages).toEqual(["de"]);
    expect(row.emergencyNumbers).toEqual(["112", "110", "124124"]);
    expect(row.mappings.map((m) => m.from)).toEqual([4370, 4372, 4383, 4385, 4396, 4398]);
    expect(row.appleSafetyAlertRanges).toEqual([]);
  });

  it("collects CBMessage.strings locales", () => {
    // CW_wi is a carrier bundle, but it is the only fixture that ships
    // CBMessage.strings, so it exercises the locale collector.
    const row = rowOf(fixture("carrier-cw-wi.ipcc"));
    expect(row.cbMessageLocales).toHaveLength(41);
    expect(row.cbMessageLocales).toContain("en");
    expect(row.cbMessageLocales).toContain("zh_TW");
    expect(row.cbMessageLocales).toEqual([...row.cbMessageLocales].sort());
  });

  it("returns an empty but valid row for a bundle with no CellBroadcast key", () => {
    const row = rowOf(fixture("carrier-cw-wi.ipcc"));
    expect(row.hasCellBroadcast).toBe(false);
    expect(row.mappings).toEqual([]);
    expect(row.alertTypes).toEqual([]);
    expect(row.alertConfigurations).toEqual([]);
    expect(row.appleSafetyAlertRanges).toEqual([]);
    expect(row.languages).toEqual([]);
    expect(row.geofencing).toBeUndefined();
    expect(row.emergencyNumbers).toEqual([]);
    expect(row.countryName).toBeUndefined();
  });
});

describe("cbsRow edge cases", () => {
  it("skips mappings whose service ids are not numbers", () => {
    const zip = zipSync(
      {
        "Payload/B.bundle/carrier.plist": xmlPlist(
          `<dict><key>CellBroadcast</key><dict><key>MessageIDParameters3GPP</key><array>` +
            `<dict><key>FromServiceID</key><string>4370</string></dict>` +
            `<dict><key>FromServiceID</key><integer>4400</integer></dict>` +
            `</array></dict></dict>`,
        ),
      },
      { level: 0 },
    );
    const row = rowOf(zip);
    expect(row.mappings).toEqual([
      { from: 4400, to: 4400, alertType: undefined, configuration: undefined },
    ]);
  });

  it("keeps a mapping's alert type and configuration", () => {
    const zip = zipSync(
      {
        "Payload/S.bundle/carrier.plist": xmlPlist(
          `<dict><key>CellBroadcast</key><dict><key>MessageIDParameters3GPP</key><array>` +
            `<dict><key>FromServiceID</key><integer>4382</integer><key>AlertType</key><string>Operator</string>` +
            `<key>AlertConfiguration</key><string>Cfg</string></dict></array></dict></dict>`,
        ),
      },
      { level: 0 },
    );
    expect(rowOf(zip).mappings).toEqual([
      { from: 4382, to: 4382, alertType: "Operator", configuration: "Cfg" },
    ]);
  });
});
