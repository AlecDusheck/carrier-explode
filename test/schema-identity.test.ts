import { describe, expect, it } from "vitest";

import { linkSources, manifestSims, type LinkMember, type Links, type SimMatcher, type SourceRef } from "../src/lib/schema/index.ts";
import { assignSlugs } from "../src/lib/schema/slug.ts";

const NO_LINKS: Links = { link: [], split: [], names: {} };

function m(platform: SourceRef["platform"], name: string, sims: SimMatcher[], display = name): LinkMember {
  const source: SourceRef = { platform, kind: "carrier", name };
  return { key: `${platform}:carrier:${name}`, source, sims, display, iso: ["us"] };
}

const plain = (...codes: string[]): SimMatcher[] => codes.map((mccmnc) => ({ mccmnc }));
const names = (gs: ReturnType<typeof linkSources>): string[][] => gs.map((g) => g.members.map((x) => x.source.name).sort()).sort();

describe("linkSources", () => {
  const host = [
    m("ios", "Verizon_LTE_US", plain("311480", "310590"), "Verizon"),
    m("android", "verizon_us", plain("311480", "310590", "310004")),
  ];

  it("links a host by its shared plain network codes", () => {
    const [g] = linkSources(host, NO_LINKS);
    expect(names([g!])).toEqual([["Verizon_LTE_US", "verizon_us"]]);
    expect(g?.name).toBe("Verizon");
    expect(g?.links).toContainEqual({ source: "ios:carrier:Verizon_LTE_US", reason: "sims", shared: ["310590", "311480"] });
  });

  it("keeps an MVNO keyed by GID apart from its host's plain codes", () => {
    const groups = linkSources([
      ...host,
      m("ios", "Verizon_Visible_LTE_US", [{ mccmnc: "311480", gid2: "1A" }]),
      m("android", "visible_us", [{ mccmnc: "311480", gid1: "BAE1000000000000" }]),
    ], NO_LINKS);
    expect(names(groups)).toEqual([["Verizon_LTE_US", "verizon_us"], ["Verizon_Visible_LTE_US"], ["visible_us"]]);
  });

  it("does not let an MVNO that lists one of the host's codes join it", () => {
    const groups = linkSources([
      m("ios", "TMobile_US", plain("310260", "310160", "310200", "310210")),
      m("android", "tmobile_us", plain("310260", "310160", "310200", "310210")),
      // Lists the host's 310260 among four codes of its own: under half of its rules are shared.
      m("android", "mvno_us", plain("310260", "311990", "311991", "311992", "311993")),
    ], NO_LINKS);
    expect(names(groups)).toEqual([["TMobile_US", "tmobile_us"], ["mvno_us"]]);
  });

  it("joins a second SIM profile of one carrier to its best match when most of its rules are shared", () => {
    const gid = (g: string): SimMatcher[] => ["310280", "310410"].map((mccmnc) => ({ mccmnc, gid1: g }));
    const groups = linkSources([
      m("ios", "ATT_NR_US", [...gid("53"), ...gid("52"), { mccmnc: "310950", gid1: "53" }]),
      m("android", "att5g_us", [...gid("53"), { mccmnc: "310950", gid1: "53" }]),
      m("android", "att5gsa_us", gid("52")),
    ], NO_LINKS);
    expect(names(groups)).toEqual([["ATT_NR_US", "att5g_us", "att5gsa_us"]]);
  });

  it("applies manual links, splits and names", () => {
    const links: Links = {
      link: [["ios:carrier:Verizon_Visible_LTE_US", "android:carrier:visible_us", "keyed differently"]],
      split: [["ios:carrier:Verizon_LTE_US", "android:carrier:verizon_us", "test"]],
      names: { "android:carrier:visible_us": "Visible" },
    };
    const groups = linkSources([
      ...host,
      m("ios", "Verizon_Visible_LTE_US", [{ mccmnc: "311480", gid2: "1A" }]),
      m("android", "visible_us", [{ mccmnc: "311480", gid1: "BAE1" }]),
    ], links);
    expect(names(groups)).toEqual([["Verizon_LTE_US"], ["Verizon_Visible_LTE_US", "visible_us"], ["verizon_us"]]);
    const visible = groups.find((g) => g.members.length === 2);
    expect(visible?.name).toBe("Visible");
    expect(visible?.links.map((l) => l.reason)).toEqual(["manual", "manual"]);
  });

  it("reads Apple's manifest routes, MVNO rules included", () => {
    const sims = manifestSims({
      entries: [{ plmn: "311480", mcc: "311", mnc: "480", mvnos: [{ bundle: "Verizon_Visible_LTE_US", gid2: "1A" }, { bundle: "Verizon_LTE_US", gid2: "FF" }] }],
    });
    expect(sims["ios:carrier:Verizon_Visible_LTE_US"]).toEqual([{ mccmnc: "311480", gid2: "1A" }]);
    // An all-FF GID2 is no rule: the host's catch-all.
    expect(sims["ios:carrier:Verizon_LTE_US"]).toEqual([{ mccmnc: "311480" }]);
  });
});

describe("assignSlugs", () => {
  const sm = (platform: "ios" | "android", name: string, matchers: number) => ({ key: `${platform}:carrier:${name}`, platform, name, matchers });

  it("uses the iOS bundle with the most matchers, then the Android name, prefixed when it clashes", () => {
    const slugs = assignSlugs([
      [sm("ios", "ATT_US", 7), sm("ios", "ATT_NR_US", 9), sm("android", "att_us", 8)],
      [sm("android", "fi_us", 3)],
      [sm("ios", "Fi_US", 1)],
      [sm("android", "Fi_US", 2)],
    ]);
    expect(slugs).toEqual(["ATT_NR_US", "fi_us", "Fi_US", "android-Fi_US"]);
  });

  it("keeps a published slug while it is still one of the carrier's names", () => {
    const previous = { "ios:carrier:ATT_US": "ATT_US", "android:carrier:att_us": "ATT_US" };
    expect(assignSlugs([[sm("ios", "ATT_US", 7), sm("ios", "ATT_NR_US", 9), sm("android", "att_us", 8)]], previous)).toEqual(["ATT_US"]);
    // A slug the carrier no longer has a member for is not kept.
    expect(assignSlugs([[sm("ios", "ATT_NR_US", 9)]], { "ios:carrier:ATT_NR_US": "ATT_US" })).toEqual(["ATT_NR_US"]);
  });
});
