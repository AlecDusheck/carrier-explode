/**
 * Lookup of the Qualcomm EFS paths and legacy NV item numbers that Apple baseband
 * override files (`*.der.pri` / `*.der.gri`) assign. Self-contained, no dependencies.
 *
 * `describeNv(pathOrItem)` resolves an exact path, then a path family, then a legacy
 * NV number. `decodeNvValue(pathOrItem, n)` turns a scalar into its enum/bit label.
 */

export type NvConfidence = "high" | "med" | "low";

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
  confidence: NvConfidence;
  /** Where the finding comes from. */
  source: string;
  /** Set when matched by a path family rather than the exact path. */
  family?: string;
}

type Entry = Omit<NvInfo, "key" | "item" | "family"> & { format?: (n: number) => string };

const e = (
  name: string, meaning: string, type: NvType, confidence: NvConfidence, source: string,
  extra: Partial<Entry> = {},
): Entry => ({ name, meaning, type, confidence, source, ...extra });

// Source keys used below.
const XQCN = "XQCN nv_efs_data_format.xml";
const EFST = "EfsTools Efs.cs";
const MBNU = "mbn_utils nv_complete.txt";
const PLAIN = "plaintext .pri in CW_pa / BhartiAirtel_in";
const CORPUS = "corpus: iOS 27.0 overrides";

const OFF_ON = { 0: "Off", 1: "On" };

/** `[major, minor, patch, 0]` little-endian, e.g. 0x00a10100 -> "0.1.161". */
const bytesVersion = (n: number) => `${n & 0xff}.${(n >>> 8) & 0xff}.${(n >>> 16) & 0xff}`;

/* ------------------------------------------------------------- exact paths */

const MMODE = "/nv/item_files/modem/mmode/";
const NAS = "/nv/item_files/modem/nas/";
const PS = "/nv/item_files/modem/data/3gpp/ps/";

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
  [`${NAS}hplmn_rat_order`]: e("HPLMN RAT order", "Home-PLMN RAT search order", "bytes", "low", "name only"),
  [`${NAS}isr`]: e("ISR", "Idle-mode Signalling Reduction (TS 23.401)", "bool", "med", "name + 3GPP", { values: OFF_ON }),
  [`${NAS}csg_support_configuration`]: e("CSG support", "Closed Subscriber Group (femtocell) support", "uint8", "med", EFST),
  [`${NAS}irat_search_timer`]: e("IRAT search timer", "Inter-RAT search timer", "uint32", "med", EFST),
  [`${NAS}max_validate_sim_counter`]: e("Max validate SIM counter", "SIM validation retry limit", "uint8", "med", EFST),
  [`${NAS}nas_lai_change_force_lau_for_emergency`]: e("Force LAU on LAI change (emergency)", "Force a location-area update on LAI change during an emergency call", "bool", "med", EFST, { values: OFF_ON }),
  [`${NAS}tdscdma_op_plmn_list`]: e("TD-SCDMA operator PLMN list", "Packed PLMN list", "bytes", "med", EFST),
  "/nv/item_files/jcdma/jcdma_mode": e("JCDMA mode", "Japan CDMA (KDDI) simplified feature set; plaintext key 'Enable JCDMA'", "bool", "high", PLAIN, { values: OFF_ON }),
  "/nv/item_files/modem/lte/rrc/efs/lte_feature_enable": e("LTE feature enable", "LTE RRC capability feature-enable bitmap; bit list unpublished", "bytes", "med", "cacombos.com"),
  "/nv/item_files/modem/lte/rrc/efs/lte_feature_disable": e("LTE feature disable", "LTE RRC capability feature-disable bitmap", "bytes", "med", "cacombos.com"),
  "/nv/item_files/modem/lte/rrc/efs/band_priority_list_v2": e("LTE band priority list", "Prioritised band list for LFS/FFS scans (uint16 array)", "bytes", "med", XQCN),
  "/nv/item_files/modem/lte/rrc/efs/eps_fallback_control": e("EPS fallback control", "VoNR to EPS fallback control", "bytes", "low", "name only"),
  "/nv/item_files/modem/lte/rrc/bbq/bbq_mitigation": e("BBQ mitigation", "LTE bad-band-quality mitigation", "bool", "low", "name only", { values: OFF_ON }),
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
};

/* ------------------------------------------------------------ path families */

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
  f("drs", /\/mav\/drs_/, e("Dynamic RAT selection", "Apple Smart Data mode (DRS) tuning", "int", "low", CORPUS)),
  f("mav", /(^\/mav\/|\/mav\/|\/maverick\/|\/mav_[^/]*$)/, e("Apple modem option", "Apple-only (Maverick) modem option; undocumented", "int", "low", CORPUS)),
  f("policyman_xml", /^\/policyman\/.*\.xml$/, e("PolicyMan policy", "PolicyMan XML rules (RAT capability, bands, 5G/SA gating)", "xml", "med", "tech.ssut.me")),
  f("policyman", /^\/(mdb\/)?policyman\//, e("PolicyMan data", "PolicyMan database / flag", "bytes", "low", "name only")),
  // corpus: iOS 27.0 overrides; "%u:" paths carry uint32 values, "%qu[N]:" NUL-padded N-byte strings
  f("cps_u", /^%u:dyn_/, e("Dynamic CPS field", "Apple dynamic CPS struct field (unsigned)", "uint32", "low", CORPUS)),
  f("cps_qu", /^%qu\[\d+\]:dyn_/, e("Dynamic CPS string", "Apple dynamic CPS struct field (N-byte quoted string)", "string", "low", CORPUS)),
  f("ims", /\/ims\//, e("IMS setting", "IMS", "int", "low", "path")),
  f("nas", /\/modem\/nas\//, e("NAS setting", "NAS mobility management / PLMN selection", "int", "low", "path")),
  f("mmode", /\/modem\/mmode\//, e("Multimode setting", "Call manager / system determination", "int", "low", "path")),
  f("lte", /\/modem\/lte\//, e("LTE setting", "LTE RRC / L1 / L2", "int", "low", "path")),
  f("nr5g", /\/modem\/nr5g\//, e("NR5G setting", "NR5G RRC / L1", "int", "low", "path")),
  f("wcdma", /\/wcdma\//, e("WCDMA setting", "WCDMA RRC", "int", "low", "path")),
  f("geran", /\/geran\//, e("GERAN setting", "GSM/GPRS radio resource", "int", "low", "path")),
  f("uim", /\/uim\//, e("SIM setting", "UIM / SIM manager / SIM Toolkit", "int", "low", "path")),
  f("data", /(\/modem\/data\/|^\/data\/|^\/ds\/|\/item_files\/data\/)/, e("Data services setting", "Data services (PDN, throttling, AT commands)", "int", "low", "path")),
  f("gps", /\/gps\//, e("GNSS setting", "GNSS / location", "int", "low", "path")),
];

/* ------------------------------------------------------- legacy NV numbers */

// mbn_utils nv_complete.txt (XDA "Complete List of NV Items", Dec 2012): every item a corpus 9fa708 list names.
const NV_NAMES: Record<number, string> = {
  5: "Slot Cycle Index", 6: "Mobile CAI Revision Number", 10: "Digital/Analog Mode Preference",
  20: "Primary CDMA Channel", 21: "Secondary CDMA Channel",
  34: "CDMA Mobile Terminated Home SID Registration Flag",
  35: "CDMA Mobile Terminated Foreign SID Registration Flag",
  36: "CDMA Mobile Terminated Foreign NID Registration Flag", 176: "IMSI MCC", 177: "IMSI 11 12",
  179: "Voice Privacy", 240: "QNC Enabled Flag", 241: "Data Service Option Set",
  255: "CDMA SID NID Lockout", 258: "System Preference Per NAM", 259: "Home SID/NID List",
  260: "OTAPA Enabled", 261: "SPASM Protection Per NAM", 285: "EVRC Voice Service Options",
  296: "OTASP SPC Change", 297: "Data MDR Mode", 298: "Packet Data Calls Originate String",
  300: "Packet Data Configuration", 304: "OTKSL Flag", 401: "GPSOne PDE TCP Address",
  405: "IS2000 CAI Radio Configuration RC Preference", 423: "Primary DNS Server",
  424: "Secondary DNS Server", 426: "GPSOne PDE Port", 429: "Data SCRM Enabled",
  441: "Band Class Preference", 442: "Roaming Preference", 450: "Data Throttle Enabled",
  459: "Data Services QC Mobile IP", 460: "Data Services Mobile IP Registration Retries",
  461: "Data Services Mobile IP Registration Retries Initial Interval",
  462: "Data Services Mobile IP Registration Expiration Attempt Reregistration",
  463: "Data Services Mobile IP Number Profiles",
  466: "Data Services Mobile IP Shared Secret User Profile", 475: "HDR SCP Session Status",
  495: "Data Services Mobile IP Qualcomm PREV 6 MIP Handoff Optimization Enabled",
  546: "Data Services Mobile IP RFC2002bis MN Home Agent Authenticator Calculation",
  553: "GSM A5 Algorithms Supported", 562: "Preferred Hybrid Mode",
  579: "xEV(HDR) Access Network CHAP Authentication NAI",
  707: "Data Services Mobile IP RRQ IF Traffic", 714: "Data Services Mobile IP Enable Profile",
  852: "APN Name", 854: "Data Services Mobile IP DMU PKO ID", 855: "RTRE Configuration",
  889: "Data Services Mobile IP DMU MN Authentication", 896: "UIM First Instruction Class",
  906: "IP PPP Password", 909: "GSM/UMTS SMS Bearer Preference",
  946: "Expand Band Preference 16 To 32 Bits", 947: "GPRS Enable Anite GCF 51.010",
  1192: "HDR Access Network Stream CHAP Authentication Password", 1896: "Ipv6 Enabled",
  1907: "Authentication Require Password Encryption", 1920: "AAGPS Positioning Modes Supported",
  2954: "Bits 32 To 63 Of Band Pref", 3446: "TRM Configuration", 3461: "ENS Enabled",
  3533: "SMS MO Retry Interval", 3635: "SD Configurable Items", 3649: "WCDMA RRC Version",
  3758: "AAGPS Use Transport Security", 4101: "Roam Indicator Custom Home",
  4102: "CDMA SO68 Enabled", 4118: "HSDPA Category", 4210: "WCDMA HSUPA Category",
  4229: "SMS MP On Traffic Channel", 4265: "VOIP Registration Mode", 4366: "SMS Service Option",
  4396: "DS Mobile IP Deregistration Retries", 4432: "GPRS GEA Algorithms Supported",
  4528: "HDR EMPA Supported", 4703: "CGPS UMTS PDE Server Address URL",
  4959: "User SID To MCC Assoc Table", 4960: "HS Based Plus Dial Setting",
  4964: "HDR SCP Force AT Configuration", 5280: "Disable CM Call Type", 5773: "DSAT707 CTA Timer",
  5895: "MGRF Supported", 6247: "PPP VSNCP Config Data", 6248: "eHRPD Enabled",
  6264: "CGPS Minimum GPS Week Number", 6792: "GNSS SUPL Version",
  6832: "HDRSCP Force Restricted CF", 6850: "UMTS AMR Codec Preference Config",
  6862: "eHRPD Authentication Mode", 7166: "CDMA SO73 Enabled",
};

/** Items with more than a name. Apple-private 5xxxx/62xxx numbers are absent from every public list. */
const NV_DETAIL: Record<number, Partial<Entry>> = {
  // plaintext .pri "Preferred Mode = GWL" decodes as 31 here
  10: { name: "Mode preference", type: "enum", confidence: "high", source: `${XQCN}; ${PLAIN}`, values: {
    0: "CDMA then analog", 1: "Digital only", 4: "Automatic", 9: "CDMA only", 10: "HDR only", 13: "GSM only",
    14: "WCDMA only", 17: "GSM + WCDMA", 30: "LTE only", 31: "GWL", 34: "GSM + LTE", 35: "WCDMA + LTE",
    53: "TD-SCDMA only", 58: "TD-SCDMA + GSM + WCDMA + LTE", 62: "CDMA + GSM + WCDMA + LTE", 71: "NR5G only",
  } },
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

// Carrier Configuration Management groups: plaintext .pri "Carrier Configuration Management" dict.
export const CCM_ITEMS: Record<number, string> = {
  62009: "CDMA 1X Feature Group", 62010: "EVDO Feature Group", 62011: "System Determination Feature Group",
  62012: "Call Manager Feature Group", 62013: "Wireless Messaging Feature Group", 62014: "Data Service Feature Group",
  62015: "UIM Service Feature Group", 62018: "OMA Feature Group", 62035: "Feature Group (unnamed, tag 9f83e453)",
};

function legacy(item: number): NvInfo | undefined {
  const d = NV_DETAIL[item];
  const base = NV_NAMES[item];
  const ccm = CCM_ITEMS[item];
  if (!d && !base && !ccm) return undefined;
  const name = d?.name ?? ccm ?? base ?? `NV ${item}`;
  return {
    key: `NV ${item}`,
    item,
    name,
    meaning: d?.meaning ?? (ccm ? "25 independent 0/1 feature flags" : base ?? name),
    type: d?.type ?? (ccm ? "bytes" : "int"),
    values: d?.values,
    bits: d?.bits,
    confidence: d?.confidence ?? (ccm ? (item === 62035 ? "low" : "high") : "med"),
    source: d?.source ?? (ccm ? PLAIN : MBNU),
  };
}

const strip = ({ format: _f, test: _t, family: _fam, ...rest }: Entry & { test?: RegExp; family?: string }) => rest;
const base = (p: string) => p.replace(/^%q?u(\[\d+\])?:/, "").split("/").pop() || p;

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

/** Label a scalar value: enum name, set-bit names, or a formatted version. Undefined when unknown. */
export function decodeNvValue(pathOrItem: string | number, n: number): string | undefined {
  const key = typeof pathOrItem === "string" && /^(NV\s*)?\d+$/i.test(pathOrItem) ? Number(pathOrItem.replace(/\D/g, "")) : pathOrItem;
  const info = describeNv(key);
  if (!info || !Number.isFinite(n)) return undefined;
  const fmt = formatter(key);
  if (fmt) return fmt(n);
  if (info.values && n in info.values) return info.values[n];
  if (info.bits) {
    const set: string[] = [];
    for (let b = 0; b < 53 && 2 ** b <= n; b++) {
      if (Math.floor(n / 2 ** b) % 2) set.push(info.bits[b] ?? `bit ${b}`);
    }
    return set.length ? set.join(", ") : "none";
  }
  return undefined;
}
