/**
 * Lookup of the Qualcomm EFS paths and legacy NV item numbers that modem
 * configurations assign (MCFG items, and Apple's `*.der.pri` overrides once unwrapped).
 *
 * `describeNv(pathOrItem)` resolves an exact path, then a path family, then a legacy
 * NV number. `decodeNvValue(pathOrItem, n)` turns a scalar into its enum/bit label.
 */

import { errorMessage, maskBits, u16le, u32le } from "@carrier-explode/binary";
import type { Confidence } from "./confidence.ts";
import { bandList } from "./policy.ts";
import { decodePrl, describePrl, type PrlDecoded } from "./prl.ts";

export type NvType =
  | "bool" | "uint8" | "int8" | "uint16" | "uint32" | "uint64"
  | "enum" | "bitmask" | "version" | "string" | "text" | "xml" | "bytes" | "int";

export interface NvInfo {
  /** The path or `NV <n>` this entry was resolved for. */
  key: string;
  /** Legacy NV item number, when the key is one. */
  item?: number;
  name: string;
  meaning: string;
  type: NvType;
  /** Enum labels by value. */
  values?: Record<number, string>;
  /** Bitmask labels by bit index (LSB = 0). */
  bits?: Record<number, string>;
  confidence: Confidence;
  /** Where the finding comes from. */
  source: string;
  /** Set when matched by a path family rather than the exact path. */
  family?: string;
}

type Entry = Omit<NvInfo, "key" | "item" | "family"> & {
  format?: (n: number) => string;
  /** Reads a structured value; undefined when the bytes do not fit the layout. */
  decode?: (b: Uint8Array) => string | undefined;
};

const e = (
  name: string, meaning: string, type: NvType, confidence: Confidence, source: string,
  extra: Partial<Entry> = {},
): Entry => ({ name, meaning, type, confidence, source, ...extra });

const XQCN = "XQCN nv_efs_data_format.xml";
const EFST = "EfsTools Efs.cs";
const MBNU = "mbn_utils nv_complete.txt";
const PLAIN = "plaintext .pri in CW_pa / BhartiAirtel_in";
const CORPUS = "corpus: iOS 27.0 overrides";
const FW = "qdsp6sw.mbn rodata";
const CLADE = "qdsp6sw.mbn CLADE2 region";
const LIBQCDM = "ModemManager libqcdm nv-items.h";
const PIXEL = "Pixel 1-5a MCFG bytes";

const OFF_ON = { 0: "Off", 1: "On" };

/** `[major, minor, patch, 0]` little-endian, e.g. 0x00a10100 -> "0.1.161". */
const bytesVersion = (n: number) => `${n & 0xff}.${(n >>> 8) & 0xff}.${(n >>> 16) & 0xff}`;

/** 256-bit LTE band bitmap as uint32-LE words: word w, bit b = band 32w + b + 1. */
function lteBandBitmap(b: Uint8Array): string | undefined {
  if (!b.length || b.length % 4) return undefined;
  const bands: number[] = [];
  for (let w = 0; w < b.length / 4; w++) for (const bit of maskBits(u32le(b, 4 * w))) bands.push(32 * w + bit + 1);
  return bands.length ? bandList(bands, "lte") : "none";
}

/** Qualcomm sys_sys_mode_e_type, as RAT lists store it. */
const SYS_MODE: Record<number, string> = { 2: "CDMA", 3: "GSM", 4: "HDR", 5: "WCDMA", 9: "LTE", 11: "TD-SCDMA", 12: "NR" };

/** uint16 count, then one sys_sys_mode byte per RAT, zero-padded. */
function ratOrder(b: Uint8Array): string | undefined {
  const n = b.length >= 2 ? u16le(b, 0) : 0;
  if (!n || 2 + n > b.length) return undefined;
  return [...b.subarray(2, 2 + n)].map((x) => SYS_MODE[x] ?? `RAT ${x}`).join(" > ");
}

/** uint8 count, then {MCC u16, 0 u16, MNC u32, EARFCN u32}; a PLMN with two EARFCNs is two records. */
function plmnEarfcns(b: Uint8Array): string | undefined {
  const n = b[0];
  if (!n || b.length !== 1 + 12 * n) return undefined;
  return Array.from({ length: n }, (_, i) => {
    const o = 1 + 12 * i;
    return `${u16le(b, o)}-${String(u32le(b, o + 4)).padStart(2, "0")} EARFCN ${u32le(b, o + 8)}`;
  }).join(", ");
}

/** NV 257 past its subscription mask: u16 PRL ID, u32 PRL size in bits, a byte that is 1 in every Pixel config, then the PRL. */
const PRL_HEADER = 7;

export interface NvPrl {
  readonly id: number;
  readonly sizeBits: number;
  readonly prl: PrlDecoded;
  /** What of the NV header the PRL behind it contradicts: `header ID 7`, `header size 8 bits`. */
  readonly disagreements: readonly string[];
}

/** NV 257's PRL; throws when the bytes are not a PRL behind its header. */
export function decodeNvPrl(b: Uint8Array): NvPrl {
  if (b.length < PRL_HEADER) throw new Error(`NV 257: ${b.length} bytes, shorter than its header`);
  const [id, sizeBits, prl] = [u16le(b, 0), u32le(b, 2), decodePrl(b.subarray(PRL_HEADER))];
  const disagreements = [
    ...(id === prl.id ? [] : [`header ID ${id}`]),
    ...(sizeBits === 8 * (b.length - PRL_HEADER) ? [] : [`header size ${sizeBits} bits`]),
  ];
  return { id, sizeBits, prl, disagreements };
}

function prlLabel(b: Uint8Array): string {
  try {
    const { prl, disagreements } = decodeNvPrl(b);
    return [describePrl(prl), ...disagreements].join("; ");
  } catch (e) {
    return `not a PRL: ${errorMessage(e)}`;
  }
}

const MMODE = "/nv/item_files/modem/mmode/";
const NAS = "/nv/item_files/modem/nas/";
const PS = "/nv/item_files/modem/data/3gpp/ps/";
const MAV = "/nv/item_files/modem/mav/";

export const NV_PATHS: Record<string, Entry> = {
  // plaintext .pri key "IMS Feature Enable" = this path; value 2 is shipped but its meaning is unpublished
  "/nv/item_files/ims/IMS_enable": e("IMS enable", "Enables the IMS task (VoLTE, VoWiFi, SMS over IMS)", "uint8", "high", `${XQCN}; ${PLAIN}`, { values: { 0: "Disabled", 1: "Enabled" } }),
  "/nv/item_files/ims/media_service_config": e("IMS media service config", "IMS media (codec/RTP) service config; no public schema", "bytes", "low", "name only"),
  // plaintext .pri "Voice Domain Preference = CS Voice Only" decodes as 0 here
  [`${MMODE}voice_domain_pref`]: e("Voice domain preference", "E-UTRAN voice domain (TS 24.301 9.9.3.44)", "enum", "high", `${XQCN}; ${EFST}; ${PLAIN}`, {
    values: { 0: "CS voice only", 1: "IMS PS voice only", 2: "CS voice preferred", 3: "IMS PS voice preferred", 255: "None" },
  }),
  [`${MMODE}sms_domain_pref`]: e("SMS domain preference", "SMS over IMS preference", "enum", "high", `${XQCN}; ${EFST}; ${PLAIN}`, {
    values: { [-1]: "None", 255: "None", 0: "PS SMS not allowed", 1: "PS (IMS) SMS preferred" },
  }),
  [`${MMODE}sms_domain_pref_list`]: e("SMS domain preference list", "Per-RAT/PLMN SMS domain list; layout not public", "bytes", "low", "name only"),
  [`${MMODE}ue_usage_setting`]: e("UE usage setting", "TS 24.301 UE usage setting", "enum", "med", `${XQCN}; ${EFST}`, { values: { 0: "Voice centric", 1: "Data centric", 255: "None" } }),
  // Quectel AT+QNWPREFCFG="nr5g_disable_mode" exposes the same item; raw encoding assumed identical
  [`${MMODE}nr5g_disable_mode`]: e("NR5G disable mode", "Disables NR5G SA and/or NSA", "enum", "low", "Quectel RM520N AT manual", { values: { 0: "NR5G enabled", 1: "SA disabled", 2: "NSA disabled" } }),
  [`${MMODE}nr5g_emc_support`]: e("NR5G emergency support", "NR5G emergency-call support", "bool", "low", "name only", { values: OFF_ON }),
  [`${MMODE}lte_disable_duration`]: e("LTE disable duration", "How long LTE stays disabled when CS services are unavailable", "uint32", "med", `${XQCN}; ${EFST}`),
  [`${MMODE}sms_mandatory`]: e("SMS mandatory", "SMS is mandatory for the device (block LTE if IMS/SGs SMS registration fails)", "bool", "med", XQCN, { values: OFF_ON }),
  [`${MMODE}sms_only`]: e("SMS only", "Register for SMS only", "bool", "med", EFST, { values: OFF_ON }),
  [`${MMODE}lte_bandpref`]: e("LTE band preference", "LTE band bitmap (bit n = band n+1)", "bitmask", "med", EFST),
  [`${NAS}nas_srvcc_support`]: e("SRVCC support", "SRVCC capability indication from E-UTRAN to UTRAN (TS 23.216)", "bool", "high", `${XQCN}; ${EFST}; ${PLAIN}`, { values: OFF_ON }),
  [`${NAS}lte_nas_ignore_mt_csfb_during_volte_call`]: e("Ignore MT CSFB during VoLTE", "Ignore a mobile-terminated CSFB page while a VoLTE call is active", "bool", "high", `${XQCN}; ${PLAIN}`, { values: OFF_ON }),
  [`${NAS}lte_nas_temp_fplmn_backoff_time`]: e("Temporary FPLMN backoff time", "EMM temporary-forbidden-PLMN backoff timer; 0xffffffff = disabled", "uint32", "med", EFST),
  [`${NAS}emm_nas_nv_items`]: e("EMM NAS items", "32-byte EMM configuration blob", "bytes", "med", EFST),
  // corpus: 04 00 0c 09 05 03 (T-Mobile); C1 hplmn_rat_order[] lists the same RATs in its own enum
  [`${NAS}hplmn_rat_order`]: e("HPLMN RAT order", "Home-PLMN RAT search order: uint16 count, then sys_sys_mode RATs", "bytes", "med", `${CORPUS}; C1 apf.pssi.hplmn_rat_order`, { decode: ratOrder }),
  // corpus: Docomo 01 b801 0000 1a000000 e1000000 = 440-26 on EARFCN 225, as C1 apf.sat.plmn_earfcn_list[] writes it
  [`${NAS}mav_pssi_reg_gfnh_allowed_frequencies_per_carrier`]: e("Satellite EARFCNs per carrier", "LTE channels the carrier's satellite (GFNH) service may register on, per PLMN", "bytes", "med", `${CORPUS}; C1 apf.sat.plmn_earfcn_list`, { decode: plmnEarfcns }),
  [`${NAS}isr`]: e("ISR", "Idle-mode Signalling Reduction (TS 23.401)", "bool", "med", "name + 3GPP", { values: OFF_ON }),
  [`${NAS}csg_support_configuration`]: e("CSG support", "Closed Subscriber Group (femtocell) support", "uint8", "med", EFST),
  [`${NAS}irat_search_timer`]: e("IRAT search timer", "Inter-RAT search timer", "uint32", "med", EFST),
  [`${NAS}max_validate_sim_counter`]: e("Max validate SIM counter", "SIM validation retry limit", "uint8", "med", EFST),
  [`${NAS}nas_lai_change_force_lau_for_emergency`]: e("Force LAU on LAI change (emergency)", "Force a location-area update on LAI change during an emergency call", "bool", "med", EFST, { values: OFF_ON }),
  [`${NAS}tdscdma_op_plmn_list`]: e("TD-SCDMA operator PLMN list", "Packed PLMN list", "bytes", "med", EFST),
  "/nv/item_files/jcdma/jcdma_mode": e("JCDMA mode", "Japan CDMA (KDDI) simplified feature set; plaintext key 'Enable JCDMA'", "bool", "high", PLAIN, { values: OFF_ON }),
  // corpus: 32 bytes; C1 bc_filters.lte_ulca_band_bitmap[] / lte_disallowed_nc_ca_band_bitmap[] hold the same words in 26 of 28 carriers
  "/nv/item_files/modem/lte/rrc/cap/whitelist_ca_combos_with_ulca": e("LTE bands with UL CA", "LTE bands allowed in uplink carrier-aggregation combos", "bytes", "med", `${CORPUS}; C1 bc_filters.lte_ulca_band_bitmap`, { decode: lteBandBitmap }),
  "/nv/item_files/modem/lte/rrc/cap/blacklist_ca_combos_with_nc_combos": e("LTE bands without non-contiguous CA", "LTE bands left out of non-contiguous intra-band CA combos", "bytes", "med", `${CORPUS}; C1 bc_filters.lte_disallowed_nc_ca_band_bitmap`, { decode: lteBandBitmap }),
  "/nv/item_files/modem/lte/rrc/efs/lte_feature_enable": e("LTE feature enable", "LTE RRC capability feature-enable bitmap; bit list unpublished", "bytes", "med", "cacombos.com"),
  "/nv/item_files/modem/lte/rrc/efs/lte_feature_disable": e("LTE feature disable", "LTE RRC capability feature-disable bitmap", "bytes", "med", "cacombos.com"),
  "/nv/item_files/modem/lte/rrc/efs/band_priority_list_v2": e("LTE band priority list", "Prioritised band list for LFS/FFS scans (uint16 array)", "bytes", "med", XQCN),
  "/nv/item_files/modem/lte/rrc/efs/eps_fallback_control": e("EPS fallback control", "VoNR to EPS fallback control", "bytes", "low", "name only"),
  // qdsp6sw.mbn rodata: path sits beside bbq/fake_enodeb_exception_plmn_list, then mav_lte_p2p.c
  "/nv/item_files/modem/lte/rrc/bbq/bbq_mitigation": e("Fake eNodeB mitigation", "LTE false-base-station (fake eNodeB) mitigation", "bool", "med", FW, { values: OFF_ON }),
  "/nv/item_files/modem/lte/rrc/bbq/fake_enodeb_exception_plmn_list": e("Fake eNodeB exception PLMNs", "PLMNs exempt from fake-eNodeB mitigation (count byte, then 3-byte BCD PLMNs)", "bytes", "med", FW),
  // qdsp6sw.mbn CLADE2: listed beside grr/fake_bs_detection_enabled
  "/nv/item_files/modem/geran/grr/fake_bts_cell_barring_enabled": e("Fake BTS cell barring", "Bar GSM cells that fake-base-station detection flags", "bool", "med", CLADE, { values: OFF_ON }),
  "/nv/item_files/modem/lte/rrc/PC2_WHITELIST.xml": e("PC2 whitelist", "Bands allowed Power Class 2 (26 dBm)", "xml", "low", "name only"),
  "/nv/item_files/modem/qmi/cat/qmi_cat_block_sms_pp_env_per_sub": e("Block SMS-PP envelope", "Block SIM Toolkit SMS-PP (data download) envelopes, per subscription", "bool", "med", "name only", { values: OFF_ON }),
  "/nv/item_files/modem/nr5g/RRC/cap_feature_band_nr": e("NR band capability", "NR band feature-capability list; proprietary layout", "bytes", "med", "name only"),
  "/nv/item_files/modem/nr5g/RRC/cap_control_t_plus_f_band_combos": e("NR TDD+FDD combo control", "Enables NR-CA/NR-DC TDD+FDD band-combo classes", "int", "med", "cacombos.com"),
  "/nv/item_files/wcdma/rrc/wcdma_rrc_fast_return_to_lte_after_csfb": e("Fast return to LTE after CSFB", "Return from WCDMA to LTE right after a CSFB call", "bool", "med", EFST, { values: OFF_ON }),
  "/nv/item_files/wcdma/rrc/wcdma_rrc_wtol_ps_ho_support": e("WCDMA to LTE PS handover", "WCDMA->LTE PS handover support", "bool", "med", EFST, { values: OFF_ON }),
  "/nv/item_files/wcdma/rrc/wcdma_rrc_wtol_tdd_ps_ho_support": e("WCDMA to LTE-TDD PS handover", "WCDMA->LTE TDD PS handover support", "bool", "med", EFST, { values: OFF_ON }),
  "/nv/item_files/wcdma/rrc/wcdma_rrc_feature": e("WCDMA RRC feature", "WCDMA RRC feature mask", "uint16", "med", EFST),
  "/nv/item_files/modem/geran/grr/g2l_blind_redir_after_csfb_control": e("G2L blind redirect after CSFB", "GSM->LTE blind redirection after a CSFB call", "uint8", "med", EFST),
  "/nv/item_files/modem/sms/mmgsdi_refresh_vote_ok": e("Refresh vote OK", "Vote TRUE for SIM REFRESH", "bool", "med", `${XQCN}; ${EFST}`, { values: OFF_ON }),
  "/nv/item_files/modem/uim/mmgsdi/refresh_retry": e("SIM refresh retry", "SIM REFRESH retry parameters (4 x uint32)", "bytes", "med", EFST),
  [`${PS}rel_10_throttling`]: e("Rel-10 throttling", "Rel-10 APN congestion back-off (T3396)", "bool", "med", EFST, { values: OFF_ON }),
  [`${PS}ser_req_throttle_behavior`]: e("Service request throttle behaviour", "Service-request throttling behaviour", "uint32", "med", EFST),
  [`${PS}allow_infinite_throt`]: e("Allow infinite throttle", "Allow an infinite throttle timer", "bool", "med", EFST, { values: OFF_ON }),
  [`${PS}apn_reject/apn_reject_name.txt`]: e("APN reject name", "APN whose rejection triggers carrier throttling", "text", "med", EFST),
  "/nv/item_files/modem/data/epc/pdn_throttling_config.txt": e("PDN throttling config", "Carrier PDN throttling timers", "text", "med", EFST),
  "/nv/item_files/modem/data/3gpp/call_orig_allowed_before_ps_attach": e("Call before PS attach", "Allow data-call origination before PS attach", "bool", "med", EFST, { values: OFF_ON }),
  "/nv/item_files/data/3gpp/ds_3gpp_mtu": e("3GPP MTU", "Default PDN MTU in bytes", "uint16", "med", EFST),
  "/nv/item_files/data/3gpp/rpm_params": e("RPM params", "Radio Policy Manager retry limits (10 bytes)", "bytes", "med", EFST),
  "/nv/item_files/data/3gpp/rpm_suppported_sim": e("RPM SIM list", "SIMs Radio Policy Manager applies to", "bytes", "med", EFST),
  "/nv/item_files/modem/lte_connection_control": e("LTE connection control", "LTE connection control", "uint8", "low", EFST),
  "/data/ds_dsd_apm_rules.txt": e("APM rules", "Attach PDN Manager rules (which PDN is required for attach)", "text", "med", EFST),
  "/data/default_andsf.xml": e("Default ANDSF", "ANDSF Wi-Fi/cellular steering policy (TS 24.312)", "xml", "med", EFST),
  "/data/3gpp/data_3gpp_dynamic_config.xml": e("3GPP data dynamic config", "Per-PLMN data rules, domestic/international roaming PLMN lists", "xml", "med", CORPUS),
  "/policyman/carrier_policy.xml": e("Carrier policy", "PolicyMan rules keyed on MCC/PLMN: RAT capability, RF bands, UE mode", "xml", "med", `${EFST}; tech.ssut.me`),
  // plaintext .pri writes 28 here next to NV 10 = GWL; bit meanings unpublished
  "/mav/mav_police_pri_mode_pref_mask": e("Mode preference police mask", "Apple mask over the PRI mode preference", "bitmask", "low", PLAIN),

  // qdsp6sw.mbn CLADE2: these six sit together after cmsds.c "cmsds_perform_plmn_blocking"
  [`${MAV}mav_gsm_disable_mcc_list`]: e("GSM-disabled MCCs", "MCCs where GSM is not used (count byte, then uint16 MCCs; bbcfg ships 440, 441, 466, 525)", "bytes", "med", `${CLADE}; bbcfg.mbn`),
  // bbcfg.mbn value 04 130051 130082 130083 130014 = 310-150/280/380/410
  [`${MAV}mav_cm_cs_shutdown_plmn_list`]: e("CS shutdown PLMNs", "PLMNs whose 2G/3G circuit-switched network is shut down (count byte, then 3-byte BCD PLMNs)", "bytes", "med", `${CLADE}; bbcfg.mbn`),
  [`${MAV}mav_ux_sys_sel_opti_mcc_list`]: e("System-selection optimisation MCCs", "MCCs that get Apple's system-selection UX optimisation (count byte, then uint16 MCCs; bbcfg ships 460, 404)", "bytes", "med", `${CLADE}; bbcfg.mbn`),
  // qdsp6sw.mbn CLADE2: QMI handler "qmi_nasi_unblock_nr5g_plmn" and "ds_3gpp_pdn_cntxt_unblock_nr5g_plmn"
  [`${MMODE}mav_unblock_nr_fplmn`]: e("Unblock NR on forbidden PLMN", "Allow lifting the NR5G PLMN block that CM applies after NR registration failures", "bool", "med", CLADE, { values: OFF_ON }),
  [`${MMODE}mav_sa_only_carrier`]: e("SA-only carrier", "Carrier runs 5G standalone only (no NSA)", "bool", "med", CLADE, { values: OFF_ON }),
  [`${MMODE}mav_rat_no_srv_update_hold_timer`]: e("No-service RAT update hold timer", "Hold time before reporting a RAT change to no service", "uint32", "low", CLADE),
  // qdsp6sw.mbn CLADE2: path between "qmi_voice_cm_if_send_flash" and the incoming-call handlers
  [`${MMODE}qmi/mav_pri_allow_auto_answer`]: e("Allow auto answer", "Allow automatic answering of incoming voice calls", "bool", "med", CLADE, { values: OFF_ON }),
  // qdsp6sw.mbn CLADE2: NAS reg_sim.c strings, followed by the endc and nr_in_roam variants
  [`${NAS}mav_lte_reject_smc_null_ciphering`]: e("Reject LTE null ciphering", "Reject an LTE NAS Security Mode Command that selects null ciphering (EEA0)", "bool", "med", CLADE, { values: OFF_ON }),
  [`${NAS}mav_nr_reject_smc_null_ciphering`]: e("Reject NR null ciphering", "Reject a 5G NAS Security Mode Command that selects null ciphering (NEA0)", "bool", "med", CLADE, { values: OFF_ON }),
  [`${NAS}mav_endc_reject_smc_null_ciphering`]: e("Reject EN-DC null ciphering", "Reject null ciphering while on EN-DC", "bool", "med", CLADE, { values: OFF_ON }),
  [`${NAS}mav_nr_in_roam_reject_smc_null_ciphering`]: e("Reject NR null ciphering when roaming", "Reject 5G NAS null ciphering while roaming", "bool", "med", CLADE, { values: OFF_ON }),
  [`${MAV}mav_disable_sa_no_ciph`]: e("Disable SA without ciphering", "Turn off 5G SA when the network does not cipher", "bool", "med", FW, { values: OFF_ON }),
  // qdsp6sw.mbn rodata: read with mav_qmi_nas_assisted_scan / mav_sa_coverage_band_list
  [`${MAV}mav_disable_sa_if_null_suci`]: e("Disable SA on null SUCI", "Turn off 5G SA when the SUCI uses the null protection scheme (SUPI sent unconcealed)", "bool", "med", FW, { values: OFF_ON }),
  // corpus: T-Mobile bundles write 0x47 = n71
  [`${MAV}mav_sa_coverage_band_list`]: e("SA coverage bands", "NR bands that count as 5G SA coverage (uint8 band numbers, zero-padded)", "bytes", "med", `${FW}; ${CORPUS}`),
  [`${MAV}mav_skip_sms_only_ims_pref_ind_on_sa`]: e("Skip SMS-only indication on SA", "Do not send the SMS-only / IMS-preference indication while on 5G SA", "bool", "med", FW, { values: OFF_ON }),
  // corpus: 04 00 | 01 03 07 4e | 0a 0a 0a 0a (uint16) = n1, n3, n7, n78 at 10 MHz
  [`${MAV}uwb_nr_band_bw`]: e("5G UW bands", "NR bands that may show the 5G UW / 5G+ icon: uint16 count, 4 uint16 bands, 4 uint16 minimum bandwidths (MHz)", "bytes", "med", `${FW}; ${CORPUS}`),
  // qdsp6sw.mbn rodata: follows /policyman/band_combos_per_plmn.xml and its CARRIER_LIST / PLMN-ID tags
  [`${MAV}lte_ca_xml_generation`]: e("LTE CA combos per PLMN", "Prune the advertised LTE CA combos per PLMN from /policyman/band_combos_per_plmn.xml", "bool", "med", FW, { values: OFF_ON }),
  [`${MAV}endc_ca_file_generation`]: e("EN-DC combos per PLMN", "Same per-PLMN capability pruning for EN-DC combos (next to cap_prune, skip_cap_prune)", "bool", "med", FW, { values: OFF_ON }),
  [`${MAV}5g_allowed_ndds`]: e("5G on non-DDS SIM", "Allow 5G on the SIM that is not the default data subscription", "bool", "med", FW, { values: OFF_ON }),
  // qdsp6sw.mbn rodata: "mav_pri: write efs file: %90s return %3d, errno %3d" precedes both revision paths
  "/mav/product_pri_setting_revision": e("Product PRI revision", "Revision of the product PRI settings the modem last wrote to EFS", "version", "med", `${FW}; bbcfg.mbn`, { format: bytesVersion }),
  "/mav/product_pri_setting_efidiag_revision": e("Product PRI EFI-diag revision", "Revision of the EFI-diag part of the product PRI settings", "version", "med", `${FW}; bbcfg.mbn`, { format: bytesVersion }),
  // qdsp6sw.mbn rodata: mav_uim_card_prov_strategy_{proprietary,msisdn_based,3gpp_follower}.c
  "/nv/item_files/modem/maverick/uim/apps/card_prov_strategy": e("SIM provisioning strategy", "How the modem provisions the SIM: proprietary, MSISDN-based or 3GPP follower; value order unconfirmed", "enum", "med", `${FW}; ${CORPUS}`),
  // qdsp6sw.mbn rodata: mav_uim_sub_slot_mapping.c
  "/nv/item_files/modem/maverick/uim/apps/sub_slot_mapping_override": e("Subscription-slot mapping override", "Overrides which SIM slot backs each subscription", "bytes", "med", FW),
  // corpus: 12-byte records {MCC u16, MNC u16, NR-ARFCN u32, band u16, flag u16}, e.g. 460-15 504990 n41
  // qdsp6sw.mbn rodata: next to dyn_sa_oos_timer_val, dyn_cap_hysis_timer_val, dyn_cap_lte_rsrp_thre
  [`${MAV}enable_dyn_sa`]: e("Dynamic SA", "Turn 5G SA capability on and off with coverage (dyn_sa_* / dyn_cap_* timers and thresholds)", "bool", "med", FW, { values: OFF_ON }),
  [`${MAV}enable_dyn_vonr`]: e("Dynamic VoNR", "Turn VoNR on and off dynamically, alongside dynamic SA", "bool", "med", FW, { values: OFF_ON }),
  // qdsp6sw.mbn rodata: listed with disable_mmw_for_third_party_video
  [`${MAV}disable_mmw_for_ftv`]: e("No mmWave for FaceTime video", "Drop mmWave (FR2) during FaceTime video calls", "bool", "med", FW, { values: OFF_ON }),
  [`${MAV}drop_endc_call_hysteresis_tmr_val`]: e("Drop EN-DC in call hysteresis", "Hysteresis timer before dropping EN-DC during a call", "uint32", "med", FW),
  [`${MAV}drop_endc_call_hysteresis_tmr_volte_val`]: e("Drop EN-DC in VoLTE hysteresis", "Hysteresis timer before dropping EN-DC during a VoLTE call", "uint32", "med", FW),
  // qdsp6sw.mbn rodata: listed with bwp_switch_tmr_val_sl and sa_depri_sl_bw_val
  [`${MAV}enable_bwp_switching_screen_lock`]: e("BWP switch on screen lock", "Move to a narrower NR bandwidth part while the screen is locked", "bool", "med", FW, { values: OFF_ON }),
  [`${MAV}prune_fr1_fr2_due_to_volte_enable`]: e("Prune NR while VoLTE", "Prune NR FR1 / FR2 capability while VoLTE is enabled", "bool", "med", FW, { values: OFF_ON }),
  // qdsp6sw.mbn rodata: QMI "sdm_uai_rel_pref_req", "sdm_r16_uai_rel_pref_metric_info"
  [`${MAV}rel_pref_config`]: e("UAI release preference", "Rel-16 UE Assistance Information releasePreference settings", "bytes", "med", FW),
  // qdsp6sw.mbn rodata: beside mav_avoid_attach_diff_geo_mcc and "mav_qmi_nas_update_geo_mcc_to_gfnh_database"
  [`${MAV}mav_diff_geo_mcc_enable_list`]: e("Different-geo-MCC MCCs", "MCCs where attach is avoided when the geolocated MCC differs from the network's", "bytes", "med", FW),
  [`${MAV}mav_diff_geo_mcc_exception_list`]: e("Different-geo-MCC exceptions", "MCCs exempt from the different-geo-MCC attach check", "bytes", "med", FW),
  // qdsp6sw.mbn CLADE2: beside /nv/item_files/conf/thin_ui_config.conf, then mmoc.c
  "/nv/item_files/Thin_UI/enable_thin_ui_cfg": e("Thin UI config", "Enable the Thin UI (headless) configuration read by MMOC", "bool", "low", CLADE, { values: OFF_ON }),
  // qdsp6sw.mbn CLADE2: listed with cmcall/jcdma_call_throttle_*
  "/mmode/cmcall/cdma_voice_call_collision": e("CDMA voice call collision", "Call-manager handling of colliding CDMA voice calls", "bytes", "low", CLADE),
  [`${NAS}mav_nr_predef_narfcn`]: e("Predefined NR ARFCNs", "NR channels to try first per PLMN: uint16 count, then {MCC, MNC, NR-ARFCN, band, flag} records", "bytes", "med", `${FW}; ${CORPUS}`),
};

interface Family extends Entry { family: string; test: RegExp }

const f = (family: string, test: RegExp, entry: Entry): Family => ({ ...entry, family, test });

export const NV_FAMILIES: Family[] = [
  f("lte_fgi", /\/lte_fgi_r(8|9|10)(_tdd)?$/, e("LTE Feature Group Indicators", "3GPP TS 36.331 Annex B featureGroupIndicators sent in UE-EUTRA-Capability", "bitmask", "med", "3GPP TS 36.331")),
  f("3gpp_release", /(3gpp_release_ver|3gpp_rel_version|lte_spec_feature_r11(_tdd)?)$/, e("3GPP release", "Signalled 3GPP release", "int", "med", "name + 3GPP")),
  f("nr_band_combos", /\/nr5g\/RRC\/cap_control_(nrca|nrdc|mrdc)_/, e("NR band-combo class control", "Enables an NR-CA / NR-DC / MR-DC band-combination class in the UE capability", "int", "med", "cacombos.com")),
  f("ca_combos", /\/(lte\/rrc\/cap\/(white|black)list_|nr5g\/rrc\/(endc|nrsa)_)/, e("CA combo list", "LTE CA / EN-DC band-combination allow/deny list", "bytes", "med", "cacombos.com")),
  f("nr_cap", /\/nr5g\/RRC\/cap_/, e("NR UE capability", "NR RRC UE-capability toggle", "int", "med", "name only")),
  f("plmn_list", /\/nas\/(ehplmn|iplmn|iPLMN|pri_fplmn|mav_epplmn)/i, e("PLMN list", "Packed BCD MCC/MNC list (TS 31.102)", "bytes", "med", `${EFST}; 3GPP TS 31.102`)),
  f("mav_override", /__mav_override$/, e("Apple override", "Apple override of the Qualcomm item of the same name", "int", "low", CORPUS)),
  f("satellite", /\/nas\/(mav_pssi_reg_gfnh_|mav_gfnh_)/, e("Satellite PLMN rule", "Apple satellite (GFNH) PLMN / geofence rule", "bytes", "low", CORPUS)),
  // qdsp6sw.mbn rodata: mav_pssi_reg.c, mav_pssi_reg_unblock_hplmn.c, mav_pssi_sd.c
  f("pssi", /\/nas\/mav_pssi_/, e("PSSI registration rule", "Apple PLMN search / system-selection (PSSI) registration tuning", "int", "med", FW)),
  // qdsp6sw.mbn rodata: mav_pssi_prio_sub_band_list.c, mav_pssi_facade_band_prio.c
  f("band_per_plmn", /\/nas\/mav_(gw|lte|sa_lte|nr)_(prio_sub_)?band_per_plmn$/, e("Band priority per PLMN", "Per-PLMN band / sub-band (ARFCN range) scan priority", "bytes", "med", FW)),
  // bbcfg.mbn: each blob's 9f64 digest, written to this path with the blob
  f("bbcfg_hash", /^\/mav\/bbcfg_file_hash_/, e("Baseband defaults digest", "Digest of the bbcfg.mbn blob these defaults came from, kept in EFS so the modem knows which set it holds", "bytes", "med", "bbcfg.mbn: blob tag 9f64")),
  // qdsp6sw.mbn rodata: AWD metric "DynamicRatSelection" with ul/dl_tput_before/after_switch
  f("drs", /\/mav\/drs_/, e("Dynamic RAT selection", "Apple Dynamic RAT Selection (DRS): picks LTE, NSA or SA from measured throughput", "int", "med", FW)),
  // qdsp6sw.mbn rodata: AWD metric "DataStallMitigation", QMI "sdm_ds_mit_*" messages
  f("ds_mit", /\/mav\/.*ds_(mit|partial_mit)/, e("Data-stall mitigation", "Detects stalled data sessions and backs off NR / SA to recover", "int", "med", FW)),
  // qdsp6sw.mbn rodata: mav_rlgs_plus.c, mav_rlgs_lte_ul.c; levels DlRlgsNO/Low/Med/High
  f("rlgs", /\/mav\/.*rlgs/, e("RLGS congestion", "Radio-link congestion scoring (none / low / med / high, DL and UL)", "int", "med", FW)),
  // qdsp6sw.mbn rodata: mav_sdm_host.c, QMI "sdm_*" messages (SA rat cap, BWP switch, icon override)
  f("sdm", /\/mav\/(sdm_|disable_sdm|sa_depri|disable_sa_deprio|enable_sa_depri)/, e("Smart data mode", "Apple SDM: turns NR / SA off or deprioritises SA when it does not pay off", "int", "med", FW)),
  // qdsp6sw.mbn rodata: mav_monitor_task, mav_monitor_nr5g_5GA_override.c
  f("rat_icon", /\/mav\/(mav_monitor_|.*icon|.*uwb)/, e("5G icon rule", "Status-bar 5G / 5G UW / 5G UC / 5G+ icon override logic", "int", "med", FW)),
  // qdsp6sw.mbn rodata: mav_hst_volte_cell_switch.c; NR5G_ML1_HST_* states
  f("hst", /\/mav\/hst_/, e("High-speed train", "High-speed-train detection and VoLTE cell-switch handling", "int", "med", FW)),
  // qdsp6sw.mbn rodata: mav_asm.c follows the mav_asm_* paths
  f("asm", /\/mav\/mav_asm_/, e("ASM congestion", "Apple uplink-congestion and app-response credit tuning", "int", "med", FW)),
  // qdsp6sw.mbn rodata: mav_wireless_qoe.c
  f("qoe", /\/mav\/.*qoe/, e("Wireless QoE", "Throughput-estimate / QoE scoring", "int", "med", FW)),
  // qdsp6sw.mbn rodata: mav_cpms_core.c, mav_cpms_peak_power_pi_controller.c, mav_cpms_qmi_ts_client.c
  f("cpms", /^\/mav\/cpms_/, e("CPMS power control", "Modem peak-power / thermal controller", "int", "med", FW)),
  f("mav_test", /\/maverick\/test\//, e("Apple test item", "Modem EFS test item (fixed pattern)", "bytes", "med", "path")),
  f("mav", /(^\/mav\/|\/mav\/|\/maverick\/|\/mav_[^/]*$)/, e("Apple modem option", "Apple-only (Maverick) modem option; undocumented", "int", "low", CORPUS)),
  f("policyman_xml", /^\/policyman\/.*\.xml$/, e("PolicyMan policy", "PolicyMan XML rules (RAT capability, bands, 5G/SA gating)", "xml", "med", "tech.ssut.me")),
  f("policyman", /^\/(mdb\/)?policyman\//, e("PolicyMan data", "PolicyMan database / flag", "bytes", "low", "name only")),
  f("ims", /\/ims\//, e("IMS setting", "IMS", "int", "low", "path")),
  f("nas", /\/modem\/nas\//, e("NAS setting", "NAS mobility management / PLMN selection", "int", "low", "path")),
  f("mmode", /\/modem\/mmode\//, e("Multimode setting", "Call manager / system determination", "int", "low", "path")),
  f("lte", /\/modem\/lte\//, e("LTE setting", "LTE RRC / L1 / L2", "int", "low", "path")),
  f("nr5g", /\/modem\/nr5g\//, e("NR5G setting", "NR5G RRC / L1", "int", "low", "path")),
  f("wcdma", /\/wcdma\//, e("WCDMA setting", "WCDMA RRC", "int", "low", "path")),
  f("geran", /\/geran\//, e("GERAN setting", "GSM/GPRS radio resource", "int", "low", "path")),
  f("uim", /\/uim\//, e("SIM setting", "UIM / SIM manager / SIM Toolkit", "int", "low", "path")),
  f("data", /(\/modem\/data\/|^\/data\/|^\/ds\/|\/item_files\/data\/)/, e("Data services setting", "Data services (PDN, throttling, AT commands)", "int", "low", "path")),
  f("gps", /\/c?gps\//, e("GNSS setting", "GNSS / location", "int", "low", "path")),
  // qdsp6sw.mbn CLADE2: LMTSMGR_PWR_EST, VPH_PWR and /therm/mitigate/* next to these paths
  f("lmtsmgr", /\/mcs\/lmtsmgr\//, e("Limits manager", "Tx power limits for battery voltage, SAR, coexistence and power estimation", "bytes", "med", CLADE)),
  // qdsp6sw.mbn CLADE2: "PA Thermal CFCM", cfcm_ddr_bw_cfg, /therm/mitigate/modem_tj
  f("cfcm", /\/mcs\/cfcm\//, e("CFCM flow control", "Central flow control for thermal, CPU and DDR-bandwidth mitigation", "bytes", "med", CLADE)),
  f("trm", /\/mcs\/trm\//, e("TRM setting", "RF chain arbitration and antenna switch diversity", "bytes", "low", "path")),
  f("tcxomgr", /\/mcs\/tcxomgr\//, e("XO manager setting", "Crystal oscillator (TCXO / XO) calibration and type", "bytes", "low", "path")),
  f("mcfg", /\/mcfg\//, e("MCFG setting", "Modem configuration (MBN) selection and refresh", "int", "low", "path")),
  f("hdr", /\/modem\/hdr\//, e("EV-DO setting", "CDMA EV-DO (HDR) MAC / search", "int", "low", "path")),
];

// mbn_utils nv_complete.txt (XDA "Complete List of NV Items", Dec 2012): every item a corpus 9fa708 list names, and every
// item a Pixel 1-5a MCFG sets.
const NV_NAMES: Record<number, string> = {
  5: "Slot Cycle Index", 6: "Mobile CAI Revision Number", 10: "Digital/Analog Mode Preference",
  20: "Primary CDMA Channel", 21: "Secondary CDMA Channel", 34: "CDMA Mobile Terminated Home SID Registration Flag",
  35: "CDMA Mobile Terminated Foreign SID Registration Flag",
  36: "CDMA Mobile Terminated Foreign NID Registration Flag", 42: "Automatic NAM Selection", 43: "NAM Name",
  67: "Continuous Keypad DTMF", 71: "Banner", 74: "Auto Answer Setting", 75: "Auto Redial Setting", 81: "Phone Locked",
  176: "IMSI MCC", 177: "IMSI 11 12", 179: "Voice Privacy", 219: "One Time Keypad Subsidy Lock",
  227: "Language Selection", 240: "QNC Enabled Flag", 241: "Data Service Option Set", 255: "CDMA SID NID Lockout",
  256: "Roaming List Enabled", 258: "System Preference Per NAM", 259: "Home SID/NID List", 260: "OTAPA Enabled",
  261: "SPASM Protection Per NAM", 265: "True IMSI - 11 12 Digits", 285: "EVRC Voice Service Options",
  291: "Silent Redial Enabled", 296: "OTASP SPC Change", 297: "Data MDR Mode",
  298: "Packet Data Calls Originate String", 300: "Packet Data Configuration", 304: "OTKSL Flag",
  374: "Broadcast SMS Configuration", 375: "Broadcast SMS User Preferences", 400: "GPSOne Capabilities",
  401: "GPSOne PDE TCP Address", 405: "IS2000 CAI Radio Configuration RC Preference", 409: "TTY Enabled/Disabled",
  423: "Primary DNS Server", 424: "Secondary DNS Server", 426: "GPSOne PDE Port", 429: "Data SCRM Enabled",
  441: "Band Class Preference", 442: "Roaming Preference", 450: "Data Throttle Enabled", 452: "GPSOne Lock",
  453: "Factory Testmode Phone Mode", 459: "Data Services QC Mobile IP",
  460: "Data Services Mobile IP Registration Retries",
  461: "Data Services Mobile IP Registration Retries Initial Interval",
  462: "Data Services Mobile IP Registration Expiration Attempt Reregistration",
  463: "Data Services Mobile IP Number Profiles", 464: "Data Services Mobile IP Currently Active Profiles",
  466: "Data Services Mobile IP Shared Secret User Profile", 475: "HDR SCP Session Status",
  494: "Data Services Mobile IP MN Home Agent Timebase Difference",
  495: "Data Services Mobile IP Qualcomm PREV 6 MIP Handoff Optimization Enabled",
  546: "Data Services Mobile IP RFC2002bis MN Home Agent Authenticator Calculation",
  553: "GSM A5 Algorithms Supported", 562: "Preferred Hybrid Mode",
  579: "xEV(HDR) Access Network CHAP Authentication NAI", 707: "Data Services Mobile IP RRQ IF Traffic",
  714: "Data Services Mobile IP Enable Profile", 818: "HDR RX Diversity Control",
  830: "GSM/WCDMA SMS Routing Configuration", 848: "Acquisition Order Preference",
  849: "Network Selection Mode Preference", 850: "Service Domain Preference", 852: "APN Name",
  854: "Data Services Mobile IP DMU PKO ID", 855: "RTRE Configuration", 880: "RRC Integrity Enabled",
  881: "RRC Ciphering Enabled", 882: "RRC Fake Security Enabled", 889: "Data Services Mobile IP DMU MN Authentication",
  896: "UIM First Instruction Class", 899: "JCDMA M512 Mode Setting", 905: "Fatal Error Option",
  906: "IP PPP Password", 909: "GSM/UMTS SMS Bearer Preference", 910: "PPP User ID", 911: "GPRS Multi Slot Class",
  912: "GPRS Non DRX Timer", 928: "PZID Hysterisis Activation Timer", 929: "PZID Hysterisis Timer",
  930: "Packet Call Dial String Lookup Table", 946: "Expand Band Preference 16 To 32 Bits",
  947: "GPRS Enable Anite GCF 51.010", 1014: "GSM/UMTS Cell Broadcast SMS Service Table",
  1015: "GSM/UMTS Cell Broadcast SMS Service Table Size", 1016: "GSM/UMTS Cell Broadcast SMS Carrier Configuration",
  1017: "GSM/UMTS Cell Broadcast SMS User Preference", 1018: "CDMA Receive Diversity Control",
  1030: "Force UE SGSNR GSM R99 Version", 1031: "Force UE MSCR GSM R99 Version",
  1192: "HDR Access Network Stream CHAP Authentication Password", 1193: "Data Services Mobile IP QC Handdown",
  1206: "PPP Configuration Options", 1302: "GSM AMR Call Configuration", 1892: "Diag Debug Control",
  1895: "Diag Debug Detail", 1896: "Ipv6 Enabled", 1897: "IPV6 State Machine Configuration",
  1907: "Authentication Require Password Encryption", 1918: "AAGPS Default QoS Time",
  1920: "AAGPS Positioning Modes Supported", 1930: "AAGPS Emergency Services Support",
  1934: "AAGPS Protocol Selection", 1940: "AAGPS MT LR Support", 1960: "AAGPS 3G MO LR Support",
  1962: "Trace Files Saved EFS", 1993: "GPSOne Vx LCS Agent", 1994: "GPSOne Vx Application Trusted Settings",
  1995: "GPSOne Vx Dedicated SMS Teleservice Identifier", 1997: "GPSOne Vx MO Max Duration",
  2508: "EDGE Feature Support", 2509: "EDGE Multislot Class", 2510: "EDGE 8PSK Power Class",
  2511: "EDGE 8PSK Power Capability", 2512: "GERAN Feature Pack 1", 2788: "AAGPS Default Presupl Ue Timer2 Value",
  2789: "AAGPS Default Presupl Ue Timer3 Value", 2822: "USB Charging NV Disable Value", 2826: "SMS BMC Reading Pref",
  2954: "Bits 32 To 63 Of Band Pref", 3006: "MS SMS Max Number Of SMS", 3358: "GPSOne Enable MS-B Throttling",
  3446: "TRM Configuration", 3458: "HDR SCP Subtype Custom Config", 3461: "ENS Enabled",
  3520: "GPSOne Seed Position Option", 3532: "SMS MO Retry Period", 3533: "SMS MO Retry Interval",
  3628: "DTM Feature Support", 3629: "DTM Multislot Class", 3630: "EDA Feature Support", 3632: "Search Debug Mask",
  3634: "DDTM Settings", 3635: "SD Configurable Items", 3649: "WCDMA RRC Version",
  3758: "AAGPS Use Transport Security", 3851: "WCDMA RX Diversity Control", 3852: "WCDMA Equalizer Control",
  4101: "Roam Indicator Custom Home", 4102: "CDMA SO68 Enabled", 4116: "Interrat NACC Support",
  4117: "DARP Feature Support", 4118: "HSDPA Category", 4173: "WCDMA RRC PDCP Disabled", 4185: "HDR Minimum UATI Mode",
  4192: "CDMA SO70 Enabled", 4201: "Application Power Disable", 4204: "HDR SCP Force Release 0 Session Configuration",
  4209: "EDTM Feature Support", 4210: "WCDMA HSUPA Category", 4227: "SMS Max Payload Length",
  4228: "SMS MO On Access Channel", 4229: "SMS MP On Traffic Channel", 4230: "VOIP Preferred URI",
  4231: "HDR L1 Debug Mask", 4261: "CPU Based Flow Control", 4265: "VOIP Registration Mode",
  4366: "SMS Service Option", 4396: "DS Mobile IP Deregistration Retries", 4398: "UIM Select Default USIM Application",
  4399: "Detect HW Reset", 4432: "GPRS GEA Algorithms Supported", 4526: "High Speed USB Current Composition",
  4528: "HDR EMPA Supported", 4543: "VOIP Precondition Enable", 4627: "GPSOne XTRA Enabled",
  4628: "GPSOne XTRA Download Interval", 4629: "GPSOne XTRA Number Of Download Attempts",
  4630: "GPSOne XTRA Time Between Attempts", 4631: "GPSOne XTRA Auto Download Enabled",
  4632: "GPSOne XTRA Primary Server URL", 4633: "GPSOne XTRA Secondary Server URL",
  4634: "GPSOne XTRA Tertiary Server URL", 4676: "DS707 Go NULL Timer 1X", 4677: "DS707 Go NULL Timer DO",
  4695: "CGPS 1X PDE Server Address IPV4", 4698: "CGPS 1X MPC Server Address IPV4",
  4703: "CGPS UMTS PDE Server Address URL", 4704: "CGPS 1X PDE Server Port", 4705: "CGPS 1X MPC Server Port",
  4707: "CGPS MO Method", 4716: "CGPS ME Reserved 2", 4722: "NAS Release Compliance", 4922: "JCDMA RUIM ID",
  4927: "GPSOne XTRA Time Info Enabled", 4930: "GPSOne XTRA Primary SNTP Server URL",
  4931: "GPSOne XTRA Secondary SNTP Server URL", 4932: "GPSOne XTRA Tertiary SNTP Server URL",
  4959: "User SID To MCC Assoc Table", 4960: "HS Based Plus Dial Setting", 4964: "HDR SCP Force AT Configuration",
  5047: "CGPS NMEA Configuration Information", 5090: "WCDMA HSUPA CM Controller", 5107: "Repeated ACCH",
  5153: "UE IMEI Software Version Number", 5280: "Disable CM Call Type", 5379: "PS Handover Feature Support",
  5593: "Toolkit Envelope Retry Flag", 5770: "Toolkit CS PS Parallel", 5773: "DSAT707 CTA Timer",
  5895: "MGRF Supported", 6247: "PPP VSNCP Config Data", 6248: "eHRPD Enabled", 6253: "CSIM Support",
  6264: "CGPS Minimum GPS Week Number", 6273: "GPS Default Operating Mode", 6274: "GPS Default TBF",
  6760: "GNSS GLO Control", 6789: "GNSS NMEA Sentence Type (Obsolete)",
  6790: "GNSS NMEA Extended Sentence Type (Obsolete)", 6792: "GNSS SUPL Version", 6816: "GNSS MGP Error Recovery",
  6830: "CS TO VOIP Fallback Timer", 6831: "VOIP Cancel Retry Timer", 6832: "HDRSCP Force Restricted CF",
  6844: "ENHANCED HPLMN SRCH TBL", 6850: "UMTS AMR Codec Preference Config", 6862: "eHRPD Authentication Mode",
  6876: "Dual Standby Config Items", 6878: "WCDMA CS Voice Over HSPA Enabled", 7145: "LU Reject Auto Enabled",
  7147: "Data Call Over Ehrpd Only", 7162: "DDTM ALLOW SO PAGES", 7165: "GNSS OEM Feature Mask",
  7166: "CDMA SO73 Enabled",
};

/** Items with more than a name. Apple-private 5xxxx/62xxx numbers are absent from every public list. */
const NV_DETAIL: Record<number, Partial<Entry>> = {
  // plaintext .pri "Preferred Mode = GWL" decodes as 31 here
  10: { name: "Mode preference", type: "enum", confidence: "high", source: `${XQCN}; ${PLAIN}; ${LIBQCDM}`, values: {
    0: "CDMA then analog", 1: "Digital only", 4: "Automatic", 5: "Emergency", 6: "Home only", 9: "CDMA only", 10: "HDR only",
    13: "GSM only", 14: "WCDMA only", 17: "GSM + WCDMA", 19: "CDMA + HDR", 30: "LTE only", 31: "GWL", 34: "GSM + LTE",
    35: "WCDMA + LTE", 36: "CDMA + HDR + LTE", 53: "TD-SCDMA only", 58: "TD-SCDMA + GSM + WCDMA + LTE",
    62: "CDMA + GSM + WCDMA + LTE", 71: "NR5G only",
  } },
  // Every Pixel config that sets it holds a CRC-valid PRL behind a header whose ID and size match the PRL's.
  257: { name: "Preferred roaming list", type: "bytes", confidence: "high", source: PIXEL, meaning: "CDMA PRL (3GPP2 C.S0016)", decode: prlLabel },
  442: { name: "Roaming preference", type: "enum", confidence: "high", source: LIBQCDM, values: { 1: "Home only", 6: "Roaming only", 255: "Automatic" } },
  562: { name: "Hybrid preference", meaning: "Hybrid CDMA 1x + HDR operation", type: "bool", confidence: "high", source: LIBQCDM, values: OFF_ON },
  // libqcdm marks the item's meaning "(?)".
  4964: { name: "HDR revision preference", type: "enum", confidence: "low", source: LIBQCDM, values: { 0: "Rev 0", 1: "Rev A", 4: "eHRPD" } },
  // plaintext .pri "WCDMA Band Class Pref b16-b31 = 48895" decodes as 48895 here
  946: { name: "Band preference bits 16-31", type: "bitmask", confidence: "high", source: `${XQCN}; ${PLAIN}`, bits: {
    0: "GSM 450", 1: "GSM 480", 2: "GSM 750", 3: "GSM 850", 4: "GSM railways 900", 5: "GSM PCS 1900",
    6: "WCDMA B1 2100", 7: "WCDMA B2 1900", 8: "WCDMA B3 1800", 9: "WCDMA B4 1700", 10: "WCDMA B5 850", 11: "WCDMA B6 800",
  } },
  2954: { type: "bitmask", confidence: "med", source: XQCN, bits: { 16: "WCDMA B7 2600", 17: "WCDMA B8 900", 18: "WCDMA B9 1700", 28: "WCDMA B19 850", 29: "WCDMA B11 1500" } },
  850: { name: "Service domain preference", type: "enum", confidence: "med", source: XQCN, values: { 0: "CS only", 1: "PS only", 2: "CS + PS", 3: "Any" } },
  947: { name: "Anite GCF", type: "bool", confidence: "high", source: `${XQCN}; ${PLAIN}`, values: OFF_ON },
  1896: { name: "IPv6 enabled", type: "bool", confidence: "high", source: `${XQCN}; ${PLAIN}`, values: OFF_ON },
  3758: { type: "bool", confidence: "med", source: XQCN, meaning: "Enable user-plane (SUPL) secure transport", values: OFF_ON },
  3461: { type: "bool", confidence: "med", meaning: "Enhanced Network Selection", values: OFF_ON },
  // plaintext .pri "SRLTE TRM RF Configuration = 2"
  3446: { type: "uint8", confidence: "med", meaning: "SRLTE transceiver resource manager configuration" },
  4703: { type: "string", confidence: "high", source: `${XQCN}; ${CORPUS}`, meaning: "SUPL H-SLP server host:port" },
  6792: { type: "version", confidence: "med", source: XQCN, format: (n) => `${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}` },
  4118: { type: "uint8", confidence: "med", meaning: "3GPP HSDPA UE category" },
  4210: { type: "uint8", confidence: "med", meaning: "3GPP HSUPA UE category" },
  // corpus: 62005 == "PRI Revision" header in every iOS 27.0 file (0x00a10100 = 0.1.161)
  62005: { name: "PRI revision", type: "version", confidence: "high", source: CORPUS, meaning: "Packed PRI Revision header", format: bytesVersion },
  // corpus: 62033 == "GRI Revision" header (0x0009000e = 14.0.9)
  62033: { name: "GRI revision", type: "version", confidence: "high", source: CORPUS, meaning: "Packed GRI Revision header", format: bytesVersion },
  // plaintext .pri "WCDMA Delay Rau During CSFB = False" is the only plaintext key left unmatched; by elimination
  62025: { name: "Delay RAU during CSFB (probable)", type: "bool", confidence: "low", source: PLAIN, values: OFF_ON },
  // earlier decoder notes: an ASCII pattern blob; absent from the iOS 27.0 corpus
  62002: { type: "string", confidence: "low", source: "earlier decodes" },
  62023: { type: "uint8", confidence: "low", source: CORPUS },
  62026: { type: "bytes", confidence: "low", source: CORPUS, meaning: "14-byte struct" },
  58021: { type: "uint8", confidence: "low", source: CORPUS },
};

/** Bytes in a Carrier Configuration Management group: one 0/1 flag each. */
export const CCM_FLAG_BYTES = 25;

interface CcmGroup { readonly name: string; readonly confidence: Confidence }

// Carrier Configuration Management groups: plaintext .pri "Carrier Configuration Management" dict; 62035 is the one no dict names.
export const CCM_ITEMS: Readonly<Record<number, CcmGroup>> = {
  62009: { name: "CDMA 1X Feature Group", confidence: "high" },
  62010: { name: "EVDO Feature Group", confidence: "high" },
  62011: { name: "System Determination Feature Group", confidence: "high" },
  62012: { name: "Call Manager Feature Group", confidence: "high" },
  62013: { name: "Wireless Messaging Feature Group", confidence: "high" },
  62014: { name: "Data Service Feature Group", confidence: "high" },
  62015: { name: "UIM Service Feature Group", confidence: "high" },
  62018: { name: "OMA Feature Group", confidence: "high" },
  62035: { name: "Feature Group (unnamed, tag 9f83e453)", confidence: "low" },
};

function legacy(item: number): NvInfo | undefined {
  const d = NV_DETAIL[item];
  const base = NV_NAMES[item];
  const ccm = CCM_ITEMS[item];
  if (!d && !base && !ccm) return undefined;
  const name = d?.name ?? ccm?.name ?? base ?? `NV ${item}`;
  return {
    key: `NV ${item}`,
    item,
    name,
    meaning: d?.meaning ?? (ccm ? `${CCM_FLAG_BYTES} independent 0/1 feature flags` : base ?? name),
    type: d?.type ?? (ccm ? "bytes" : "int"),
    ...(d?.values ? { values: d.values } : {}),
    ...(d?.bits ? { bits: d.bits } : {}),
    confidence: d?.confidence ?? ccm?.confidence ?? "med",
    source: d?.source ?? (ccm ? PLAIN : MBNU),
  };
}

const strip = ({ format: _f, decode: _d, test: _t, family: _fam, ...rest }: Entry & { test?: RegExp; family?: string }) => rest;
const base = (p: string) => p.split("/").pop() || p;

/** Look up an EFS path (exact, then by family) or a legacy NV item number. */
export function describeNv(pathOrItem: string | number): NvInfo | undefined {
  if (typeof pathOrItem === "number" || /^(NV\s*)?\d+$/i.test(pathOrItem)) {
    return legacy(typeof pathOrItem === "number" ? pathOrItem : Number(pathOrItem.replace(/\D/g, "")));
  }
  const exact = NV_PATHS[pathOrItem];
  if (exact) return { key: pathOrItem, ...strip(exact) };
  const fam = NV_FAMILIES.find((x) => x.test.test(pathOrItem));
  if (!fam) return undefined;
  const leaf = base(pathOrItem);
  return { key: pathOrItem, ...strip(fam), name: leaf, meaning: `${fam.name}: ${fam.meaning}`, family: fam.family };
}

function formatter(pathOrItem: string | number): Entry["format"] {
  if (typeof pathOrItem === "number") return NV_DETAIL[pathOrItem]?.format;
  return NV_PATHS[pathOrItem]?.format;
}

export interface NvAnnotation {
  name: string;
  /** Omitted when it would only repeat the name. */
  meaning?: string;
  /** What the scalar value means (enum name, set bits, version), when known. */
  label?: string;
  confidence: Confidence;
}

/** What an NV item or EFS path is and, given its value, what that value means. */
export function annotateNv(key: string | number, n?: number, bytes?: Uint8Array): NvAnnotation | undefined {
  const d = describeNv(key);
  if (!d) return undefined;
  const decode = typeof key === "number" ? NV_DETAIL[key]?.decode : NV_PATHS[key]?.decode;
  const structured = bytes && decode?.(bytes);
  const label = structured ?? (n !== undefined ? decodeNvValue(key, n) : undefined);
  return {
    name: d.name,
    ...(d.meaning !== d.name && { meaning: d.meaning }),
    ...(label !== undefined && { label }),
    confidence: d.confidence,
  };
}

/** Label a scalar value: enum name, set-bit names, or a formatted version. Undefined when unknown. */
export function decodeNvValue(pathOrItem: string | number, n: number): string | undefined {
  const key = typeof pathOrItem === "string" && /^(NV\s*)?\d+$/i.test(pathOrItem) ? Number(pathOrItem.replace(/\D/g, "")) : pathOrItem;
  const info = describeNv(key);
  if (!info || !Number.isFinite(n)) return undefined;
  const fmt = formatter(key);
  if (fmt) return fmt(n);
  if (info.values && n in info.values) return info.values[n];
  if (info.bits) {
    const bits = info.bits;
    const set = maskBits(n).map((b) => bits[b] ?? `bit ${b}`);
    return set.length ? set.join(", ") : "none";
  }
  return undefined;
}
