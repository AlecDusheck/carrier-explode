import { describe, it, expect } from "vitest";
import { modemView } from "../src/lib/server/modems.ts";
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

describe("a version's own files for a phone", () => {
  const files = [pri("overrides_D93_D94_D47_D48.der.pri"), pri("overrides_V63_V64s_V68.der.pri")];

  it("finds the phone's file by the boards in its name", () => {
    expect(overridesFor(files, "iPhone19,2").map((f) => f.path)).toEqual(["overrides_V63_V64s_V68.der.pri"]);
  });

  it("knows a phone the version names a newer model than, so no file means none", () => {
    expect(overridesFor(files, "iPhone15,2")).toEqual([]);
    expect(knowsPhone(files, "iPhone15,2")).toBe(true);
  });

  it("does not know a phone newer than every file it names", () => {
    expect(knowsPhone([pri("overrides_D93_D94_D47_D48.der.pri")], "iPhone19,2")).toBe(false);
  });
});
