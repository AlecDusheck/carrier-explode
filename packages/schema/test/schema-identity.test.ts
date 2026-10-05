import { describe, expect, it } from "vitest";

import { manifestSims, sourceKey, type SimMatcher, type SourceRef } from "../src/index.ts";
import { assignIds } from "../src/ids.ts";
import { linkSources, primary, type LinkMember } from "../src/identity.ts";
import type { Links } from "../src/links.ts";

const NO_LINKS: Links = { link: [], split: [], names: {} };

function m(platform: SourceRef["platform"], name: string, sims: SimMatcher[], display = name): LinkMember {
  const source: SourceRef = { platform, kind: "carrier", name };
  return { key: sourceKey(source), source, sims, display, iso: ["us"] };
}

const plain = (...codes: string[]): SimMatcher[] => codes.map((mccmnc) => ({ mccmnc }));
const names = (gs: ReturnType<typeof linkSources>): string[][] => gs.map((g) => g.members.map((x) => x.source.name).sort()).sort();

describe("linkSources", () => {
  const host = [
    m("ios", "Verizon_LTE_US", plain("311480", "310590"), "Verizon"),
    m("android", "verizon_us", plain("311480", "310590", "310004")),
  ];

  it("links a host by its shared plain network codes", () => {
    const groups = linkSources(host, NO_LINKS);
    expect(names(groups)).toEqual([["Verizon_LTE_US", "verizon_us"]]);
    const [g] = groups;
    expect(g?.name).toBe("Verizon");
    expect(g?.links).toEqual([{ kind: "sims", between: ["ios:carrier:Verizon_LTE_US", "android:carrier:verizon_us"], shared: ["310590", "311480"] }]);
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

  it("keeps a split pair apart when a third source would bridge them", () => {
    const links: Links = { link: [], split: [{ a: "ios:carrier:KDDI_jp", b: "android:carrier:kddimvno5gsa_jp", why: "test" }], names: {} };
    const groups = linkSources([
      m("ios", "KDDI_jp", plain("44050", "44051")),
      m("android", "kddi_jp", plain("44050", "44051")),
      m("watchos", "KDDI_jp", plain("44050", "44052")),
      m("android", "kddimvno5gsa_jp", plain("44052")),
    ], links);
    expect(names(groups)).toEqual([["KDDI_jp", "KDDI_jp", "kddi_jp"], ["kddimvno5gsa_jp"]]);
  });

  it("applies manual links, splits and names", () => {
    const links: Links = {
      link: [{ a: "ios:carrier:Verizon_Visible_LTE_US", b: "android:carrier:visible_us", why: "keyed differently" }],
      split: [{ a: "ios:carrier:Verizon_LTE_US", b: "android:carrier:verizon_us", why: "test" }],
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
    expect(visible?.links).toEqual([{ kind: "manual", between: ["ios:carrier:Verizon_Visible_LTE_US", "android:carrier:visible_us"] }]);
  });

  describe("manifestSims", () => {
    const sims = manifestSims({
      MobileDeviceCarriersByMccMnc: {
        "311480": { MVNOs: [{ BundleName: "Verizon_Visible_LTE_US", GID2: "1A" }, { BundleName: "Verizon_LTE_US", GID2: "FF" }] },
      },
      CarrierBundles: {
        Watch: {
          IMSI: { "311480": { BundleMapKey: "311480_Map", MVNOs: [{ BundleMapKey: "visible_Map", GID2: "1A" }] } },
          BundleMappings: {
            "311480_Map": { 1: { BundleMatchEntry: "Verizon_1", OS: { Min: "7.0" } }, 2: { BundleMatchEntry: "Verizon_2", OS: { Min: "9.0" } } },
            visible_Map: { 1: { BundleMatchEntry: "Visible_1" } },
          },
          Bundles: { Verizon_1: { BundleID: "Verizon_LTE_US" }, Verizon_2: { BundleID: "Verizon_LTE_US" }, Visible_1: { BundleID: "Verizon_Visible_LTE_US" } },
        },
      },
    });

    it("routes iPhone and iPad bundles by the PLMN table, an all-FF GID being no rule", () => {
      expect(sims["ios:carrier:Verizon_Visible_LTE_US"]).toEqual([{ mccmnc: "311480", gid2: "1A" }]);
      expect(sims["ipados:carrier:Verizon_Visible_LTE_US"]).toEqual([{ mccmnc: "311480", gid2: "1A" }]);
      expect(sims["ios:carrier:Verizon_LTE_US"]).toEqual([{ mccmnc: "311480" }]);
    });

    it("routes Watch bundles through the Watch IMSI table and its bundle mappings", () => {
      expect(sims["watchos:carrier:Verizon_LTE_US"]).toEqual([{ mccmnc: "311480" }]);
      expect(sims["watchos:carrier:Verizon_Visible_LTE_US"]).toEqual([{ mccmnc: "311480", gid2: "1A" }]);
    });
  });
});

/** The ids assignIds gives carriers that are plain member lists. */
const ids = (carriers: SourceRef[][], previous: Record<string, string> = {}): string[] =>
  assignIds(carriers, (c) => c, previous).map((x) => x.id);

describe("assignIds", () => {
  const im = (platform: "ios" | "android", name: string): SourceRef => ({ platform, kind: "carrier", name });

  it("names a carrier after its primary member, qualifying a name another carrier holds", () => {
    expect(ids([[im("ios", "ATT_NR_US"), im("ios", "ATT_US")], [im("android", "fi_us")], [im("ios", "Fi_US")], [im("android", "Fi_US")]]))
      .toEqual(["ATT_NR_US", "fi_us", "Fi_US", "android-Fi_US"]);
  });

  it("keeps a previous id while it is still one of the carrier's names", () => {
    const previous = { "ios:carrier:ATT_US": "ATT_US", "android:carrier:att_us": "ATT_US" };
    expect(ids([[im("ios", "ATT_NR_US"), im("ios", "ATT_US"), im("android", "att_us")]], previous)).toEqual(["ATT_US"]);
    expect(ids([[im("ios", "ATT_NR_US")]], { "ios:carrier:ATT_NR_US": "ATT_US" })).toEqual(["ATT_NR_US"]);
  });
});

describe("Apple device families", () => {
  it("links an iPhone, iPad and Watch bundle by the SIMs they share, like any other platforms", () => {
    const watch = m("watchos", "Test_US", plain("310410"));
    const groups = linkSources([m("ios", "Test_US", plain("310410")), watch, m("android", "test_us", plain("310410"))], NO_LINKS);
    expect(groups.map((g) => g.members.map((x) => x.key).sort())).toEqual([["android:carrier:test_us", "ios:carrier:Test_US", "watchos:carrier:Test_US"]]);
  });

  it("names a carrier after its iPhone bundle before its iPad or Watch bundle, whatever their SIM counts", () => {
    const members = [m("watchos", "Test_US", plain("310410", "310260"), "Watch"), m("ios", "Test_US", plain("310410"), "iPhone")];
    expect(primary(members)?.key).toBe("ios:carrier:Test_US");
  });
});
