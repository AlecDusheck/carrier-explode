import { describe, it, expect } from "vitest";
import { seo } from "../src/lib/seo.ts";
import { errorMessage } from "../src/lib/format.ts";

const CASES: Array<[string, Parameters<typeof seo>[1]]> = [
  ["/", {}],
  ["/[kind=kind]", { kind: "carriers" }],
  ["/[kind=kind]", { kind: "countries" }],
  ["/[kind=kind]", { kind: "watch" }],
  ["/[kind=kind]/[name]", { kind: "carriers", name: "ATT_US" }],
  ["/[kind=kind]/[name]/[version=version]", { kind: "carriers", name: "ATT_US", version: "ios-27.0" }],
  ["/[kind=kind]/[name]/[version=version]/files/[...path]", { kind: "carriers", name: "ATT_US", version: "ios-27.0", path: "carrier.plist" }],
  ["/compare", {}],
  ["/builds", {}],
  ["/wiki", {}],
  ["/builds/[build]", { build: "24A437" }],
  ["/builds/[build]", { build: "24B5089g" }],
  ["/builds/[build]/[family]", { build: "24A437", family: "Mav25" }],
  ["/builds/[build]/[family]", { build: "24A437", family: "Mav21" }],
  ["/builds/[build]/[family]", { build: "24A437", family: "C1" }],
  ["/builds/[build]/[family]", { build: "24B5089g", family: "c4020" }],
  ["/builds/[build]/[family]", { build: "24A437", family: "ICE19" }],
  ["/[kind=kind]/[name]", { kind: "watch", name: "Verizon_LTE_US" }],
  ["/[kind=kind]/[name]", { kind: "carriers", name: "Verizon_Core_Visible_LTE_US" }],
  ["/[kind=kind]/[name]", { kind: "countries", name: "SaintHelenaAscensionAndTristanDaCunha" }],
  ["/[kind=kind]/[name]/[version=version]/modem", { kind: "carriers", name: "KDDI_BIGLOBE_LTE_only_jp", version: "ios-27.2-beta-10" }],
  ["/[kind=kind]/[name]/[version=version]/settings", { kind: "carriers", name: "KDDI_BIGLOBE_LTE_only_jp", version: "ios-27.2-beta-10" }],
  ["/[kind=kind]/[name]/[version=version]/alerts", { kind: "countries", name: "SaintHelenaAscensionAndTristanDaCunha", version: "ios-27.2-beta-10" }],
  ["/[kind=kind]/[name]/[version=version]/files/[...path]", { kind: "carriers", name: "ATT_US", version: "ios-27.0", path: "" }],
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
    const title = (id: Parameters<typeof seo>[0], params: Parameters<typeof seo>[1]) => seo(id, params).title;
    for (const t of ["ATT_US", "AT&T", "United States"]) expect(title("/[kind=kind]/[name]", { kind: "carriers", name: "ATT_US" })).toContain(t);
    for (const t of ["ATT_US", "iOS 27.0", "AT&T"]) expect(title("/[kind=kind]/[name]/[version=version]", p)).toContain(t);
    expect(title("/[kind=kind]/[name]/[version=version]/files/[...path]", { ...p, path: "carrier.plist" })).toMatch(/^carrier\.plist .*ATT_US/);
    for (const t of ["UnitedStates", "United States"]) expect(title("/[kind=kind]/[name]", { kind: "countries", name: "UnitedStates" })).toContain(t);
  });

  it("carries both spellings of the name and the settings people search for", () => {
    const d = seo("/[kind=kind]/[name]", { kind: "carriers", name: "RelianceJio_in" }).description;
    for (const term of ["Jio", "India", "RelianceJio_in.bundle", "RelianceJio_in.ipcc", "APN", "VoLTE", "5G", "Wi-Fi Calling"]) {
      expect(d).toContain(term);
    }
    expect(seo("/[kind=kind]", { kind: "carriers" }).description).toMatch(/\.ipcc|APN|VoLTE/);
    expect(seo("/[kind=kind]", { kind: "carriers" }).description).toContain("MCC/MNC");
  });

  it("keeps the brand when a long bundle name crowds the title", () => {
    const title = seo("/[kind=kind]/[name]", { kind: "carriers", name: "TMobile_MetroPCS_US" }).title;
    expect(title).toContain("TMobile_MetroPCS_US");
    expect(title).toContain("Metro by T-Mobile");
  });

  it("names each tab and each kind of version", () => {
    const p = { kind: "carriers", name: "ATT_US", version: "ios-27.2-beta-2" };
    expect(seo("/[kind=kind]/[name]/[version=version]", p).description).toContain("iOS 27.2 beta 2");
    expect(seo("/[kind=kind]/[name]/[version=version]/modem", p).title).toContain("modem");
    expect(seo("/[kind=kind]/[name]/[version=version]/settings", p).title).toContain("settings");
    expect(seo("/[kind=kind]/[name]/[version=version]/changes", { ...p, version: "ota-58.1-iPad" }).description).toContain("build 58.1 (iPad)");
    expect(seo("/builds/[build]", { build: "24B5089g" }).title).toMatch(/iOS 27 beta.*24B5089g/);
  });
});

describe("errorMessage", () => {
  it("prefers what the error says", () => {
    expect(errorMessage({ body: { message: "no such file" }, status: 404 })).toBe("no such file");
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("never renders a bare object as [object Object]", () => {
    expect(errorMessage({ status: 500, body: {} })).toContain("500");
    for (const e of [{ status: 500, body: {} }, {}]) expect(errorMessage(e)).not.toContain("[object Object]");
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => errorMessage(loop)).not.toThrow();
  });
});
