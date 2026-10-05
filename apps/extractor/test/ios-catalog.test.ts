import { describe, expect, it } from "vitest";

import { appledbEntry } from "../src/feeds/apple-ipsw/catalog.ts";
import { appleDbDevicesSchema, appleDeviceRecords } from "../src/feeds/apple-ipsw/devices.ts";
import * as v from "valibot";

describe("AppleDB devices", () => {
  // Records as main.json has them: a day or several, boards with their AP suffix, two records for one product type.
  const records = v.parse(appleDbDevicesSchema, [
    { name: "iPhone 12", key: "iPhone13,2", identifier: ["iPhone13,2"], board: ["D53gAP"], released: ["2020-10-23", "2021-04-30"] },
    { name: "iPhone 6s", key: "iPhone8,1", identifier: ["iPhone8,1"], board: ["N71AP", "N71mAP"], released: ["2015-09-25", "2016-09-16"] },
    { name: "Apple Watch (1st generation) (42mm) (Store Display Model)", key: "Watch1,2-Store-Dock", identifier: ["Watch1,2"], board: ["N28aAP"], released: "2015-04-24" },
    { name: "Apple Watch (1st generation) (42mm)", key: "Watch1,2", identifier: ["Watch1,2"], board: ["N28aAP"], released: "2015-04-24" },
    { name: "Unreleased Apple Watch Series 2 (Cellular, 38mm)", key: "Watch2,1", identifier: ["Watch2,1"], board: ["N64AP"] },
    { name: "Apple USB SuperDrive", key: "Apple USB SuperDrive", identifier: [], board: [] },
  ]);

  it("gives each product type its earliest day and every board, and leaves out what has no day or board", () => {
    expect(appleDeviceRecords(records)).toEqual([
      { code: "iPhone13,2", family: "apple", released: "2020-10-23", boards: ["D53gAP"] },
      { code: "iPhone8,1", family: "apple", released: "2015-09-25", boards: ["N71AP", "N71mAP"] },
      { code: "Watch1,2", family: "apple", released: "2015-04-24", boards: ["N28aAP"] },
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
    expect([...appledbEntry({ version: "27.2", build: "24B80", devices }).ipsws]).toEqual([["iPhone18,1", "https://updates.cdn-apple.com/a.ipsw"]]);
    expect(appledbEntry({ version: "27.2", build: "24B80" })).toEqual({ version: "27.2", build: "24B80", beta: false, ipsws: new Map() });
  });

  it("parses a beta record, cutting the date to the day", () => {
    const e = appledbEntry({ version: "27.2 beta 2", build: "24B5089g", beta: true, released: "2026-11-02", devices: { "iPhone17,1": { ipsw: "u" } } });
    expect([e.version, e.build, e.beta, e.released, [...e.ipsws.keys()]]).toEqual(["27.2 beta 2", "24B5089g", true, "2026-11-02", ["iPhone17,1"]]);
  });

  it("refuses a record without a build", () => {
    expect(() => appledbEntry({ version: "27.2" })).toThrow();
  });
});
