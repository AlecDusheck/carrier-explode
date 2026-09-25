import { describe, it, expect } from "vitest";
import { modemView, pickModem } from "../src/lib/server/modems.ts";
import type { ImageModem } from "../src/lib/server/timeline.ts";

const modem = (family: string, kind: "bbfw" | "ftab", devices: string[]): ImageModem => ({
  family, devices, package: { id: family.toLowerCase().padEnd(64, "0"), size: 1, name: family, crc32: "00000000", kind },
});
// 24A437, newest phone first, as scripts/modems.py writes it.
const MODEMS = [modem("C1", "ftab", ["iPhone17,5", "iPhone18,4"]), modem("Mav25", "bbfw", ["iPhone18,1"]), modem("Mav24", "bbfw", ["iPhone17,1"])];

describe("pickModem", () => {
  it("takes the named family", () => {
    expect(pickModem(MODEMS, { family: "Mav24" })?.family).toBe("Mav24");
    expect(pickModem(MODEMS, { family: "C1", kind: "bbfw" })).toBeUndefined();
  });

  it("defaults to the package serving the phone, then the first Qualcomm one", () => {
    expect(pickModem(MODEMS, { device: "iPhone17,1" })?.family).toBe("Mav24");
    expect(pickModem(MODEMS, { device: "iPhone18,4" })?.family).toBe("C1");
    expect(pickModem(MODEMS, { device: "iPhone18,4", kind: "bbfw" })?.family).toBe("Mav25");
    expect(pickModem(MODEMS)?.family).toBe("Mav25");
    expect(pickModem([])).toBeUndefined();
  });
});

describe("modemView", () => {
  it("names the phones and the vendor", () => {
    expect(modemView(MODEMS[0])).toEqual({
      family: "C1", vendor: "apple",
      package: { id: MODEMS[0].package.id, name: "C1", size: 1, kind: "ftab" },
      devices: [{ id: "iPhone17,5", name: "iPhone 16e" }, { id: "iPhone18,4", name: "iPhone Air" }],
    });
  });
});
