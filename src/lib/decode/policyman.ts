/**
 * What each policyman XML element means, from the modem image's rule-engine
 * tables and strings (qdsp6sw.mbn, Mav25-2.10.01). The handlers themselves are
 * compressed, so most meanings rest on the name, the table it sits in and how
 * the shipped XML uses it.
 */

import type { Confidence } from "./confidence";

export interface PolicyElementDoc {
  kind: "root" | "block" | "condition" | "action" | "value";
  /** One line: what the element does. */
  note: string;
  /** Attribute notes; common ones (name, list, subs, base, ns) come from POLICY_ATTRS. */
  attrs?: Record<string, string>;
  /** Accepted text values, when the firmware lists them. */
  values?: string[];
  confidence: Confidence;
}

type D = PolicyElementDoc;
const c = (note: string, confidence: Confidence = "med", more: Partial<D> = {}): D => ({ kind: "condition", note, confidence, ...more });
const a = (note: string, confidence: Confidence = "med", more: Partial<D> = {}): D => ({ kind: "action", note, confidence, ...more });
const v = (note: string, confidence: Confidence = "med", more: Partial<D> = {}): D => ({ kind: "value", note, confidence, ...more });

// qdsp6sw.mbn rodata: policyman subs/base/namespace strings (policyman_subs.c, mre_namedobj.c)
export const POLICY_ATTRS: Record<string, string> = {
  name: "Name of the object this defines or refers to.",
  list: "Named list to test against or apply (global:, post: and pm: prefixes are namespaces; pm: is built in).",
  subs: "Which subscription: this, other, any, dds (default data) or ndds.",
  base: "Starting set before include/exclude: none, hardware, current or config.",
  ns: "Namespace the object is published in (global = visible to every policy).",
  include: "Also add the SIM's home PLMNs (hplmn) and equivalent home PLMNs (ehplmn).",
};

const RATS = ["C = CDMA 1x", "H = HDR (EV-DO)", "G = GSM", "W = WCDMA", "L = LTE", "T = TD-SCDMA", "5G = NR"];
const BAND_SET = v("Band set: band numbers or ranges (bit indices, e.g. 0-63), adjusted by include/exclude.");
const IF = " Only if nothing is set or persisted yet.";

export const POLICY_ELEMENTS: Record<string, PolicyElementDoc> = {
  // qdsp6sw.mbn: mre_policy_set.c strings; attributes from shipped XML
  policy: {
    kind: "root", note: "One policy: rules the modem re-evaluates whenever its inputs change.", confidence: "low",
    attrs: {
      policy_ver: "Version stamp.", changelist: "Source change number.", mcfg_db_ver: "MCFG database version stamp.",
      file: "Policy file this entry loads.", execute_for: "device = run once; subs = run once per subscription.",
      load_for: "Which subscriptions load it (device or subs).", refresh_on_sim_change: "Re-evaluate when the SIM changes.",
      evaluate_all: "Evaluate every rule rather than stopping at the first match.",
    },
  },
  policy_list: { kind: "root", note: "The ordered list of policy files the modem loads.", confidence: "low" },
  initial: { kind: "block", note: "Runs once when the policy loads: declares lists, flags and defaults.", confidence: "low" },
  case: { kind: "block", note: "One branch of a select: its conditions, then the actions to run.", confidence: "low" },

  // qdsp6sw.mbn: MRE condition table (ids 1-9)
  cond: c("True when all child conditions hold (same handler as all_of).", "high"),
  conditions: c("True when all child conditions hold (same handler as all_of).", "high"),
  all_of: c("True when all child conditions hold.", "high"),
  any_of: c("True when at least one child condition holds.", "high"),
  true: c("Always true; the fallback case.", "high"),
  not: c("Inverts its child condition.", "high"),
  boolean_test: c("True when the named flag is true.", "high"),
  tristate_test: c("Tests a three-way flag (true, false or undef).", "med", { attrs: { value: "true, false or undef." } }),
  tristate_reset_all: c("Resets every three-way flag to undef.", "low"),

  // qdsp6sw.mbn: policyman condition rows and strings
  service_status_in: c("Service status is one of the listed values.", "med", { values: ["FULL", "LIMITED", "LIMITED-REGIONAL", "OOS", "POWER_SAVE"] }),
  srv_domain_has: c("Registered domain includes this one.", "med", { values: ["CS", "PS", "CSPS", "CAMP"] }),
  serving_mcc_in: c("Serving cell's country code (MCC) is in the list."),
  serving_plmn_in: c("Serving network (PLMN) is in the list."),
  serving_rat_in: c("Serving radio technology is in the list.", "med", { values: RATS }),
  serving_band_in: c("Serving band is in the list."),
  reg_reject_cause_in: c("Last registration reject cause is in the list."),
  oos_scan_cnt: c("Number of out-of-service scans compared with a value."),
  location_mcc_in: c("Best-known country (serving, camped, early-MCC, GPS or mcc2bands) is in the list."),
  have_service: c("A subscription has service."),
  have_location: c("The modem has a country estimate."),
  have_serving_system: c("A serving system is known."),
  subphone_cap_has: c("This SIM slot's capability includes the radio technology."),
  current_mcc_in: c("Current country code is in the list."),
  imsi_plmn_in: c("SIM's home network (from the IMSI) is in the list."),
  imsi_mcc_in: c("SIM's home country (from the IMSI) is in the list."),
  sim_type: c("SIM application type.", "med", { values: ["2G", "3G", "CSIM", "RUIM"] }),
  sim_refreshed: c("The SIM was refreshed."),
  simlock_enabled: c("The device is SIM-locked."),
  have_imsi: c("The IMSI has been read."),
  ue_mode_is: c("Current UE mode equals the value (see ue_mode)."),
  svc_mode_is: c("Current service mode equals the value.", "med", { values: ["FULL", "LIMITED", "CAMP_ONLY"] }),
  num_subs: c("Number of active subscriptions compared with a value."),
  enforce_full_rat: c("Full-RAT fallback is being enforced."),
  is_subs_dds: c("The subscription is the default for data."),
  subs_is_active: c("The subscription is active."),
  user_domain_pref: c("User's service domain preference."),
  user_mode_pref_contains: c("User's mode preference includes the radio technology."),
  user_mcc_in: c("User-selected country code is in the list."),
  network_selection_mode: c("Network selection is manual or automatic.", "med", { values: ["MANUAL", "AUTOMATIC"] }),
  voice_domain_pref_is: c("Current voice domain preference equals the value (see voice_domain_pref)."),
  call_mode_is: c("Current call mode equals the value.", "med", { values: ["NORMAL", "VOLTE"] }),
  service_domain_has: c("Service domain includes the value.", "med", { values: ["CS", "PS", "CSPS", "CAMP"] }),
  timer_expired: c("The named timer has expired."),
  timer_is_running: c("The named timer is running."),
  phone_operating_mode: c("Phone operating mode equals the value.", "med", { values: ["ONLINE", "OFFLINE", "RESET", "PWROFF", "LPM"] }),
  time_in_lpm: c("Time spent in low-power mode compared with a value."),
  tech_loaded: c("A radio technology's stack is loaded."),
  volte_enabled: c("VoLTE is enabled."),
  vonr_enabled: c("VoNR is enabled."),
  rat_enabled: c("The radio technology is enabled."),
  embms_is_active: c("eMBMS (LTE broadcast) is active."),
  fdn_status: c("Fixed dialing (FDN) status."),
  fdn_has: c("The fixed dialing list contains the value."),
  msim_cfg_mode_is: c("Dual-SIM 5G mode equals the value.", "med", { values: ["5G_PLUS_4G", "5G_PLUS_5G"] }),
  csc_is: c("Customisation code equals the value."),
  group_is: c("Group equals the value."),
  region_is: c("Region equals the value."),

  // qdsp6sw.mbn: MRE action table (ids 1-19)
  if: a("If the conditions hold, run then; otherwise else.", "high"),
  rule: a("Same as if.", "high"),
  actions: a("The actions a case runs.", "high"),
  then: a("Runs when the conditions hold.", "high"),
  else: a("Runs when they do not.", "high"),
  boolean_define: a("Declares a named flag.", "high", { attrs: { initial: "Starting value: true or false." } }),
  boolean_set: a("Sets a named flag.", "high", { attrs: { value: "true or false." } }),
  stop: a("Stops evaluating this policy's remaining rules.", "high"),
  select: a("Runs the first case whose conditions hold.", "med", { attrs: { evaluate_all: "Run every matching case, not only the first." } }),
  tristate_define: a("Declares a three-way flag.", "med", { attrs: { value: "true, false or undef." } }),
  tristate_set: a("Sets a three-way flag.", "med", { attrs: { value: "true, false or undef." } }),
  plmn_list: a("Declares a named list of networks: MCC-MNC, MCC-* or *-*.", "high"),
  mcc_list: a("Declares a named list of country codes; 4095 means any.", "high"),
  block_define: a("Defines a reusable block of actions."),
  block_execute: a("Runs a defined block."),
  str_define: a("Declares a named string; type RAT holds a list of radio technologies.", "med", { attrs: { type: "RAT = a list of radio technology letters.", initial: "Starting value." } }),
  str_set: a("Sets a named string.", "high", { attrs: { type: "RAT = a list of radio technology letters.", value: "New value." } }),

  // qdsp6sw.mbn: policyman action strings
  device_configuration: a("Dual-SIM setup: SIM count and how many may be active.", "med", {
    attrs: { num_sims: "SIM slots.", max_active: "Subscriptions active at once.", max_active_voice: "Subscriptions that may carry voice at once.", max_active_data: "Subscriptions that may carry data at once." },
  }),
  device_configuration_if: a("Dual-SIM setup." + IF),
  config: a("Radio technologies each SIM slot may use.", "med", { attrs: { primary: "Slot 1 radio technologies.", secondary: "Slot 2 radio technologies." }, values: RATS }),
  e911_config: a("Radio technologies each slot may use for emergency calls.", "med", { attrs: { primary: "Slot 1.", secondary: "Slot 2." }, values: RATS }),
  msim_config: a("Dual-SIM 5G mode, optionally only for the listed networks.", "med", { attrs: { mode: "5G_PLUS_4G or 5G_PLUS_5G." } }),
  release_config: a("3GPP release override."),
  define_config: a("Defines a named configuration."),
  use_config: a("Applies a named configuration."),
  use_config_if: a("Applies a named configuration." + IF),
  rat_capability: a("Sets the allowed radio technologies: base set, then include/exclude.", "med", { values: RATS }),
  rat_capability_if: a("Sets the allowed radio technologies." + IF, "med", { values: RATS }),
  ue_mode: a("Sets how voice and data share radios.", "med", {
    values: ["NORMAL", "CSFB", "SGLTE", "SVLTE", "CSFB_ONLY", "SGLTE_ONLY", "SVLTE_ONLY", "1X_CSFB_PREF", "GSM_CSFB_PREF", "GSMSRLTE_ONLY", "1XSRLTE_ONLY"],
  }),
  ue_mode_if: a("Sets the UE mode." + IF),
  rf_bands: a("Applies a named band list, or every band the hardware has."),
  rf_bands_if: a("Applies a named band list." + IF),
  rf_band_list: a("Defines named band masks per technology (GSM/WCDMA, LTE, TD-SCDMA, NR SA/NSA/NR-DC, NB-IoT NTN)."),
  voice_domain_pref: a("Sets where voice calls go.", "med", { attrs: { mandatory: "Enforced rather than preferred." }, values: ["CS_ONLY", "CS_PREF", "IMS_PREF", "IMS_ONLY"] }),
  call_mode: a("Sets the call mode; VOLTE means VoLTE only.", "med", { values: ["NORMAL", "VOLTE"] }),
  call_mode_if: a("Sets the call mode." + IF),
  volte: a("VoLTE default.", "med", { attrs: { enabled: "true or false." } }),
  scan_optimization: a("Network scan optimisation settings."),
  freq_list: a("Applies a frequency list (cpfl or default)."),
  freq_list_if: a("Applies a frequency list." + IF),
  select_config: a("Selects a configuration."),
  service_domain: a("Sets the service domain.", "med", { values: ["CS", "PS", "CSPS", "CAMP"] }),
  limited_rats_bands: a("Restricts radio technologies and bands while in limited service."),
  limited_rats_bands_if: a("Restricts radio technologies and bands in limited service." + IF),
  define_fullrat_config: a("Full-RAT fallback: try every technology after a timer or failed scans when the country is unknown.", "med", {
    attrs: { is_post: "Applies in the post-policy stage.", timer_secs: "Seconds before falling back.", scan_fail_cnt: "Failed scans before falling back." },
  }),
  fullrat_enter: a("Enters full-RAT fallback."),
  define_ntn_config: a("Defines the satellite (non-terrestrial) network config."),
  define_timer: a("Declares a named timer.", "med", { attrs: { class: "fixed or backoff.", persist: "Survives a reboot." } }),
  expired_timer_handled: a("Marks a timer's expiry as handled."),
  timer_start: a("Starts a named timer."),
  timer_stop: a("Stops a named timer."),
  exclude_tech: a("Excludes a technology."),
  ims_config: a("IMS settings."),
  disable_reason: a("Sets or clears a reason 5G is disabled.", "med", {
    attrs: { set: "Reason to add: ROAMING, CHINA_MSIM, NDDS_SUBS or EF_RAT.", unset: "Reason to clear.", which: "SA or NSA." },
  }),
  msim_cfg_mode_5g_plus_5g: a("Dual-SIM 5G+5G: both subscriptions may use NR.", "med", { attrs: { override: "Override a persisted choice." } }),
  msim_cfg_mode_5g_plus_4g: a("Dual-SIM 5G+4G: only one subscription may use NR.", "med", { attrs: { override: "Override a persisted choice." } }),
  rat_order: a("Sets the order technologies are tried in (e.g. 5G L W G).", "med", { values: RATS }),
  svc_mode: a("Sets the service mode.", "low", { values: ["FULL", "LIMITED", "CAMP_ONLY"] }),
  feature: a("Device mode for this subscription.", "med", { attrs: { single_sim: "normal, svlte, sglte, srlte or dualmmode." } }),
  hw_bands_filter: a("Bands the hardware may use at all."),
  exclude_for_bst: a("Bands excluded for BST."),
  exclude_for_volte: a("Bands excluded while VoLTE is in use."),
  intersect_with: a("Keeps only bands also in the named mask (SUB6 = NR below 6 GHz).", "med", { attrs: { mask: "Mask to intersect with." } }),
  lte_feature: a("Named LTE feature switch (Apple addition).", "low"),

  // qdsp6sw.mbn: include/exclude and band-set strings
  include: v("Adds these: radio technology letters under rat_capability, band numbers or ranges under a band set.", "high"),
  exclude: v("Removes these: radio technology letters or band numbers.", "high"),
  gw_bands: { ...BAND_SET, note: "GSM/WCDMA " + BAND_SET.note },
  lte_bands: { ...BAND_SET, note: "LTE " + BAND_SET.note },
  tds_bands: { ...BAND_SET, note: "TD-SCDMA " + BAND_SET.note },
  nb1_ntn_bands: { ...BAND_SET, note: "NB-IoT satellite " + BAND_SET.note },
  nr5g_sa_bands: { ...BAND_SET, note: "NR standalone " + BAND_SET.note },
  nr5g_nsa_bands: { ...BAND_SET, note: "NR non-standalone " + BAND_SET.note },
  nr5g_nrdc_bands: { ...BAND_SET, note: "NR-DC " + BAND_SET.note },
};

/** The element's note, or undefined for elements the firmware does not name. */
export const describePolicyElement = (name: string): PolicyElementDoc | undefined =>
  Object.hasOwn(POLICY_ELEMENTS, name) ? POLICY_ELEMENTS[name] : undefined;

/** An attribute's note: the element's own, else the common one. */
export function describePolicyAttr(element: string, attr: string): string | undefined {
  const own = describePolicyElement(element)?.attrs;
  if (own && Object.hasOwn(own, attr)) return own[attr];
  return Object.hasOwn(POLICY_ATTRS, attr) ? POLICY_ATTRS[attr] : undefined;
}
