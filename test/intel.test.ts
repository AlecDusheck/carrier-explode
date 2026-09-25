/**
 * Tests for `src/lib/decode/intel.ts` (Intel / Apple C1 dialect tree).
 * Fixtures: `intel/KDDI_jp_overrides_D23.der.pri` is the unmodified KDDI_jp override for iPhone Air;
 * `intel/global_setting_G_trimmed.der.gri` keeps 120 of the 3850 records of iOS 27.0 (24A437) Default/global_setting_G.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { decodePri } from "../src/lib/decode/pri.ts";
import {
  INTEL_REGIONS,
  filterIntel,
  intelTree,
  parseComboList,
  parseIntelKey,
  type IntelGroup,
  type IntelList,
  type IntelNode,
  type IntelTable,
  type IntelTree,
  type IntelValue,
} from "../src/lib/decode/intel.ts";
import { openIpcc, decodeFile } from "../src/lib/decode/bundle.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (...p: string[]) => new Uint8Array(readFileSync(join(here, "fixtures", ...p)));

const d23 = decodePri(fixture("intel", "KDDI_jp_overrides_D23.der.pri"));
const gri = decodePri(fixture("intel", "global_setting_G_trimmed.der.gri"), "der.gri");

/** Find a node by its full dotted path. */
function at(t: IntelTree, path: string): IntelNode {
  const walk = (ns: IntelNode[]): IntelNode | undefined => {
    for (const n of ns) {
      if (n.path === path) return n;
      if (n.kind === "group") { const hit = walk(n.children); if (hit) return hit; }
    }
    return undefined;
  };
  const n = walk(t.nodes);
  if (!n) throw new Error("no node " + path);
  return n;
}

describe("parseIntelKey", () => {
  it("splits the type prefix and the indexed path", () => {
    expect(parseIntelKey("%u:dyn_cps.apf.sat.plmn[0].mcc")).toEqual({
      type: "u",
      path: "dyn_cps.apf.sat.plmn[0].mcc",
      segs: [{ name: "dyn_cps", idx: [] }, { name: "apf", idx: [] }, { name: "sat", idx: [] }, { name: "plmn", idx: [0] }, { name: "mcc", idx: [] }],
    });
    expect(parseIntelKey("%qu[8]:dyn_cps_gri.lte_regulatory_info.na_table[0][0]")).toMatchObject({ type: "qu", size: 8, segs: [{}, {}, { name: "na_table", idx: [0, 0] }] });
    expect(parseIntelKey("%s[130]:dyn_cps_5g.a.bc_white_list[0][0]")).toMatchObject({ type: "s", size: 130 });
    // global_setting_G writes some keys with a trailing space.
    expect(parseIntelKey("%u:dyn_cps_gri.plmn_band_pri_list[0].plmn_group[0].mcc ")?.segs.at(-1)).toEqual({ name: "mcc", idx: [] });
    expect(parseIntelKey("/nv/item_files/modem/x")).toBeNull();
    expect(parseIntelKey("%u:a..b")).toBeNull();
  });
});

describe("intelTree: KDDI_jp D23", () => {
  const t = d23.intel!;

  it("is populated for the Intel dialect only, beside the flat list", () => {
    expect(d23.dialect).toBe("intel");
    expect(t.count).toBe(d23.efs.length);
    expect(t.count).toBe(96);
    expect(t.unparsed).toEqual([]);
    expect(t.nodes.map((n) => n.name)).toEqual(["dyn_cps", "dyn_cps_5g"]);
    expect(decodePri(fixture("ios27_Altice_LTE_US_overrides_V53_V54_V57.der.pri")).intel).toBeUndefined();
  });

  it("folds single-child chains and keeps name-derived notes", () => {
    const g = at(t, "dyn_cps.apf.rat_icon.nas_config") as IntelGroup;
    expect(g.name).toBe("rat_icon.nas_config");
    expect(g.note).toMatchObject({ confidence: "med" });
    expect(g.note!.text).toMatch(/Status-bar RAT icon/);
    expect((at(t, "dyn_cps.apf.sat") as IntelGroup).note!.text).toMatch(/^Satellite/);
    expect((at(t, "dyn_cps.lte_caps.ca_capabilities") as IntelGroup).name).toBe("lte_caps.ca_capabilities");
  });

  it("turns arrays of records into tables and decodes PLMNs", () => {
    const sat = at(t, "dyn_cps.apf.sat.plmn") as IntelTable;
    expect(sat).toMatchObject({ kind: "table", columns: ["mcc", "mnc"], plmnEncoding: "decimal" });
    expect(sat.rows.map((r) => r.plmn)).toEqual(["440-55"]);
    // 1088 / 84 = 0x440 / 0x54: the same PLMN written as BCD digits.
    const r = at(t, "dyn_cps.errc.plmn_band_restriction_info.plmn_band_restriction_list") as IntelTable;
    expect(r.plmnEncoding).toBe("bcd");
    expect(r.rows[0].plmn).toBe("440-54");
    expect((r.rows[0].cells.disable_bitmap_bands_33_64 as IntelValue).decoded).toEqual({ kind: "bands", rat: "lte", bands: [39], confidence: "med" });

    const bp = at(t, "dyn_cps_5g.as_5g_params.hplmn_based_filter_params.band_params_list") as IntelTable;
    expect(bp.rows.map((x) => (x.cells.band as IntelValue).decoded)).toEqual([3, 28, 41, 77, 40].map((band) => ({ kind: "band", rat: "nr", band, confidence: "med" })));
    expect(bp.columns).toEqual(["band", "cbw_dl_scs_fr1_15khz_or_fr2_60khz_bitmap", "cbw_dl_scs_fr1_30khz_or_fr2_120khz_bitmap"]);
  });

  it("reads multi-word band bitmaps, and matches them against the list they mirror", () => {
    const nc = at(t, "dyn_cps.apf.ue_capability_enhancement.bc_filters.lte_disallowed_nc_ca_band_bitmap") as IntelList;
    expect(nc.items.map((x) => x.value.int)).toEqual([5, 768]);
    expect(nc.decoded).toEqual({ kind: "bands", rat: "lte", bands: [1, 3, 41, 42], confidence: "high" });
    const dl = at(t, "dyn_cps.apf.ue_capability_enhancement.bc_filters.lte_ca_dl_disallowed_list") as IntelTable;
    expect(dl.rows.map((x) => (x.cells.band as IntelValue).int).sort((a, b) => a! - b!)).toEqual([1, 3, 41, 42]);

    // NR words are not band numbers (n15 / n22 are not KDDI bands): only the bit positions are given.
    const sa = at(t, "dyn_cps.op_features.hplmn_band_restriction.allowed_sa_band_bitmap") as IntelList;
    expect(sa.decoded).toMatchObject({ kind: "bits", bits: [2, 14, 20, 21, 36], confidence: "low" });
  });

  it("parses the NR band-combination whitelist", () => {
    const bc = at(t, "dyn_cps_5g.as_5g_params.hplmn_based_filter_params.bc_params.bc_white_list") as IntelList;
    expect(bc.items).toHaveLength(12);
    expect(bc.items[0].index).toEqual([0, 0]);
    const d = bc.items[0].value.decoded!;
    expect(d.kind).toBe("combos");
    if (d.kind !== "combos") return;
    expect(d.combos).toHaveLength(6);
    expect(d.combos[0]).toMatchObject({
      combo: "1A_18A_n3A",
      fallback: "1A_n3A",
      subset: true,
      components: [{ rat: "lte", band: 1, dl: "A" }, { rat: "lte", band: 18, dl: "A" }, { rat: "nr", band: 3, dl: "A" }],
      fallbackComponents: [{ rat: "lte", band: 1, dl: "A" }, { rat: "nr", band: 3, dl: "A" }],
    });
    // Every `/` right side in the file is a sub-combination of its left.
    const all = bc.items.flatMap((x) => (x.value.decoded?.kind === "combos" ? x.value.decoded.combos : []));
    expect(all).toHaveLength(60);
    expect(all.every((c) => c.subset)).toBe(true);
  });

  it("keeps scalar arrays as lists and names band numbers", () => {
    const bn = at(t, "dyn_cps.apf.rat_icon.nas_config.uwb_bw_list.band_num") as IntelList;
    expect(bn.items.map((x) => x.value.int)).toEqual([77, 78, 79, 0, 0, 0, 0, 0, 0, 0]);
    expect(bn.items[0].value.decoded).toEqual({ kind: "band", rat: "nr", band: 77, confidence: "med" });
    expect(bn.items[3].value.decoded).toBeUndefined();
  });

  it("filters to matching leaves, rows and items", () => {
    const f = filterIntel(t.nodes, "440-55");
    expect(JSON.stringify(f)).toContain('"plmn":"440-55"');
    expect(JSON.stringify(f)).not.toContain("hyst_timer");
    expect(filterIntel(t.nodes, "no such thing")).toEqual([]);
  });
});

describe("parseComboList", () => {
  it("splits entries on # and fallbacks on /", () => {
    expect(parseComboList("n41B/n41A#")).toEqual([{
      combo: "n41B", fallback: "n41A", subset: true,
      components: [{ rat: "nr", band: 41, dl: "B" }], fallbackComponents: [{ rat: "nr", band: 41, dl: "A" }],
    }]);
    expect(parseComboList("1A_n3A/n28A#")![0].subset).toBe(false);
    expect(parseComboList("not a combo")).toBeNull();
    expect(parseComboList("1A/2A/3A#")).toBeNull();
  });
});

describe("intelTree: label:value strings and GRI tables", () => {
  const t = gri.intel!;

  it("splits %qu label:value and folds band-mask words into one cell", () => {
    const na = at(t, "dyn_cps_gri.lte_regulatory_info.na_table") as IntelTable;
    expect(na.columns).toEqual(["mcc", "lte_band_mask"]);
    expect(na.rows[0].cells.mcc).toMatchObject({ raw: "mcc:302", label: "mcc", text: "302", int: 302 });
    expect(na.rows[0].mcc).toBe("302");
    // Canada's LTE bands.
    expect((na.rows[0].cells.lte_band_mask as IntelValue).decoded).toEqual({
      kind: "bands", rat: "lte", bands: [2, 4, 5, 7, 12, 13, 14, 17, 25, 29, 30, 38, 41, 46, 53, 66, 71], confidence: "high",
    });
    expect((na.rows[0].cells.lte_band_mask as IntelValue).raw).toBe("1_32=0x3101385a 33_64=0x00102120 65_96=0x00000042");
  });

  it("builds a per-MCC table of allowed LTE and NR bands", () => {
    const reg = t.regulatory!;
    expect(reg.mcc.map((r) => [r.region, r.mcc])).toEqual([["na", "302"], ["na", "308"], ["na", "310"], ["ww", "901"]]);
    expect(reg.mcc[0]).toEqual({
      region: "na", mcc: "302",
      lte: [2, 4, 5, 7, 12, 13, 14, 17, 25, 29, 30, 38, 41, 46, 53, 66, 71],
      nrSa: [2, 5, 7, 12, 25, 29, 41, 53, 66, 71, 77, 78],
      nrNsa: [2, 5, 7, 12, 25, 29, 41, 53, 66, 71, 77, 78],
    });
    // FR2 bands are NSA only in the US.
    expect(reg.mcc[2].nrNsa!.filter((b) => b > 256)).toEqual([258, 260, 261]);
    expect(reg.mcc[2].nrSa!.filter((b) => b > 256)).toEqual([]);
    expect(reg.mcc[3].nrNsa).toBeUndefined();
    expect(reg.plmn).toEqual([{ table: "lte_band_per_plmn", plmn: "440-50", lte: [1, 18, 28, 41] }]);
  });

  it("reads 3GPP-packed PLMNs under a BCD country code", () => {
    const l = at(t, "dyn_cps_gri.ecsr_whitelist.mcc_plmn_list") as IntelTable;
    expect(l.plmnEncoding).toBe("bcd");
    expect(l.rows.map((r) => r.mcc)).toEqual(["631", "722", "283", "602"]);
    const inner = l.rows.map((r) => r.cells.plmn as IntelTable);
    expect(inner.every((x) => x.plmnEncoding === "packed")).toBe(true);
    expect(inner.map((x) => x.rows.map((r) => r.plmn))).toEqual([["631-04"], ["722-34", "722-341", "722-07", "722-070"], ["283-05", "283-10"], ["602-03"]]);
  });

  it("nests record arrays inside rows", () => {
    const p = at(t, "dyn_cps_gri.plmn_band_pri_list") as IntelTable;
    expect(p.rows[0].index).toEqual([1]);
    const grp = p.rows[0].cells.plmn_group as IntelTable;
    expect(grp.rows.map((r) => r.plmn)).toEqual(["460-00", "460-02", "460-07", "460-08"]);
    const lte = p.rows[0].cells.lte_band_priority_list as IntelTable;
    expect(lte.columns).toEqual(["lte_band_num", "lower_earfcn", "higher_earfcn"]);
    expect((lte.rows[0].cells.lte_band_num as IntelValue).decoded).toMatchObject({ kind: "band", rat: "lte", band: 3 });
  });

  it("reads NR regulatory rows as MCC + band list", () => {
    const sa = at(t, "dyn_cps_gri.nr_sa_regulatory_info.ww_table") as IntelList;
    expect(sa.items[0].value).toMatchObject({ label: "901", text: "1-2-3-5-7-8-12-28-66-77-78", decoded: { kind: "mccBands", mcc: "901", bands: [1, 2, 3, 5, 7, 8, 12, 28, 66, 77, 78] } });
  });
});

describe("intelTree: older Intel file (ATT_US D321/D331/N841, iPhone XS/XR)", () => {
  const b = openIpcc(new Uint8Array(readFileSync(join(here, "fixtures", "ATT_US.ipcc"))));
  const d = decodeFile(b, "overrides_D321_D331_N841.der.pri").pri!;

  it("still decodes, with range-named bitmasks folded", () => {
    expect(d.efs).toHaveLength(53);
    const t = d.intel!;
    expect(t.count).toBe(53);
    const mimo = at(t, "dyn_csi_cps.ice_errc_params_nvm.ice_mcc_mimo_bitmask");
    expect(mimo).toMatchObject({ kind: "leaf", value: { decoded: { kind: "bands", rat: "lte", bands: [2, 4, 30, 66] } } });
    const all = at(t, "dyn_cps.nas_om.mode_on_profile.bands.eutran.bitmap_bands_1_32");
    expect(all).toMatchObject({ kind: "leaf", value: { int: 0xfffeffff } });
    if (all.kind === "leaf" && all.value.decoded?.kind === "bands") expect(all.value.decoded.bands).not.toContain(17);
    const codecs = at(t, "dyn_cps.supported_codec_list") as IntelList;
    expect(codecs.items.map((x) => x.index)).toEqual([[0, 5], [1, 1]]);
  });

  it("accepts plain string values too", () => {
    const t = intelTree([{ key: "%qu[8]:dyn_cps_gri.x[0][0]", value: "mcc:302" }, { key: "%qu[8]:dyn_cps_gri.x[0][1]", value: "mnc:720" }]);
    expect((t.nodes[0] as IntelGroup).children[0]).toMatchObject({ kind: "table", rows: [{ plmn: "302-720" }] });
  });
});

describe("fixed-size arrays and regions", () => {
  const list = (vals: string[]) => {
    const t = intelTree(vals.map((v, i) => ({ key: `%u:dyn_cps.apf.rat_icon.nas_config.uwb_bw_list.band_num[${i}]`, value: v })));
    const find = (n: IntelNode): IntelList | undefined =>
      n.kind === "list" ? n : n.kind === "group" ? n.children.map(find).find(Boolean) : undefined;
    return t.nodes.map(find).find(Boolean)!;
  };

  it("counts the slots in use before a run of zero padding", () => {
    const l = list(["77", "78", "79", "0", "0", "0", "0", "0", "0", "0"]);
    expect([l.items.length, l.used]).toEqual([10, 3]);
  });

  it("keeps a single trailing zero, which can be a real value", () => {
    expect(list(["1", "0"]).used).toBe(2);
  });

  it("names every GRI region table prefix", () => {
    for (const r of ["na", "la", "eu", "africa", "asia", "ocean", "ww"]) expect(INTEL_REGIONS[r]).toBeTruthy();
  });
});
