import { describe, it, expect } from "vitest";
import { buildLabel, carrierName, compareVersions, countryDisplay, imageSlug, versionLabel } from "../src/lib/names.ts";

describe("compareVersions", () => {
  it("puts a beta below its release and above the one before", () => {
    const v = ["27.2", "27.1", "27.2 beta 10", "27.2 RC", "27.2 beta 2", "27.2.1"];
    expect(v.sort(compareVersions)).toEqual(["27.1", "27.2 beta 2", "27.2 beta 10", "27.2 RC", "27.2", "27.2.1"]);
  });

  it("still orders plain bundle builds numerically", () => {
    expect(["9.1", "58.1", "25.1"].sort(compareVersions)).toEqual(["9.1", "25.1", "58.1"]);
  });
});

describe("slugs and labels", () => {
  it("gives a beta its own URL and reads it back", () => {
    expect(imageSlug("27.0")).toBe("ios-27.0");
    expect(imageSlug("27.2 beta 2")).toBe("ios-27.2-beta-2");
    expect(versionLabel("ios-27.2-beta-2")).toBe("iOS 27.2 beta 2");
    expect(versionLabel("ios-27.0-24A437")).toBe("iOS 27.0 (24A437)");
    expect(versionLabel("ota-58.1-iPad")).toBe("build 58.1 (iPad)");
    expect(versionLabel("ota-legacy")).toBe("legacy build");
  });

  it("knows the iOS major from a build number", () => {
    expect(buildLabel("24A437")).toBe("iOS 27");
    expect(buildLabel("23E246")).toBe("iOS 26");
    expect(buildLabel("22G86")).toBe("iOS 18");
    expect(buildLabel("24B5089g")).toBe("iOS 27 beta");
  });
});

describe("carrierName", () => {
  it("turns Apple's bundle names into the brands people search for", () => {
    expect(carrierName("ATT_US")).toEqual({ brand: "AT&T", country: "United States" });
    expect(carrierName("ATT_FirstNet_US").brand).toBe("AT&T FirstNet");
    expect(carrierName("TMobile_MetroPCS_US").brand).toBe("Metro by T-Mobile");
    expect(carrierName("Verizon_Visible_LTE_US").brand).toBe("Verizon Visible");
    expect(carrierName("RelianceJio_in")).toEqual({ brand: "Jio", country: "India" });
    expect(carrierName("AlaskaWireless_US").brand).toBe("Alaska Wireless");
    expect(carrierName("StarHub_sg").brand).toBe("StarHub");
  });

  it("handles UK and a country already in the name", () => {
    expect(carrierName("O2_UK")).toEqual({ brand: "O2", country: "United Kingdom" });
    expect(carrierName("TIM_Italy")).toEqual({ brand: "TIM Italy", country: undefined });
  });

  it("spaces out country bundle names", () => {
    expect(countryDisplay("AntiguaAndBarbuda")).toBe("Antigua and Barbuda");
    expect(countryDisplay("DemocraticRepublicOfTheCongo")).toBe("Democratic Republic of the Congo");
    expect(countryDisplay("TheBahamas")).toBe("The Bahamas");
  });
});
