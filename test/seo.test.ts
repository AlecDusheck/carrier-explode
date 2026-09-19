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

  it("titles the thing the page is about, most specific first", () => {
    const p = { kind: "carriers", name: "ATT_US", version: "ios-27.0" };
    expect(seo("/[kind=kind]/[name]", { kind: "carriers", name: "ATT_US" }).title).toBe("ATT_US — iOS carrier bundle");
    expect(seo("/[kind=kind]/[name]/[version]", p).title).toBe("ATT_US ios-27.0 — iOS carrier bundle");
    expect(seo("/[kind=kind]/[name]/[version]/files/[...path]", { ...p, path: "carrier.plist" }).title)
      .toBe("carrier.plist — ATT_US ios-27.0");
    expect(seo("/[kind=kind]/[name]", { kind: "countries", name: "India" }).title).toBe("India — iOS country bundle");
  });

  it("carries the words people search for", () => {
    expect(seo("/[kind=kind]", { kind: "carriers" }).description).toMatch(/\.ipcc|APN|VoLTE/);
    expect(seo("/plmn", {}).title).toContain("MCC/MNC");
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
