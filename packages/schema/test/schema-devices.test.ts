/** Device records: their order, Apple's boards, and the settings that show a phone's 5G radio. Boards and days are AppleDB's and Google's OTA page's. */

import { describe, expect, it } from "vitest";

import { boardProducts, boardRefs, newestFirst, newestOf, productOf, type Device, type ModemItem } from "../src/index.ts";
import { boardRadios } from "../src/ios/radio.ts";
import { configRadio } from "../src/modem/index.ts";

const apple = (code: string, released: string, boards: string[]): Device => ({ code, family: "apple", released, boards });
const pixel = (code: string, released: string): Device => ({ code, family: "android", released, boards: [] });

describe("newestFirst", () => {
  const order = newestFirst([pixel("cubs", "2026-08"), pixel("kodiak", "2026-08"), pixel("stallion", "2026-03"), pixel("sailfish", "2016-10")]);

  it("lists by release, newest first, a launch's devices by code, and devices no record lists last", () => {
    expect(["sailfish", "unlisted", "stallion", "cubs", "kodiak", "another"].sort(order)).toEqual(["kodiak", "cubs", "stallion", "sailfish", "another", "unlisted"]);
    expect(newestOf(order, ["sailfish", "stallion"])).toBe("stallion");
    expect(newestOf(order, [])).toBeUndefined();
  });

  it("orders product types numerically within a launch", () => {
    const iphones = newestFirst([apple("iPhone17,1", "2024-09-20", []), apple("iPhone17,10", "2024-09-20", []), apple("iPhone17,2", "2024-09-20", [])]);
    expect(["iPhone17,1", "iPhone17,10", "iPhone17,2"].sort(iphones)).toEqual(["iPhone17,10", "iPhone17,2", "iPhone17,1"]);
  });
});

describe("boards", () => {
  const products = boardProducts([
    apple("iPhone13,2", "2020-10-23", ["D53gAP"]),
    apple("iPhone19,3", "2026-09-18", ["V64AP"]),
    apple("iPhone19,7", "2026-09-18", ["V64sAP"]),
    apple("iPhone3,2", "2012-09-21", ["N90bAP"]),
    apple("iPhone7,2", "2014-09-19", ["N61AP"]),
    apple("iPhone8,1", "2015-09-25", ["N71AP", "N71mAP"]),
    apple("iPad2,4", "2012-03-25", ["K93aAP"]),
  ]);

  it("names a board's phone from its board config, in whatever case the file uses", () => {
    expect(productOf(products, "D53g")).toBe("iPhone13,2");
    expect(productOf(products, "N90B")).toBe("iPhone3,2");
    expect(productOf(products, "K93A")).toBe("iPad2,4");
    expect(productOf(products, "N71m")).toBe("iPhone8,1");
  });

  it("prefers an exact board to the one without a lower-case suffix", () => {
    expect(productOf(products, "V64s")).toBe("iPhone19,7");
    expect(productOf(products, "V64")).toBe("iPhone19,3");
    expect(productOf(products, "N61x")).toBe("iPhone7,2");
    expect(productOf(products, "N61xy")).toBeUndefined();
  });

  it("keeps a board no record lists as its code", () => {
    expect(boardRefs(["D53g", "T742", "constructor"], products)).toEqual([{ board: "D53g", product: "iPhone13,2" }, { board: "T742" }, { board: "constructor" }]);
  });
});

describe("radios", () => {
  it("reads which boards a bundle's override plists configure, and which they give the 5G switch", () => {
    expect(boardRadios({
      "carrier.plist:Show5GSwitch": true,
      "overrides_D421_D431_N104_D79.plist:ShowCallForwarded": true,
      "overrides_D421_D431_N104_D79.der.pri:efs./nv/item_files/modem/nr5g/rrc/x": "01",
      "overrides_V53_V54.plist:Show5GSwitch": false,
    })).toEqual({ configured: ["D421", "D431", "N104", "D79", "V53", "V54"], fiveG: ["V53", "V54"] });
  });

  const item = (id: string, name: string | null): ModemItem => ({ id, name, description: null, value: { kind: "number", value: 1 }, label: null, certainty: "high" });

  it("finds 5G in a configuration by its family's NR items, and leaves MediaTek's unread", () => {
    expect(configRadio({ family: "qualcomm", items: [item("efs:/nv/item_files/modem/nr5g/RRC/cap_dss_control", "cap_dss_control")] })).toBe("nr");
    expect(configRadio({ family: "qualcomm", items: [item("efs:/nv/item_files/modem/lte/rrc/x", "x"), item("nv:71527", null)] })).toBe("lte");
    expect(configRadio({ family: "shannon", items: [item("crc:c0b0140e", "!NRCAPA_INACTIVE_STATE")] })).toBe("nr");
    expect(configRadio({ family: "shannon", items: [item("crc:6ab76c19", "LTEL1.PCH_GAP_CONFLICT_DETECT")] })).toBe("lte");
    expect(configRadio({ family: "mediatek", items: [item("lid:0x3c0/5706", null)] })).toBe("unread");
  });
});
