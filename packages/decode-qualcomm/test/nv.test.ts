/** Tests for `src/nv.ts` (EFS path / NV item lookup). Expected values come from the NV tables' sources. */

import { describe, it, expect } from "vitest";
import { hexToBytes } from "@carrier-explode/binary";

import { annotateNv, decodeNvValue, describeNv, NV_FAMILIES, NV_PATHS } from "../src/nv.ts";

const hex = hexToBytes;

describe("annotateNv", () => {
  it("names an item and labels its value", () => {
    expect(annotateNv("/nv/item_files/modem/mmode/voice_domain_pref", 1)).toMatchObject({ label: decodeNvValue("/nv/item_files/modem/mmode/voice_domain_pref", 1) });
    expect(annotateNv("/nv/item_files/modem/mmode/voice_domain_pref")).not.toHaveProperty("label");
    expect(annotateNv("/no/such/item")).toBeUndefined();
  });

  it("recognises the modem's own record of which defaults it holds", () => {
    expect(annotateNv("/mav/bbcfg_file_hash_protocol_static_nv")?.meaning).toMatch(/^Baseband defaults digest:/);
  });

  it("reads band bitmaps, RAT orders and satellite EARFCNs out of their bytes", () => {
    const label = (path: string, s: string) => annotateNv(`/nv/item_files/modem/${path}`, undefined, hex(s))?.label;
    expect(label("lte/rrc/cap/whitelist_ca_combos_with_ulca", "12280020" + "00800000" + "02000000" + "00".repeat(20))).toBe("B2 B5 B12 B14 B30 B48 B66");
    expect(label("lte/rrc/cap/blacklist_ca_combos_with_nc_combos", "00".repeat(32))).toBe("none");
    expect(label("nas/hplmn_rat_order", "04000c090503000000000000")).toBe("NR > LTE > WCDMA > GSM");
    expect(label("nas/mav_pssi_reg_gfnh_allowed_frequencies_per_carrier", "01b80100001a000000e1000000")).toBe("440-26 EARFCN 225");
    // Bytes that do not fit the layout keep no label rather than a wrong one.
    expect(label("nas/mav_pssi_reg_gfnh_allowed_frequencies_per_carrier", "02f9010b00d70a00000b00d70af9010000")).toBeUndefined();
  });
});

describe("describeNv / decodeNvValue", () => {
  it("resolves exact EFS paths with enum labels", () => {
    const v = describeNv("/nv/item_files/modem/mmode/voice_domain_pref")!;
    expect(v).toMatchObject({ name: "Voice domain preference", type: "enum", confidence: "high" });
    expect(v.family).toBeUndefined();
    const labels = [0, 1, 2, 3].map((n) => decodeNvValue("/nv/item_files/modem/mmode/voice_domain_pref", n));
    expect(labels).toEqual(["CS voice only", "IMS PS voice only", "CS voice preferred", "IMS PS voice preferred"]);
    expect(decodeNvValue("/nv/item_files/modem/mmode/voice_domain_pref", 9)).toBeUndefined();
  });

  it("labels sms_domain_pref, ue_usage_setting, nr5g_disable_mode and IMS_enable", () => {
    const sms = "/nv/item_files/modem/mmode/sms_domain_pref";
    expect([-1, 255, 0, 1].map((n) => decodeNvValue(sms, n))).toEqual(["None", "None", "PS SMS not allowed", "PS (IMS) SMS preferred"]);
    expect(decodeNvValue("/nv/item_files/modem/mmode/ue_usage_setting", 1)).toBe("Data centric");
    expect(decodeNvValue("/nv/item_files/modem/mmode/nr5g_disable_mode", 1)).toBe("SA disabled");
    expect(describeNv("/nv/item_files/modem/mmode/nr5g_disable_mode")!.confidence).toBe("low");
    expect(decodeNvValue("/nv/item_files/ims/IMS_enable", 1)).toBe("Enabled");
    expect(decodeNvValue("/nv/item_files/ims/IMS_enable", 2)).toBeUndefined(); // shipped everywhere, unpublished
    expect(decodeNvValue("/nv/item_files/modem/nas/nas_srvcc_support", 1)).toBe("On");
  });

  it("falls back to path families", () => {
    expect(describeNv("/nv/item_files/modem/lte/rrc/efs/lte_fgi_r10_tdd")).toMatchObject({ family: "lte_fgi", type: "bitmask", confidence: "med", name: "lte_fgi_r10_tdd" });
    expect(describeNv("/nv/item_files/modem/mav/mav_dmc_enabled")).toMatchObject({ family: "mav", confidence: "low" });
    expect(describeNv("/nv/item_files/modem/mav/drs_enable")!.family).toBe("drs");
    expect(describeNv("/nv/item_files/modem/nas/mav_force_srvcc")!.family).toBe("mav");
    expect(describeNv("/nv/item_files/modem/nas/mav_pssi_reg_gfnh_allowed_plmn_per_carrier")!.family).toBe("satellite");
    expect(describeNv("/nv/item_files/modem/uim/gstk/feature_bmask__mav_override")!.family).toBe("mav_override");
    expect(describeNv("/nv/item_files/modem/nr5g/RRC/cap_control_nrca_4x_f_plus_t_band_combos")!.family).toBe("nr_band_combos");
    expect(describeNv("/policyman/l2nr_policy.xml")!.family).toBe("policyman_xml");
    // Intel / Apple C1 NVM keys are decode-ios's (describeIntelKey).
    expect(describeNv("%u:dyn_cps.dam.support")).toBeUndefined();
    expect(describeNv("/nv/item_files/modem/nas/isr")!.family).toBeUndefined(); // exact wins
    expect(describeNv("/not/an/efs/path")).toBeUndefined();
    expect(decodeNvValue("/nv/item_files/modem/mav/mav_dmc_enabled", 1)).toBeUndefined();
  });

  it("resolves legacy NV item numbers, as numbers or strings", () => {
    expect(describeNv(441)).toMatchObject({ item: 441, name: "Band Class Preference", confidence: "med", source: "mbn_utils nv_complete.txt" });
    expect(describeNv(442)).toMatchObject({ name: "Roaming preference", confidence: "high", source: "ModemManager libqcdm nv-items.h" });
    expect(describeNv("NV 850")!.name).toBe("Service domain preference");
    expect(describeNv("3446")!.name).toBe("TRM Configuration");
    expect(describeNv(176)!.name).toBe("IMSI MCC");
    expect(describeNv(99999)).toBeUndefined();
    expect(describeNv(62012)).toMatchObject({ name: "Call Manager Feature Group", confidence: "high" });
  });

  it("labels legacy NV enums, bitmasks and packed versions", () => {
    expect(decodeNvValue(10, 31)).toBe("GWL");
    expect(decodeNvValue(10, 71)).toBe("NR5G only");
    expect(decodeNvValue(850, 2)).toBe("CS + PS");
    expect(decodeNvValue(946, 0b1000001)).toBe("GSM 450, WCDMA B1 2100");
    expect(decodeNvValue(946, 1 << 14)).toBe("bit 14");
    expect(decodeNvValue(946, 0)).toBe("none");
    expect(decodeNvValue(62005, 0x00a10100)).toBe("0.1.161");
    expect(decodeNvValue(62033, 589838)).toBe("14.0.9");
    expect(decodeNvValue("NV 62005", 0x00a10006)).toBe("6.0.161");
    expect(decodeNvValue(6792, 131072)).toBe("2.0.0");
    expect(decodeNvValue(442, 255)).toBe("Automatic");
    expect(decodeNvValue(441, 255)).toBeUndefined();
    expect(decodeNvValue(1896, Number.NaN)).toBeUndefined();
  });

  it("names Apple modem options from the modem firmware's strings", () => {
    const mav = "/nv/item_files/modem/mav/";
    expect(describeNv(`${mav}mav_gsm_disable_mcc_list`)).toMatchObject({ name: "GSM-disabled MCCs", confidence: "med" });
    expect(describeNv("/nv/item_files/modem/nas/mav_nr_reject_smc_null_ciphering")).toMatchObject({ type: "bool", confidence: "med" });
    expect(decodeNvValue("/nv/item_files/modem/nas/mav_lte_reject_smc_null_ciphering", 1)).toBe("On");
    expect(decodeNvValue("/mav/product_pri_setting_revision", 0x000d0001)).toBe("1.0.13");
    expect(describeNv("/nv/item_files/modem/lte/rrc/bbq/bbq_mitigation")!.name).toBe("Fake eNodeB mitigation");
    expect(describeNv(`${mav}enable_dyn_vonr`)).toMatchObject({ name: "Dynamic VoNR", confidence: "med" });
    expect(describeNv(`${mav}drs_enable`)).toMatchObject({ family: "drs", confidence: "med" });
    expect(describeNv(`${mav}enable_ds_partial_mitigation`)!.family).toBe("ds_mit");
    expect(describeNv(`${mav}sa_depri_td_bwp_thresh_val`)!.family).toBe("sdm");
    expect(describeNv(`${mav}mav_monitor_mm_mb_replace_nr5g_with_nr5guwb`)!.family).toBe("rat_icon");
    expect(describeNv(`${mav}uwb_nr_band_bw`)!.family).toBeUndefined(); // exact wins over rat_icon
    expect(describeNv("/mav/hst_volte_classifier_decision_threshold")!.family).toBe("hst");
    expect(describeNv("/mav/cpms_feature_toggle")!.family).toBe("cpms");
    expect(describeNv("/nv/item_files/modem/nas/mav_pssi_reg_unblock_hplmn_max_reg_failure")!.family).toBe("pssi");
    expect(describeNv("/nv/item_files/modem/nas/mav_nr_prio_sub_band_per_plmn")!.family).toBe("band_per_plmn");
    expect(describeNv("/nv/item_files/mcs/lmtsmgr/vbatt/vbatt_lte_limit")!.family).toBe("lmtsmgr");
    expect(describeNv("/cgps/nv/item_files/me/gnss_pga_backoff_config")!.family).toBe("gps");
  });

  it("keeps every table entry well-formed", () => {
    const confs = new Set(["high", "med", "low"]);
    for (const [p, v] of Object.entries(NV_PATHS)) {
      expect(p.startsWith("/"), p).toBe(true);
      expect(confs.has(v.confidence), p).toBe(true);
      expect(v.source.length, p).toBeGreaterThan(0);
      if (v.values) expect(Object.keys(v.values).length, p).toBeGreaterThan(0);
    }
    for (const f of NV_FAMILIES) expect(confs.has(f.confidence), f.family).toBe(true);
  });
});
