import { describe, it, expect } from "vitest";
import { seo } from "../src/lib/seo.ts";
import { errorMessage } from "../src/lib/format.ts";

const CASES: Array<[string, Parameters<typeof seo>[1]]> = [
  ["/", {}],
  ["/[kind=kind]", { kind: "carriers" }],
  ["/[kind=kind]", { kind: "countries" }],
  ["/[kind=kind]", { kind: "watch" }],
  ["/[kind=kind]/[name]", { kind: "carriers", name: "ATT_US" }],
  ["/[kind=kind]/[name]/[version]", { kind: "carriers", name: "ATT_US", version: "ios-27.0" }],
  ["/[kind=kind]/[name]/[version]/files/[...path]", { kind: "carriers", name: "ATT_US", version: "ios-27.0", path: "carrier.plist" }],
  ["/plmn", {}],
  ["/cell-broadcast", {}],
  ["/cell-broadcast/[country]", { country: "India" }],
  ["/compare", {}],
  ["/releases", {}],
  ["/releases/[build]", { build: "24A437" }],
  ["/[kind=kind]/[name]", { kind: "watch", name: "Verizon_LTE_US" }],
  ["/[kind=kind]/[name]", { kind: "carriers", name: "Verizon_Core_Visible_LTE_US" }],
  ["/[kind=kind]/[name]", { kind: "countries", name: "SaintHelenaAscensionAndTristanDaCunha" }],
  ["/[kind=kind]/[name]/[version]/baseband", { kind: "carriers", name: "KDDI_BIGLOBE_LTE_only_jp", version: "ios-27.2-beta-10" }],
  ["/[kind=kind]/[name]/[version]/files/[...path]", { kind: "carriers", name: "ATT_US", version: "ios-27.0", path: "" }],
];

describe("seo", () => {
  it("gives every route a title and a description that survive a search result", () => {
    for (const [id, params] of CASES) {
      const { title, description } = seo(id, params);
      expect(title, id).toMatch(/\S/);
      // Google shows roughly 60 and 155 characters; " · carrier-explode" is appended to the title.
      expect(title.length + 18, id).toBeLessThanOrEqual(70);
      expect(description.length, id).toBeGreaterThan(50);
      expect(description.length, id).toBeLessThanOrEqual(160);
    }
  });

  it("titles a bundle with its file name and the brand people search for", () => {
    const p = { kind: "carriers", name: "ATT_US", version: "ios-27.0" };
    expect(seo("/[kind=kind]/[name]", { kind: "carriers", name: "ATT_US" }).title).toBe("ATT_US — AT&T United States carrier bundle");
    expect(seo("/[kind=kind]/[name]/[version]", p).title).toBe("ATT_US iOS 27.0 — AT&T carrier bundle");
    expect(seo("/[kind=kind]/[name]/[version]/files/[...path]", { ...p, path: "carrier.plist" }).title)
      .toBe("carrier.plist — ATT_US iOS 27.0");
    expect(seo("/[kind=kind]/[name]", { kind: "countries", name: "UnitedStates" }).title).toBe("UnitedStates — United States country bundle");
  });

  it("carries both spellings of the name and the settings people search for", () => {
    const d = seo("/[kind=kind]/[name]", { kind: "carriers", name: "RelianceJio_in" }).description;
    for (const term of ["Jio", "India", "RelianceJio_in.bundle", "RelianceJio_in.ipcc", "APN", "VoLTE", "5G", "Wi-Fi Calling"]) {
      expect(d).toContain(term);
    }
    expect(seo("/[kind=kind]", { kind: "carriers" }).description).toMatch(/\.ipcc|APN|VoLTE/);
    expect(seo("/plmn", {}).title).toContain("MCC/MNC");
  });

  it("keeps the brand when a long bundle name crowds the title", () => {
    expect(seo("/[kind=kind]/[name]", { kind: "carriers", name: "TMobile_MetroPCS_US" }).title)
      .toBe("TMobile_MetroPCS_US — Metro by T-Mobile");
  });

  it("names each tab and each kind of version", () => {
    const p = { kind: "carriers", name: "ATT_US", version: "ios-27.2-beta-2" };
    expect(seo("/[kind=kind]/[name]/[version]", p).description).toContain("iOS 27.2 beta 2");
    expect(seo("/[kind=kind]/[name]/[version]/baseband", p).title).toContain("baseband");
    expect(seo("/[kind=kind]/[name]/[version]/changes", { ...p, version: "ota-58.1-iPad" }).description).toContain("build 58.1 (iPad)");
    expect(seo("/releases/[build]", { build: "24B5089g" }).title).toBe("iOS 27 beta (24B5089g) carrier bundle changes");
  });
});

describe("errorMessage", () => {
  it("prefers what the error says", () => {
    expect(errorMessage({ body: { message: "no such file" }, status: 404 })).toBe("no such file");
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("never renders a bare object as [object Object]", () => {
    expect(errorMessage({ status: 500, body: {} })).toBe('HTTP 500 · {"status":500,"body":{}}');
    expect(errorMessage({})).toBe("Unexpected error: {}");
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(errorMessage(loop)).toBe("Unexpected error: [object Object]");
  });
});
