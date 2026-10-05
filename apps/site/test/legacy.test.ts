import { describe, it, expect } from "vitest";
import type { LegacyRoute } from "@carrier-explode/schema/types";
import { answer, legacyStep } from "../src/lib/server/legacy.ts";

// Shaped like index/legacy.json: a source's v1 page, and each v1 version slug that named one of its copies.
const ROUTES: readonly LegacyRoute[] = [
  { from: "/carriers/ATT_US", to: "/ios/carriers/ATT_US" },
  { from: "/carriers/ATT_US/ios-27.0", to: "/ios/carriers/ATT_US/72.0" },
  { from: "/carriers/ATT_US/ios-27.0-24A437", to: "/ios/carriers/ATT_US/72.0" },
  { from: "/carriers/ATT_US/ios-27.2-beta-3", to: "/ios/carriers/ATT_US/72.7.2@24c5055e" },
  { from: "/carriers/ATT_US/ota-58.1-iPad", to: "/ipados/carriers/ATT_US/58.1@2024-03-05" },
  { from: "/carriers/ATT_US/ota-60.0-iPhone17,1", to: "/ios/carriers/ATT_US/iPhone17,1/60.0" },
  { from: "/carriers/ATT_US/ota-legacy", to: "/ios/carriers/ATT_US/1.0@2009-10-01" },
  { from: "/countries/UnitedStates", to: "/ios/countries/UnitedStates" },
  { from: "/countries/UnitedStates/ios-27.0", to: "/ios/countries/UnitedStates/58.1" },
  { from: "/watch/Verizon_LTE_US", to: "/watchos/carriers/Verizon_LTE_US" },
];

type Expected = readonly [status: 301, location: string] | readonly [status: 404, elsewhere: string] | null;

const CASES: ReadonlyArray<readonly [url: string, expected: Expected]> = [
  ["/carriers/ATT_US", [301, "/ios/carriers/ATT_US"]],
  ["/carriers/ATT_US/ios-27.0", [301, "/ios/carriers/ATT_US/72.0"]],
  ["/carriers/ATT_US/ios-27.0/settings", [301, "/ios/carriers/ATT_US/72.0/settings"]],
  ["/carriers/ATT_US/ios-27.0-24A437/files/carrier.plist?phone=iPhone17,1", [301, "/ios/carriers/ATT_US/72.0/files/carrier.plist?phone=iPhone17,1"]],
  ["/carriers/ATT_US/ios-27.2-beta-3/changes", [301, "/ios/carriers/ATT_US/72.7.2@24c5055e/changes"]],
  ["/carriers/ATT_US/ota-58.1-iPad/modem", [301, "/ipados/carriers/ATT_US/58.1@2024-03-05/modem"]],
  ["/carriers/ATT_US/ota-60.0-iPhone17,1", [301, "/ios/carriers/ATT_US/iPhone17,1/60.0"]],
  ["/carriers/ATT_US/ota-60.0-iPhone17%2C1/files", [301, "/ios/carriers/ATT_US/iPhone17,1/60.0/files"]],
  ["/carriers/ATT_US/ota-legacy/files", [301, "/ios/carriers/ATT_US/1.0@2009-10-01/files"]],
  ["/countries/UnitedStates/ios-27.0/alerts", [301, "/ios/countries/UnitedStates/58.1/alerts"]],
  // Tabs v1 itself had moved.
  ["/carriers/ATT_US/ios-27.0/assets", [301, "/ios/carriers/ATT_US/72.0/files"]],
  ["/carriers/ATT_US/ios-27.0/baseband", [301, "/ios/carriers/ATT_US/72.0/modem"]],
  ["/carriers/ATT_US/ios-27.0/plist", [301, "/ios/carriers/ATT_US/72.0/settings"]],
  ["/carriers/ATT_US/ios-27.0/strings?file=en.lproj", [301, "/ios/carriers/ATT_US/72.0/settings?strings=en.lproj#text"]],
  ["/raw/carriers/ATT_US/ios-27.0/Default.png", [301, "/raw/ios/carriers/ATT_US/72.0/Default.png"]],
  ["/raw/countries/UnitedStates/ios-27.0/en.lproj/CBMessage.strings", [301, "/raw/ios/countries/UnitedStates/58.1/en.lproj/CBMessage.strings"]],
  ["/watch/Verizon_LTE_US", [301, "/watchos/carriers/Verizon_LTE_US"]],
  ["/watch", [301, "/watchos/carriers"]],
  ["/releases/24A437", [301, "/ios/builds/24A437"]],
  ["/baseband/24A437/Mav25/carriers", [301, "/ios/builds/24A437/Mav25/carriers"]],
  ["/cell-broadcast", [301, "/ios/countries"]],
  ["/carriers", [301, "/ios/carriers"]],
  ["/countries?q=de", [301, "/ios/countries?q=de"]],
  // Wiki articles from before the wiki had sections.
  ["/wiki/der-pri", [301, "/wiki/ios/der-pri"]],
  ["/wiki/t-mobile-us?x=1", [301, "/wiki/ios/t-mobile-us?x=1"]],
  // A version the table does not hold: no guess, the source's page named instead.
  ["/carriers/ATT_US/ios-99.0", [404, "/ios/carriers/ATT_US"]],
  ["/carriers/ATT_US/ota-1.2/files/carrier.plist", [404, "/ios/carriers/ATT_US"]],
  ["/watch/Verizon_LTE_US/ota-30.0", [404, "/watchos/carriers/Verizon_LTE_US"]],
  // v2 paths, old and current, and v1 names the table does not know, are the router's: the old ones are 404s.
  ["/carriers/ios", null],
  ["/carriers/ios/ATT_US/72.0/settings", null],
  ["/carriers/android/tmobile_us/tokay", null],
  ["/countries/ios/UnitedStates", null],
  ["/ios/carriers/ATT_US/72.0/settings", null],
  ["/android/carriers/tmobile_us/tokay", null],
  ["/android/countries/us", null],
  ["/carriers/Unknown_Carrier", null],
  ["/builds/24A437", null],
  ["/ios/builds/24A437/Mav25", null],
  ["/wiki", null],
  ["/wiki/ios/der-pri", null],
  ["/wiki/android/carrier-list", null],
  ["/wiki/credits", null],
  ["/wiki/no-such-article", null],
  // Whole segments only.
  ["/carriers/ATT_USX", null],
  ["/watchers", null],
  ["/wiki/der-pri-x", null],
];

const at = (url: string): URL => new URL(url, "https://carrierexplode.com");

describe("answer", () => {
  for (const [url, expected] of CASES) {
    it(`${url} -> ${expected?.join(" ") ?? "router"}`, () => {
      const a = answer(ROUTES, at(url));
      if (expected === null) expect(a).toBeNull();
      else if (expected[0] === 301) expect(a).toEqual({ status: 301, location: expected[1] });
      else expect(a).toMatchObject({ status: 404, elsewhere: expected[1] });
    });
  }
});

describe("legacyStep", () => {
  const step = async (url: string) => {
    const locals: App.Locals = { sources: new Set() };
    return { response: await legacyStep({ url: at(url), locals }, async () => ROUTES), locals };
  };

  it("answers a known v1 URL with a 301", async () => {
    const { response } = await step("/carriers/ATT_US/ios-27.0");
    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe("/ios/carriers/ATT_US/72.0");
  });

  it("leaves an unknown v1 version to the router's 404, naming the source's page", async () => {
    const { response, locals } = await step("/carriers/ATT_US/ios-99.0");
    expect(response).toBeNull();
    expect(locals.moved?.elsewhere).toBe("/ios/carriers/ATT_US");
  });

  it("never reads the table for a v2 path", async () => {
    const event = { url: at("/ios/carriers/ATT_US"), locals: { sources: new Set<never>() } };
    expect(await legacyStep(event, () => Promise.reject(new Error("read")))).toBeNull();
  });
});
