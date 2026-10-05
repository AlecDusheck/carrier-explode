import { describe, it, expect } from "vitest";
import { byNewest, compareProducts, modemLabel, modemName, overrideBoards, type BundleFile } from "@carrier-explode/decode-ios";
import { overridesFor, phoneList, sharedPri, sortPhones, type PhoneFile } from "../src/lib/apple/phones.ts";
import { withPhones } from "./fixtures/devices.ts";

// As ipsw.me names them.
const NAMES: Readonly<Record<string, string>> = {
  "iPhone12,1": "iPhone 11", "iPhone12,3": "iPhone 11 Pro", "iPhone12,5": "iPhone 11 Pro Max", "iPhone12,8": "iPhone SE (2nd generation)",
  "iPhone17,1": "iPhone 16 Pro", "iPhone17,2": "iPhone 16 Pro Max", "iPhone17,3": "iPhone 16", "iPhone17,4": "iPhone 16 Plus", "iPhone17,5": "iPhone 16e",
  "iPhone18,1": "iPhone 17 Pro", "iPhone18,2": "iPhone 17 Pro Max", "iPhone18,3": "iPhone 17", "iPhone18,4": "iPhone Air", "iPhone18,5": "iPhone 17e",
  "iPhone19,2": "iPhone 18 Pro", "iPhone19,3": "iPhone 18 Pro Max (US)", "iPhone19,7": "iPhone 18 Pro Max", "iPhone9,1": "iPhone 7", "iPhone9,3": "iPhone 7",
};
const phones = (...codes: string[]) => codes.map((code) => ({ code, name: NAMES[code] ?? code }));
// 24A437, in the order the index lists them.
const MODEMS = [
  { family: "Mav24", devices: phones("iPhone17,1", "iPhone17,2", "iPhone17,3", "iPhone17,4") },
  { family: "C1", devices: phones("iPhone17,5", "iPhone18,4", "iPhone18,5") },
  { family: "Mav25", devices: phones("iPhone18,1", "iPhone18,2", "iPhone18,3", "iPhone19,3") },
  { family: "c4020", devices: phones("iPhone19,2", "iPhone19,7") },
  { family: "ICE19", devices: phones("iPhone12,1", "iPhone12,3", "iPhone12,5", "iPhone12,8") },
];
const file = (path: string, kind: BundleFile["kind"] = "pri-der"): PhoneFile => {
  const boards = overrideBoards(path);
  return withPhones({ path, size: 1, kind, ...(boards ? { boards } : {}) });
};

describe("modem names", () => {
  it("uses a family's label where it has one, else its vendor", () => {
    expect(modemLabel("Mav25", "Qualcomm X80")).toBe("Qualcomm X80 · Mav25");
    expect(modemLabel("Mav21", undefined)).toBe("Qualcomm · Mav21");
    expect(modemLabel("C1", undefined)).toBe("Apple C1");
    expect(modemLabel("c4020", undefined)).toBe("Apple · c4020");
    expect(modemLabel("ICE19", undefined)).toBe("Intel · ICE19");
    expect(modemLabel("Zed9", undefined)).toBe("Zed9");
    expect(modemName("Mav30", undefined)).toBe("Qualcomm");
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
    expect(phoneList(MODEMS[2]?.devices ?? [])).toBe("iPhone 17, 17 Pro, 17 Pro Max, 18 Pro Max (US)");
    expect(phoneList(phones("iPhone99,1", "iPhone18,1"))).toBe("iPhone 17 Pro, iPhone99,1");
    expect(phoneList(MODEMS[4]?.devices ?? [])).toBe("iPhone 11, 11 Pro, 11 Pro Max, SE (2nd generation)");
    expect(phoneList([{ code: "iPhone9,1", name: "iPhone 7" }, { code: "iPhone9,3", name: "iPhone 7" }])).toBe("iPhone 7");
    expect(sortPhones(phones("iPhone9,3", "iPhone9,1")).map((p) => p.code)).toEqual(["iPhone9,3", "iPhone9,1"]);
  });
});

describe("override files", () => {
  const files = [
    file("overrides_D93_D94_D47_D48.der.pri"),
    file("overrides_V53_V54_V57.der.pri"),
    file("overrides_D23.plist", "plist"),
    file("overrides_D52g_D53g.pri", "pri-plain"),
    file("global_setting_G.der.gri"),
    file("carrier.plist", "plist"),
    file("overrides_V64.der.tri", "tri-der"),
    file("overrides_V64.plist", "plist"),
  ];

  it("matches a phone by the boards in the file name", () => {
    expect(overridesFor(files, "iPhone17,1").map((f) => f.path)).toEqual(["overrides_D93_D94_D47_D48.der.pri"]);
    expect(overridesFor(files, "iPhone18,3").map((f) => f.path)).toEqual(["overrides_V53_V54_V57.der.pri"]);
    // A suffixed board (D53g) still names the phone.
    expect(overridesFor(files, "iPhone13,2").map((f) => f.path)).toEqual(["overrides_D52g_D53g.pri"]);
    expect(overridesFor(files, "iPhone19,3").map((f) => f.path)).toEqual(["overrides_V64.der.tri"]);
    // Plists are not modem files.
    expect(overridesFor(files, "iPhone18,4")).toEqual([]);
  });

  it("keeps files named for no phone apart", () => {
    expect(sharedPri(files).map((f) => f.path)).toEqual(["global_setting_G.der.gri"]);
  });
});
