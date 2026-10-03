/**
 * How Android answers each concept (../concepts.ts), from a Pixel
 * CarrierSettings file's CarrierConfig keys (AOSP CarrierConfigManager names,
 * every one checked against the shipped files) and its APNs.
 *
 * Feature states mirror features.ts's vocabulary: "on" when it is on by
 * default, "available" when the user or the carrier's server turns it on, "no"
 * when not offered. Keys whose AOSP default decides a state fall back on it
 * (./config.ts); everything else is unset when the file leaves it out.
 */

import type { ConceptId } from "../concepts.ts";
import type { Apn, ApnType, ConceptValue, Json, NativeRef } from "../types.ts";
import {
  bool, conceptValue, iconLabel, num, numberSet, sipUri, stateValue, stringSet, text, unset, type Fidelity,
} from "../values.ts";
import { config, configOrDefault, type ConfigRead, type Configs, type DefaultedKey } from "./config.ts";

export interface AndroidView {
  readonly configs: Configs;
  readonly apns: readonly Apn[];
}

export type AndroidReader = (v: AndroidView) => ConceptValue | undefined;

/* ----------------------------------------------------------------- helpers */

/** One key, converted; unset when absent or not convertible. */
function key(name: string, convert: (raw: Json) => Json | undefined, fidelity: Fidelity = "exact"): AndroidReader {
  return ({ configs }) => {
    const r = config(configs, name);
    const v = r === undefined ? undefined : convert(r.value);
    return r === undefined || v === undefined ? unset() : conceptValue(v, [r.ref], fidelity);
  };
}

/** One key with its AOSP default. */
function defaulted(name: DefaultedKey, convert: (raw: Json) => Json | undefined, fidelity: Fidelity = "exact"): AndroidReader {
  return ({ configs }) => {
    const r = configOrDefault(configs, name);
    const v = convert(r.value);
    return v === undefined ? unset([r.ref]) : conceptValue(v, [r.ref], fidelity);
  };
}

const asText = (raw: Json): string | undefined => text(raw);
const asBool = (raw: Json): boolean | undefined => bool(raw);
const asNum = (raw: Json): number | undefined => num(raw);
const lower = (raw: Json): string | undefined => text(raw)?.toLowerCase();
const numbers = (raw: Json): number[] | undefined =>
  Array.isArray(raw) ? raw.flatMap((x) => (typeof x === "number" ? [x] : [])) : undefined;
const strings = (raw: Json): string[] | undefined =>
  Array.isArray(raw) ? raw.flatMap((x) => (typeof x === "string" ? [x] : [])) : undefined;

const isTrue = (r: ConfigRead): boolean => r.value === true;

/** The first APN carrying a type. APN names are case-insensitive (3GPP TS 23.003 9.1). */
function apnName(type: ApnType): AndroidReader {
  return ({ apns }) => {
    const a = apns.find((x) => x.types.includes(type) || (x.types.includes("all") && type !== "ia"));
    return a ? conceptValue(a.apn.toLowerCase(), [{ path: a.path, value: a.apn }]) : unset();
  };
}

function apnField(type: ApnType, field: "protocol" | "roamingProtocol"): AndroidReader {
  return ({ apns }) => {
    const a = apns.find((x) => x.types.includes(type));
    const v = a?.[field];
    return a && v ? conceptValue(v, [{ path: `${a.path}.${field}`, value: v }]) : unset();
  };
}

/* ------------------------------------------------------------------ features */

/** Available-and-on-by-default pairs: `available` gates it, `onByDefault` decides on vs available. */
function availability(available: DefaultedKey, onByDefault: DefaultedKey): AndroidReader {
  return ({ configs }) => {
    const a = configOrDefault(configs, available);
    if (!isTrue(a)) return stateValue("no", [a.ref]);
    const d = configOrDefault(configs, onByDefault);
    return stateValue(isTrue(d) ? "on" : "available", [a.ref, d.ref]);
  };
}

/** CarrierConfigManager.CARRIER_NR_AVAILABILITY_NSA / _SA. */
const NR_MODE: ReadonlyMap<number, string> = new Map([[1, "NSA"], [2, "SA"]]);

const nrModesOf = (r: ConfigRead): string[] => stringSet((numbers(r.value) ?? []).flatMap((n) => NR_MODE.get(n) ?? []));

const fiveG: AndroidReader = ({ configs }) => {
  const r = configOrDefault(configs, "carrier_nr_availabilities_int_array");
  return stateValue(nrModesOf(r).length ? "on" : "no", [r.ref], "derived");
};

const fiveGStandalone: AndroidReader = ({ configs }) => {
  const r = configOrDefault(configs, "carrier_nr_availabilities_int_array");
  return stateValue(nrModesOf(r).includes("SA") ? "on" : "no", [r.ref], "derived");
};

const vonr: AndroidReader = ({ configs }) => {
  const enabled = configOrDefault(configs, "vonr_enabled_bool");
  if (!isTrue(enabled)) return stateValue("no", [enabled.ref]);
  const byDefault = configOrDefault(configs, "vonr_on_by_default_bool");
  return stateValue(isTrue(byDefault) ? "on" : "available", [enabled.ref, byDefault.ref]);
};

const EVS_KEY = "imsvoice.evs_payload_type_int_array";
const CODEC_KEYS: Readonly<Record<string, string>> = {
  "imsvoice.amrnb_payload_type_int_array": "AMR",
  "imsvoice.amrwb_payload_type_int_array": "AMR-WB",
  [EVS_KEY]: "EVS",
};

/** imsvoice.audio_codec_capability_payload_types_bundle: codec -> payload types it is offered under. */
function codecMap(configs: Configs): { ref: NativeRef; codecs: Record<string, Json> } | undefined {
  const r = config(configs, "imsvoice.audio_codec_capability_payload_types_bundle");
  if (!r || typeof r.value !== "object" || r.value === null || Array.isArray(r.value)) return undefined;
  return { ref: r.ref, codecs: r.value };
}

const offered = (codecs: Record<string, Json>, k: string): boolean => {
  const v = codecs[k];
  return Array.isArray(v) && v.length > 0;
};

/** Without the bundle the file says nothing about EVS; AOSP's default list does not offer it. */
const evs: AndroidReader = ({ configs }) => {
  const m = codecMap(configs);
  if (!m) return stateValue("no", [], "approx");
  return stateValue(offered(m.codecs, EVS_KEY) ? "on" : "no", [m.ref]);
};

const codecs: AndroidReader = ({ configs }) => {
  const m = codecMap(configs);
  if (!m) return unset();
  return conceptValue(stringSet(Object.entries(CODEC_KEYS).flatMap(([k, name]) => (offered(m.codecs, k) ? [name] : []))), [m.ref]);
};

const satellite: AndroidReader = ({ configs }) => {
  const attach = configOrDefault(configs, "satellite_attach_supported_bool");
  if (isTrue(attach)) return stateValue("on", [attach.ref]);
  const services = config(configs, "carrier_supported_satellite_services_per_provider_bundle");
  const any = services !== undefined && typeof services.value === "object" && services.value !== null && Object.keys(services.value).length > 0;
  return any ? stateValue("available", [attach.ref, services.ref], "approx") : stateValue("no", [attach.ref]);
};

/** vvm_type_string: the visual voicemail protocols AOSP's dialer speaks (TelephonyManager.VVM_TYPE_*). */
const VVM_TYPES = new Set(["vvm_type_omtp", "vvm_type_cvvm", "vvm_type_vvm3"]);

const visualVoicemail: AndroidReader = ({ configs }) => {
  const type = configOrDefault(configs, "vvm_type_string");
  if (typeof type.value === "string" && VVM_TYPES.has(type.value)) return stateValue("on", [type.ref]);
  // A carrier app instead of the built-in client: offered, through the app.
  const app = config(configs, "carrier_vvm_package_name_string");
  if (app && text(app.value)) return stateValue("available", [type.ref, app.ref], "approx");
  return stateValue("no", [type.ref]);
};

const videoCalling: AndroidReader = ({ configs }) => {
  const r = configOrDefault(configs, "carrier_vt_available_bool");
  return stateValue(isTrue(r) ? "on" : "no", [r.ref]);
};

/* -------------------------------------------------------------------- voice */

/** The switch shows only when VoLTE exists, is not hidden, and is editable. */
const volteSwitch: AndroidReader = ({ configs }) => {
  const available = configOrDefault(configs, "carrier_volte_available_bool");
  const hidden = configOrDefault(configs, "hide_enhanced_4g_lte_bool");
  const editable = configOrDefault(configs, "editable_enhanced_4g_lte_bool");
  const shown = isTrue(available) && !isTrue(hidden) && isTrue(editable);
  return conceptValue(shown, [available.ref, hidden.ref, editable.ref], "derived");
};

const vonrSwitch: AndroidReader = ({ configs }) => {
  const enabled = configOrDefault(configs, "vonr_enabled_bool");
  const visible = configOrDefault(configs, "vonr_setting_visibility_bool");
  return conceptValue(isTrue(enabled) && isTrue(visible), [enabled.ref, visible.ref], "derived");
};

/* ------------------------------------------------------------------ nr/icons */

/** 5g_icon_configuration_string: `connected_mmwave:5G_Plus,connected:5G,...`; the mmWave/advanced label when it differs from plain. */
const advancedIcon: AndroidReader = ({ configs }) => {
  const r = config(configs, "5g_icon_configuration_string");
  const spec = r === undefined ? undefined : text(r.value);
  if (!r || spec === undefined) return unset();
  const icons = new Map(spec.split(",").flatMap((pair) => {
    const [state, icon] = pair.split(":").map((x) => x.trim());
    return state && icon ? [[state, icon] as const] : [];
  }));
  const advanced = icons.get("connected_mmwave");
  return advanced === undefined || advanced === icons.get("connected") ? unset([r.ref]) : conceptValue(iconLabel(advanced), [r.ref]);
};

/* --------------------------------------------------------------- wifi-calling */

/** ImsMmTelManager.WIFI_MODE_*. */
const WFC_MODE: ReadonlyMap<number, string> = new Map([[0, "wifi-only"], [1, "cellular-preferred"], [2, "wifi-preferred"]]);

const wfcMode = (k: DefaultedKey): AndroidReader => defaulted(k, (raw) => (typeof raw === "number" ? WFC_MODE.get(raw) : undefined));

/* ---------------------------------------------------------------- messaging */

/** AccessNetworkConstants.AccessNetworkType, named as the iOS mapper names radios. */
const ACCESS_NETWORK: ReadonlyMap<number, string> = new Map([[1, "gsm"], [2, "umts"], [3, "lte"], [4, "cdma"], [5, "wlan"], [6, "nr"]]);

const smsNetworks = key("imssms.sms_over_ims_supported_rats_int_array", (raw) => {
  const ns = numbers(raw);
  return ns === undefined ? undefined : stringSet(ns.flatMap((n) => ACCESS_NETWORK.get(n) ?? []));
});

const mmsImage: AndroidReader = ({ configs }) => {
  const w = config(configs, "maxImageWidth"), h = config(configs, "maxImageHeight");
  const sizes = [w, h].flatMap((r) => (r && typeof r.value === "number" ? [r.value] : []));
  const refs = [w, h].flatMap((r) => (r ? [r.ref] : []));
  return sizes.length ? conceptValue(Math.max(...sizes), refs, "derived") : unset();
};

function mmsApnField(field: "mmsc" | "mmsProxy"): AndroidReader {
  return ({ apns }) => {
    const a = apns.find((x) => x.types.includes("mms") && x[field] !== undefined);
    const v = a?.[field];
    if (!a || v === undefined) return unset();
    const port = field === "mmsProxy" ? a.mmsPort : undefined;
    // iOS writes the MMS proxy as host[:port] in one string; joined the same way here.
    const value = field === "mmsProxy" ? (port ? `${v}:${port}` : v).toLowerCase() : v;
    return conceptValue(value, [{ path: `${a.path}.${field}`, value: v }]);
  };
}

/* ------------------------------------------------------------ supplementary */

/** carrier_ussd_method_int: USSD_OVER_CS_PREFERRED 0, IMS_PREFERRED 1, CS_ONLY 2, IMS_ONLY 3. */
const ussd = defaulted("carrier_ussd_method_int", (raw) => (raw === 1 || raw === 3 ? true : raw === 0 || raw === 2 ? false : undefined), "approx");

/* ---------------------------------------------------------------- emergency */

const emergencyOverIms = key("imsemergency.emergency_over_ims_supported_rats_int_array", (raw) => {
  const ns = numbers(raw);
  return ns === undefined ? undefined : ns.length > 0;
}, "derived");

/** carrier_additional_cbs_channels_strings: `0xA001-0xA002:type=other, emergency=true`; ids as decimal, like iOS. */
const cbsChannels = key("carrier_additional_cbs_channels_strings", (raw) => {
  const rules = strings(raw);
  if (rules === undefined) return undefined;
  const ids = rules.flatMap((rule) => (rule.split(":")[0] ?? "").split(",")).flatMap((part) => {
    const [from, to] = part.split("-").map((x) => Number.parseInt(x.trim(), 16));
    if (from === undefined || Number.isNaN(from)) return [];
    return [to === undefined || Number.isNaN(to) || to === from ? String(from) : `${from}-${to}`];
  });
  return stringSet(ids);
}, "approx");

/* --------------------------------------------------------------------- data */

const dataMtu: AndroidReader = ({ apns }) => {
  const a = apns.find((x) => x.types.includes("default") && x.mtu !== undefined);
  return a?.mtu === undefined ? unset() : conceptValue(a.mtu, [{ path: `${a.path}.mtu`, value: a.mtu }], "approx");
};

/** Two keys list PLMNs to treat as home: the newer non_roaming_operator one and the GSM-era one. */
const homeNetworks: AndroidReader = ({ configs }) => {
  const reads = ["non_roaming_operator_string_array", "gsm_nonroaming_networks_string_array"].flatMap((k) => config(configs, k) ?? []);
  if (!reads.length) return unset();
  return conceptValue(stringSet(reads.flatMap((r) => strings(r.value) ?? [])), reads.map((r) => r.ref), "approx");
};

/* ------------------------------------------------------------------ registry */

export const ANDROID_READERS: Readonly<Partial<Record<ConceptId, AndroidReader>>> = {
  // features
  "5g": fiveG,
  "5g-standalone": fiveGStandalone,
  "voice-over-5g": vonr,
  volte: availability("carrier_volte_available_bool", "enhanced_4g_lte_on_by_default_bool"),
  "hd-voice-plus": evs,
  "wifi-calling": availability("carrier_wfc_ims_available_bool", "carrier_default_wfc_ims_enabled_bool"),
  satellite,
  "visual-voicemail": visualVoicemail,
  "video-calling": videoCalling,
  // voice
  rtt: defaulted("rtt_supported_bool", asBool),
  "volte-switch": volteSwitch,
  "vonr-switch": vonrSwitch,
  "audio-codecs": codecs,
  tty: key("tty_supported_bool", asBool, "approx"),
  "tty-over-ims": key("carrier_volte_tty_supported_bool", asBool),
  "sip-ipsec": key("ims.sip_over_ipsec_enabled_bool", asBool),
  "sip-precondition": key("imsvoice.voice_qos_precondition_supported_bool", asBool),
  "prack-18x": key("imsvoice.prack_supported_for_18x_bool", asBool, "approx"),
  "conference-uri": key("imsvoice.conference_factory_uri_string", (raw) => { const t = text(raw); return t === undefined ? undefined : sipUri(t); }),
  "conference-size": key("ims_conference_size_limit_int", asNum, "approx"),
  "ringing-timer": key("imsvoice.ringing_timer_millis_int", asNum),
  "ringback-timer": key("imsvoice.ringback_timer_millis_int", asNum),
  "session-expires": key("imsvoice.session_expires_timer_sec_int", asNum),
  "ims-registration-expiry": key("ims.registration_expiry_timer_sec_int", asNum),
  "ims-retry-base": key("ims.registration_retry_base_timer_millis_int", asNum),
  "ims-retry-max": key("ims.registration_retry_max_timer_millis_int", asNum),
  "sip-timer-t1": key("ims.sip_timer_t1_millis_int", asNum),
  "sip-timer-t2": key("ims.sip_timer_t2_millis_int", asNum),
  "sip-timer-t4": key("ims.sip_timer_t4_millis_int", asNum),
  "sip-timer-b": key("ims.sip_timer_b_millis_int", asNum),
  "sip-timer-d": key("ims.sip_timer_d_millis_int", asNum),
  "sip-timer-f": key("ims.sip_timer_f_millis_int", asNum),
  "sip-timer-h": key("ims.sip_timer_h_millis_int", asNum),
  "sip-timer-j": key("ims.sip_timer_j_millis_int", asNum),
  "sip-udp-limit": key("ims.ipv4_sip_mtu_size_cellular_int", asNum, "approx"),
  "rtp-inactivity": key("imsvoice.audio_rtp_inactivity_timer_millis_int", asNum),
  "rtcp-inactivity": key("imsvoice.audio_rtcp_inactivity_timer_millis_int", asNum),
  "ims-user-agent": key("ims.ims_user_agent_string", asText, "approx"),
  // nr
  "nr-modes": defaulted("carrier_nr_availabilities_int_array", (raw) => stringSet((numbers(raw) ?? []).flatMap((n) => NR_MODE.get(n) ?? []))),
  "5g-icon-advanced": advancedIcon,
  "lte-icon": defaulted("show_4g_for_lte_data_icon_bool", (raw) => (raw === true ? "4G" : raw === false ? "LTE" : undefined)),
  // wifi-calling
  "wfc-mode": wfcMode("carrier_default_wfc_ims_mode_int"),
  "wfc-roaming-mode": wfcMode("carrier_default_wfc_ims_roaming_mode_int"),
  "wfc-roaming": defaulted("carrier_default_wfc_ims_roaming_enabled_bool", asBool, "approx"),
  "epdg-address": key("iwlan.epdg_static_address_string", lower),
  "ike-dh-groups": key("iwlan.diffie_hellman_groups_int_array", (raw) => { const ns = numbers(raw); return ns === undefined ? undefined : numberSet(ns); }),
  // messaging
  "sms-over-ims": key("imssms.sms_over_ims_supported_bool", asBool),
  "sms-over-ims-networks": smsNetworks,
  "mms-max-size": key("maxMessageSize", asNum),
  "mms-max-recipients": key("recipientLimit", asNum),
  "mms-max-image": mmsImage,
  "mms-max-subject": key("maxSubjectLength", asNum, "approx"),
  "mms-group": key("enableGroupMms", asBool, "approx"),
  "mms-roaming-download": key("mmsRoamingAutoRetrieveByDefault", asBool, "approx"),
  mmsc: mmsApnField("mmsc"),
  "mms-proxy": mmsApnField("mmsProxy"),
  "mms-uaprof": key("uaProfUrl", asText),
  "mms-user-agent": key("userAgent", asText),
  // supplementary
  "ussd-over-ims": ussd,
  "ss-over-ut": defaulted("carrier_supports_ss_over_ut_bool", asBool),
  "xcap-server": key("imsss.ut_as_server_fqdn_string", lower),
  "xcap-port": key("imsss.ut_as_server_port_int", asNum),
  "bsf-server": key("bsf.bsf_server_fqdn_string", lower),
  "bsf-port": key("bsf.bsf_server_port_int", asNum),
  // emergency
  "emergency-over-ims": emergencyOverIms,
  "text-to-emergency": key("support_emergency_sms_over_ims_bool", asBool, "approx"),
  "cell-broadcast-channels": cbsChannels,
  // data
  "apn-internet": apnName("default"),
  "apn-mms": apnName("mms"),
  "apn-ims": apnName("ims"),
  "apn-emergency": apnName("emergency"),
  "apn-xcap": apnName("xcap"),
  "apn-attach": apnName("ia"),
  "internet-ip": apnField("default", "protocol"),
  "internet-ip-roaming": apnField("default", "roamingProtocol"),
  "data-mtu": dataMtu,
  "tethering-apn": apnName("dun"),
  // roaming, display, voicemail, satellite, entitlement, signal
  "home-networks": homeNetworks,
  "data-roaming-default": defaulted("carrier_default_data_roaming_enabled_bool", asBool),
  "carrier-name": key("carrier_name_string", asText, "approx"),
  "country-iso": key("sim_country_iso_override_string", lower),
  "voicemail-number": key("default_vm_number_string", asText),
  "voicemail-roaming-number": key("default_vm_number_roaming_string", asText),
  "satellite-name": key("satellite_display_name_string", asText),
  "entitlement-server": key("imsserviceentitlement.entitlement_server_url_string", asText),
  "lte-rsrp-thresholds": key("lte_rsrp_thresholds_int_array", numbers),
  "nr-rsrp-thresholds": key("5g_nr_ssrsrp_thresholds_int_array", numbers),
};

/** Every concept Android can express, read from one view. */
export function androidConcepts(v: AndroidView): Record<string, ConceptValue> {
  const out: Record<string, ConceptValue> = {};
  for (const [id, reader] of Object.entries(ANDROID_READERS)) {
    const value = reader?.(v);
    if (value) out[id] = value;
  }
  return out;
}

