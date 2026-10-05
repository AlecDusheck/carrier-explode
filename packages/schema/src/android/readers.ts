/** How Pixel CarrierSettings answer each concept: CarrierConfigManager keys (checked against shipped files) and APNs. */

import { apnField, apnName } from "../apn-readings.ts";
import { readConcepts, type Readers } from "../concepts.ts";
import { isJsonArray, type Apn, type ConceptValue, type FeatureState, type Fidelity, type Json, type NativeRef } from "../types.ts";
import {
  bool, iconLabel, mmsProxyAddress, num, numberSet, sipUri, stateReading, stringSet, text, unset, valueReading,
  type StateReading, type Unset, type ValueReading,
} from "../values.ts";
import { config, configOrDefault, type ConfigRead, type Configs, type DefaultedKey } from "./config.ts";

interface AndroidView {
  readonly configs: Configs;
  readonly apns: readonly Apn[];
}

type Valued<T extends Json> = (v: AndroidView) => ValueReading<T> | Unset;
type Stated = (v: AndroidView) => StateReading;

/** One key, converted; unset when absent or not convertible. */
function key<T extends Json>(name: string, convert: (raw: Json) => T | undefined, fidelity: Fidelity = "exact"): Valued<T> {
  return ({ configs }) => {
    const r = config(configs, name);
    const v = r === undefined ? undefined : convert(r.value);
    return r === undefined || v === undefined ? unset : valueReading(v, [r.ref], fidelity);
  };
}

/** One key, falling back on its AOSP default. */
function defaulted<T extends Json>(name: DefaultedKey, convert: (raw: Json) => T | undefined, fidelity: Fidelity = "exact"): Valued<T> {
  return ({ configs }) => {
    const r = configOrDefault(configs, name);
    const v = convert(r.value);
    return v === undefined ? unset : valueReading(v, [r.ref], fidelity);
  };
}

const lower = (raw: Json): string | undefined => text(raw)?.toLowerCase();
const numbers = (raw: Json): number[] | undefined =>
  isJsonArray(raw) ? raw.flatMap((x) => (typeof x === "number" ? [x] : [])) : undefined;
const strings = (raw: Json): string[] | undefined =>
  isJsonArray(raw) ? raw.flatMap((x) => (typeof x === "string" ? [x] : [])) : undefined;
const isTrue = (r: ConfigRead): boolean => r.value === true;
const isObject = (v: Json): v is { readonly [k: string]: Json } => typeof v === "object" && v !== null && !isJsonArray(v);

/** `available` gates the feature; `onByDefault` decides on vs available. */
function availability(available: DefaultedKey, onByDefault: DefaultedKey): Stated {
  return ({ configs }) => {
    const a = configOrDefault(configs, available);
    if (!isTrue(a)) return stateReading("no", [a.ref]);
    const d = configOrDefault(configs, onByDefault);
    return stateReading(isTrue(d) ? "on" : "available", [a.ref, d.ref]);
  };
}

/** CarrierConfigManager.CARRIER_NR_AVAILABILITY_NSA / _SA. */
const NR_MODE: ReadonlyMap<number, string> = new Map([[1, "NSA"], [2, "SA"]]);
const nrModes = (raw: Json): string[] => stringSet((numbers(raw) ?? []).flatMap((n) => NR_MODE.get(n) ?? []));

function nr(decide: (modes: readonly string[]) => FeatureState): Stated {
  return ({ configs }) => {
    const r = configOrDefault(configs, "carrier_nr_availabilities_int_array");
    return stateReading(decide(nrModes(r.value)), [r.ref], "derived");
  };
}

const CODEC_KEYS: Readonly<Record<string, string>> = {
  "imsvoice.amrnb_payload_type_int_array": "AMR",
  "imsvoice.amrwb_payload_type_int_array": "AMR-WB",
  "imsvoice.evs_payload_type_int_array": "EVS",
};

/** Codecs offered: those with payload types in imsvoice.audio_codec_capability_payload_types_bundle. */
function offeredCodecs(configs: Configs): { ref: NativeRef; names: string[] } | undefined {
  const r = config(configs, "imsvoice.audio_codec_capability_payload_types_bundle");
  if (!r || !isObject(r.value)) return undefined;
  const bundle = r.value;
  const names = Object.entries(CODEC_KEYS).flatMap(([k, name]) => {
    const types = bundle[k];
    return types !== undefined && isJsonArray(types) && types.length > 0 ? [name] : [];
  });
  return { ref: r.ref, names: stringSet(names) };
}

/** Without the bundle, AOSP's default codec list applies, and it has no EVS. */
const evs: Stated = ({ configs }) => {
  const c = offeredCodecs(configs);
  return c ? stateReading(c.names.includes("EVS") ? "on" : "no", [c.ref]) : stateReading("no", [], "approx");
};

const codecs: Valued<string[]> = ({ configs }) => {
  const c = offeredCodecs(configs);
  return c ? valueReading(c.names, [c.ref]) : unset;
};

const satellite: Stated = ({ configs }) => {
  const attach = configOrDefault(configs, "satellite_attach_supported_bool");
  if (isTrue(attach)) return stateReading("on", [attach.ref]);
  const services = config(configs, "carrier_supported_satellite_services_per_provider_bundle");
  const offered = services !== undefined && isObject(services.value) && Object.keys(services.value).length > 0;
  return offered ? stateReading("available", [attach.ref, services.ref], "approx") : stateReading("no", [attach.ref]);
};

/** TelephonyManager.VVM_TYPE_*: the protocols the built-in dialer speaks. */
const VVM_TYPES: ReadonlySet<Json> = new Set(["vvm_type_omtp", "vvm_type_cvvm", "vvm_type_vvm3"]);

/** A carrier VVM app offers it too, outside the built-in client. */
const visualVoicemail: Stated = ({ configs }) => {
  const type = configOrDefault(configs, "vvm_type_string");
  if (VVM_TYPES.has(type.value)) return stateReading("on", [type.ref]);
  const app = config(configs, "carrier_vvm_package_name_string");
  if (app && text(app.value)) return stateReading("available", [type.ref, app.ref], "approx");
  return stateReading("no", [type.ref]);
};

const videoCalling: Stated = ({ configs }) => {
  const r = configOrDefault(configs, "carrier_vt_available_bool");
  return stateReading(isTrue(r) ? "on" : "no", [r.ref]);
};

const vonr: Stated = ({ configs }) => {
  const enabled = configOrDefault(configs, "vonr_enabled_bool");
  if (!isTrue(enabled)) return stateReading("no", [enabled.ref]);
  const byDefault = configOrDefault(configs, "vonr_on_by_default_bool");
  return stateReading(isTrue(byDefault) ? "on" : "available", [enabled.ref, byDefault.ref]);
};

/** The VoLTE switch shows when VoLTE exists, is not hidden and is editable. */
const volteSwitch: Valued<boolean> = ({ configs }) => {
  const available = configOrDefault(configs, "carrier_volte_available_bool");
  const hidden = configOrDefault(configs, "hide_enhanced_4g_lte_bool");
  const editable = configOrDefault(configs, "editable_enhanced_4g_lte_bool");
  return valueReading(isTrue(available) && !isTrue(hidden) && isTrue(editable), [available.ref, hidden.ref, editable.ref], "derived");
};

const vonrSwitch: Valued<boolean> = ({ configs }) => {
  const enabled = configOrDefault(configs, "vonr_enabled_bool");
  const visible = configOrDefault(configs, "vonr_setting_visibility_bool");
  return valueReading(isTrue(enabled) && isTrue(visible), [enabled.ref, visible.ref], "derived");
};

/** `connected_mmwave:5G_Plus,connected:5G,...`: the advanced label, when it differs from plain 5G. */
const advancedIcon: Valued<string> = ({ configs }) => {
  const r = config(configs, "5g_icon_configuration_string");
  const spec = r === undefined ? undefined : text(r.value);
  if (!r || spec === undefined) return unset;
  const icons = new Map(spec.split(",").flatMap((pair): Array<[string, string]> => {
    const [state, icon] = pair.split(":").map((x) => x.trim());
    return state && icon ? [[state, icon]] : [];
  }));
  const advanced = icons.get("connected_mmwave");
  return advanced === undefined || advanced === icons.get("connected") ? unset : valueReading(iconLabel(advanced), [r.ref]);
};

/** ImsMmTelManager.WIFI_MODE_*. */
const WFC_MODE: ReadonlyMap<Json, string> = new Map([[0, "wifi-only"], [1, "cellular-preferred"], [2, "wifi-preferred"]]);
const wfcMode = (k: DefaultedKey): Valued<string> => defaulted(k, (raw) => WFC_MODE.get(raw));

/** AccessNetworkConstants.AccessNetworkType, named as the Apple mapper names radios. */
const ACCESS_NETWORK: ReadonlyMap<number, string> = new Map([[1, "gsm"], [2, "umts"], [3, "lte"], [4, "cdma"], [5, "wlan"], [6, "nr"]]);

const mmsImage: Valued<number> = ({ configs }) => {
  const reads = [config(configs, "maxImageWidth"), config(configs, "maxImageHeight")].flatMap((r) => r ?? []);
  const sizes = reads.flatMap((r) => (typeof r.value === "number" ? [r.value] : []));
  return sizes.length ? valueReading(Math.max(...sizes), reads.map((r) => r.ref), "derived") : unset;
};

const mmsProxy: Valued<string> = ({ apns }) => {
  const a = apns.find((x) => x.types.includes("mms") && x.mmsProxy !== undefined);
  if (a?.mmsProxy === undefined) return unset;
  return valueReading(mmsProxyAddress(a.mmsProxy, a.mmsPort), [{ path: `${a.path}.mmsProxy`, value: a.mmsProxy }]);
};

/** carrier_ussd_method_int: CS_PREFERRED 0, IMS_PREFERRED 1, CS_ONLY 2, IMS_ONLY 3. */
const USSD_OVER_IMS: ReadonlyMap<Json, boolean> = new Map([[0, false], [1, true], [2, false], [3, true]]);

/** `0xA001-0xA002:type=other, emergency=true`: ids as decimal ranges, as Apple writes them. */
function cbsRanges(rules: readonly string[]): string[] {
  const ids = rules.flatMap((rule) => (rule.split(":")[0] ?? "").split(",")).flatMap((part) => {
    const [from, to] = part.split("-").map((x) => Number.parseInt(x.trim(), 16));
    if (from === undefined || Number.isNaN(from)) return [];
    return [to === undefined || Number.isNaN(to) || to === from ? String(from) : `${from}-${to}`];
  });
  return stringSet(ids);
}

/** The newer and the GSM-era key both list PLMNs treated as home. */
const homeNetworks: Valued<string[]> = ({ configs }) => {
  const reads = [config(configs, "non_roaming_operator_string_array"), config(configs, "gsm_nonroaming_networks_string_array")].flatMap((r) => r ?? []);
  return reads.length ? valueReading(stringSet(reads.flatMap((r) => strings(r.value) ?? [])), reads.map((r) => r.ref), "approx") : unset;
};

const ANDROID_READERS = {
  "5g": nr((modes) => (modes.length ? "on" : "no")),
  "5g-standalone": nr((modes) => (modes.includes("SA") ? "on" : "no")),
  "voice-over-5g": vonr,
  volte: availability("carrier_volte_available_bool", "enhanced_4g_lte_on_by_default_bool"),
  "hd-voice-plus": evs,
  "wifi-calling": availability("carrier_wfc_ims_available_bool", "carrier_default_wfc_ims_enabled_bool"),
  satellite,
  "visual-voicemail": visualVoicemail,
  "video-calling": videoCalling,
  rtt: defaulted("rtt_supported_bool", bool),
  "volte-switch": volteSwitch,
  "vonr-switch": vonrSwitch,
  "audio-codecs": codecs,
  // Apple's ShowTTY shows the TTY switch; this says TTY works.
  tty: key("tty_supported_bool", bool, "approx"),
  "tty-over-ims": key("carrier_volte_tty_supported_bool", bool),
  "sip-ipsec": key("ims.sip_over_ipsec_enabled_bool", bool),
  "sip-precondition": key("imsvoice.voice_qos_precondition_supported_bool", bool),
  // Apple's key says always PRACK; this says PRACK is supported.
  "prack-18x": key("imsvoice.prack_supported_for_18x_bool", bool, "approx"),
  "conference-uri": key("imsvoice.conference_factory_uri_string", (raw) => { const t = text(raw); return t === undefined ? undefined : sipUri(t); }),
  // Apple counts parties on a call; this counts conference participants.
  "conference-size": key("ims_conference_size_limit_int", num, "approx"),
  "ringing-timer": key("imsvoice.ringing_timer_millis_int", num),
  "ringback-timer": key("imsvoice.ringback_timer_millis_int", num),
  "session-expires": key("imsvoice.session_expires_timer_sec_int", num),
  "ims-registration-expiry": key("ims.registration_expiry_timer_sec_int", num),
  "ims-retry-base": key("ims.registration_retry_base_timer_millis_int", num),
  "ims-retry-max": key("ims.registration_retry_max_timer_millis_int", num),
  "sip-timer-t1": key("ims.sip_timer_t1_millis_int", num),
  "sip-timer-t2": key("ims.sip_timer_t2_millis_int", num),
  "sip-timer-t4": key("ims.sip_timer_t4_millis_int", num),
  "sip-timer-b": key("ims.sip_timer_b_millis_int", num),
  "sip-timer-d": key("ims.sip_timer_d_millis_int", num),
  "sip-timer-f": key("ims.sip_timer_f_millis_int", num),
  "sip-timer-h": key("ims.sip_timer_h_millis_int", num),
  "sip-timer-j": key("ims.sip_timer_j_millis_int", num),
  // Apple's maximum UDP message size against the SIP MTU: both are where SIP moves to TCP.
  "sip-udp-limit": key("ims.ipv4_sip_mtu_size_cellular_int", num, "approx"),
  "rtp-inactivity": key("imsvoice.audio_rtp_inactivity_timer_millis_int", num),
  "rtcp-inactivity": key("imsvoice.audio_rtcp_inactivity_timer_millis_int", num),
  "ims-user-agent": key("ims.ims_user_agent_string", text, "approx"),
  "nr-modes": defaulted("carrier_nr_availabilities_int_array", nrModes),
  "5g-icon-advanced": advancedIcon,
  "lte-icon": defaulted("show_4g_for_lte_data_icon_bool", (raw) => (raw === true ? "4G" : raw === false ? "LTE" : undefined)),
  "wfc-mode": wfcMode("carrier_default_wfc_ims_mode_int"),
  "wfc-roaming-mode": wfcMode("carrier_default_wfc_ims_roaming_mode_int"),
  // Apple's says Wi-Fi Calling is allowed abroad; this says it starts on abroad.
  "wfc-roaming": defaulted("carrier_default_wfc_ims_roaming_enabled_bool", bool, "approx"),
  "epdg-address": key("iwlan.epdg_static_address_string", lower),
  "ike-dh-groups": key("iwlan.diffie_hellman_groups_int_array", (raw) => { const ns = numbers(raw); return ns && numberSet(ns); }),
  "sms-over-ims": key("imssms.sms_over_ims_supported_bool", bool),
  "sms-over-ims-networks": key("imssms.sms_over_ims_supported_rats_int_array", (raw) => { const ns = numbers(raw); return ns && stringSet(ns.flatMap((n) => ACCESS_NETWORK.get(n) ?? [])); }),
  "mms-max-size": key("maxMessageSize", num),
  "mms-max-recipients": key("recipientLimit", num),
  "mms-max-image": mmsImage,
  "mms-max-subject": key("maxSubjectLength", num, "approx"),
  "mms-group": key("enableGroupMms", bool, "approx"),
  "mms-roaming-download": key("mmsRoamingAutoRetrieveByDefault", bool, "approx"),
  mmsc: apnField("mms", "mmsc", "mmsc"),
  "mms-proxy": mmsProxy,
  "mms-uaprof": key("uaProfUrl", text),
  "mms-user-agent": key("userAgent", text),
  "ussd-over-ims": defaulted("carrier_ussd_method_int", (raw) => USSD_OVER_IMS.get(raw), "approx"),
  "ss-over-ut": defaulted("carrier_supports_ss_over_ut_bool", bool),
  "xcap-server": key("imsss.ut_as_server_fqdn_string", lower),
  "xcap-port": key("imsss.ut_as_server_port_int", num),
  "bsf-server": key("bsf.bsf_server_fqdn_string", lower),
  "bsf-port": key("bsf.bsf_server_port_int", num),
  "emergency-over-ims": key("imsemergency.emergency_over_ims_supported_rats_int_array", (raw) => { const ns = numbers(raw); return ns && ns.length > 0; }, "derived"),
  "text-to-emergency": key("support_emergency_sms_over_ims_bool", bool, "approx"),
  // Only the channels added to the platform defaults.
  "cell-broadcast-channels": key("carrier_additional_cbs_channels_strings", (raw) => { const rules = strings(raw); return rules && cbsRanges(rules); }, "approx"),
  "apn-internet": apnName("default"),
  "apn-mms": apnName("mms"),
  "apn-ims": apnName("ims"),
  "apn-emergency": apnName("emergency"),
  "apn-xcap": apnName("xcap"),
  "apn-attach": apnName("ia"),
  "internet-ip": apnField("default", "protocol", "protocol"),
  "internet-ip-roaming": apnField("default", "roamingProtocol", "roamingProtocol"),
  "data-mtu": apnField("default", "mtu", "mtu", "approx"),
  "tethering-apn": apnName("dun"),
  "home-networks": homeNetworks,
  "data-roaming-default": defaulted("carrier_default_data_roaming_enabled_bool", bool),
  // Applies only when the SIM gives no name, unless carrier_name_override_bool is set.
  "carrier-name": key("carrier_name_string", text, "approx"),
  "country-iso": key("sim_country_iso_override_string", lower),
  "voicemail-number": key("default_vm_number_string", text),
  "voicemail-roaming-number": key("default_vm_number_roaming_string", text),
  "satellite-name": key("satellite_display_name_string", text),
  "entitlement-server": key("imsserviceentitlement.entitlement_server_url_string", text),
  "lte-rsrp-thresholds": key("lte_rsrp_thresholds_int_array", numbers),
  "nr-rsrp-thresholds": key("5g_nr_ssrsrp_thresholds_int_array", numbers),
} satisfies Readers<AndroidView>;

/** The concepts Android can express. */
export const ANDROID_CONCEPT_IDS: ReadonlySet<string> = new Set(Object.keys(ANDROID_READERS));

export const androidConcepts = (v: AndroidView): Record<string, ConceptValue> => readConcepts<AndroidView>(ANDROID_READERS, v);
