import { describe, it, expect } from "vitest";
import { byNewest, compareProducts, homePhone, modemFor, overridesFor, phoneList, sharedPri, sortPhones } from "../src/lib/phones.ts";
import { modemLabel, modemName } from "../src/lib/decode/modem.ts";
import { describeDevices, productName } from "../src/lib/decode/devices.ts";
import type { BundleFile } from "../src/lib/decode/bundle.ts";

const phones = (...ids: string[]) => ids.map((id) => ({ id, name: productName(id) }));
// 24A437, in the order the index lists them.
const MODEMS = [
  { family: "Mav24", devices: phones("iPhone17,1", "iPhone17,2", "iPhone17,3", "iPhone17,4") },
  { family: "C1", devices: phones("iPhone17,5", "iPhone18,4", "iPhone18,5") },
  { family: "Mav25", devices: phones("iPhone18,1", "iPhone18,2", "iPhone18,3", "iPhone19,3") },
  { family: "c4020", devices: phones("iPhone19,2", "iPhone19,7") },
  { family: "ICE19", devices: phones("iPhone12,1", "iPhone12,3", "iPhone12,5", "iPhone12,8") },
];
const file = (path: string, kind: BundleFile["kind"] = "pri-der"): BundleFile => {
  const stem = /^overrides_(.+?)\./.exec(path)?.[1];
  return { path, size: 1, kind, devices: stem ? describeDevices(stem) : undefined };
};

describe("modem names", () => {
  it("uses marketing names only where known", () => {
    expect(modemLabel("Mav25")).toBe("Qualcomm X80 · Mav25");
    expect(modemLabel("Mav24")).toBe("Qualcomm X75 · Mav24");
    expect(modemLabel("Mav21")).toBe("Qualcomm · Mav21");
    expect(modemLabel("C1")).toBe("Apple C1");
    expect(modemLabel("c4020")).toBe("Apple · c4020");
    expect(modemLabel("ICE19")).toBe("Intel · ICE19");
    expect(modemLabel("Zed9")).toBe("Zed9");
    expect(modemName("Mav30")).toBe("Qualcomm");
  });
});

describe("phones", () => {
  it("orders product types numerically", () => {
    expect(compareProducts("iPhone18,10", "iPhone18,2")).toBeGreaterThan(0);
    expect(compareProducts("iPhone9,1", "iPhone17,1")).toBeLessThan(0);
  });

  it("puts the family serving the newest phone first", () => {
    expect(byNewest(MODEMS).map((m) => m.family)).toEqual(["c4020", "Mav25", "C1", "Mav24", "ICE19"]);
  });

  it("lists phones compactly, unnamed ones last", () => {
    expect(phoneList(MODEMS[2].devices)).toBe("iPhone 17, 17 Pro, 17 Pro Max, iPhone19,3");
    expect(phoneList(MODEMS[4].devices)).toBe("iPhone 11, 11 Pro, 11 Pro Max, SE (2nd generation)");
    expect(phoneList([{ id: "iPhone9,1", name: "iPhone 7" }, { id: "iPhone9,3", name: "iPhone 7" }])).toBe("iPhone 7");
    expect(sortPhones(phones("iPhone9,3", "iPhone9,1")).map((p) => p.id)).toEqual(["iPhone9,3", "iPhone9,1"]);
  });

  it("finds a phone's package", () => {
    expect(modemFor(MODEMS, "iPhone18,4")?.family).toBe("C1");
    expect(modemFor(MODEMS, "iPhone3,1")).toBeUndefined();
    expect(modemFor(MODEMS)).toBeUndefined();
  });
});

describe("override files", () => {
  const files = [
    file("overrides_D93_D94_D47_D48.der.pri"),
    file("overrides_V53_V54_V57.der.pri"),
    file("overrides_D23.plist", "plist"),
    file("overrides_D52g_D53g.pri", "pri-plain"),
    file("overrides_mvno1.der.pri"),
    file("global_setting_G.der.gri"),
    file("carrier.plist", "plist"),
  ];

  it("matches a phone by the codenames in the file name", () => {
    expect(overridesFor(files, "iPhone17,1").map((f) => f.path)).toEqual(["overrides_D93_D94_D47_D48.der.pri"]);
    expect(overridesFor(files, "iPhone18,3").map((f) => f.path)).toEqual(["overrides_V53_V54_V57.der.pri"]);
    // A suffixed codename (D53g) still names the phone.
    expect(overridesFor(files, "iPhone13,2").map((f) => f.path)).toEqual(["overrides_D52g_D53g.pri"]);
    // Plists are not modem files.
    expect(overridesFor(files, "iPhone18,4")).toEqual([]);
  });

  it("keeps files named for no phone apart", () => {
    expect(sharedPri(files).map((f) => f.path)).toEqual(["overrides_mvno1.der.pri", "global_setting_G.der.gri"]);
  });
});

describe("defaultModem", () => {
  it("skips families that only serve unreleased, unnamed phones", async () => {
    const { defaultModem } = await import("../src/lib/phones.ts");
    const modems = [
      { family: "Mav24", devices: [{ id: "iPhone17,1", name: "iPhone 16 Pro" }] },
      { family: "c4020", devices: [{ id: "iPhone19,2" }] },
      { family: "Mav25", devices: [{ id: "iPhone18,1", name: "iPhone 17 Pro" }] },
    ];
    expect(defaultModem(modems).family).toBe("Mav25");
    expect(defaultModem([{ family: "c4020", devices: [{ id: "iPhone19,2" }] }]).family).toBe("c4020");
  });
});

describe("homePhone", () => {
  it("is a per-model OTA file's phone, else the image's", () => {
    expect(homePhone({ productType: "iPhone17,1" }, { product: "iPhone18,1" })).toBe("iPhone17,1");
    // A family variant ("iPad") names no single phone.
    expect(homePhone({ productType: "iPad" }, { product: "iPhone18,1" })).toBe("iPhone18,1");
    expect(homePhone({}, {})).toBeUndefined();
  });
});
