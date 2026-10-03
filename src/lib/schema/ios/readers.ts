/** How Apple bundles answer each concept, from the merged settings a phone runs with. Absent keys are never filled with a guessed default. */

import { FEATURES } from "#lib/features.ts";
import { isJsonDict } from "#lib/decode/index.ts";
import type { ConceptId, Readers } from "../concepts.ts";
import type { Apn, ApnType, ConceptValue, Fidelity, Json, NativeRef } from "../types.ts";
import {
  bool, iconLabel, num, numberSet, sipUri, stateReading, stringSet, text, unset, valueReading,
  type StateReading, type Unset, type ValueReading,
} from "../values.ts";
import { read, type Read, type Settings } from "./settings.ts";

export interface IosView {
  readonly settings: Settings;
  readonly apns: readonly Apn[];
}

type Valued<T extends Json> = (v: IosView) => ValueReading<T> | Unset;

/** A value at one path, converted; unset when absent or not convertible. */
function at<T extends Json>(path: string, convert: (raw: unknown) => T | undefined, fidelity: Fidelity = "exact"): Valued<T> {
  return ({ settings }) => {
    const r = read(settings, path);
    const v = r === undefined ? undefined : convert(r.value);
    return r === undefined || v === undefined ? unset : valueReading(v, [r.ref], fidelity);
  };
}

const asText = (raw: unknown): string | undefined => text(raw);
const asBool = (raw: unknown): boolean | undefined => bool(raw);
const asNum = (raw: unknown): number | undefined => num(raw);
const seconds = (raw: unknown): number | undefined => { const n = num(raw); return n === undefined ? undefined : n * 1000; };

/** The first APN carrying a type, by name. APN names are case-insensitive (3GPP TS 23.003 9.1). */
function apnName(type: ApnType): Valued<string> {
  return ({ apns }) => {
    const a = apns.find((x) => x.types.includes(type));
    return a ? valueReading(a.apn.toLowerCase(), [{ path: a.path, value: a.apn }]) : unset;
  };
}

function apnField(type: ApnType, field: "protocol" | "roamingProtocol"): Valued<string> {
  return ({ apns }) => {
    const a = apns.find((x) => x.types.includes(type));
    const v = a?.[field];
    return a && v ? valueReading(v, [{ path: `${a.path}.${field === "protocol" ? "AllowedProtocolMask" : "AllowedProtocolMaskInRoaming"}`, value: v }]) : unset;
  };
}

/** Values found under every entry of a dict or array at `path`. */
function each(r: Read | undefined): unknown[] {
  if (!r) return [];
  if (Array.isArray(r.value)) return r.value;
  return isJsonDict(r.value) ? Object.values(r.value) : [];
}

type Stated = (v: IosView) => StateReading;

/** features.ts decides; a "no" names no key, so the keys it looked at are shown instead. */
const FEATURE_READERS: ReadonlyMap<string, Stated> = new Map(FEATURES.map((f): [string, Stated] => [f.slug, ({ settings }) => {
  const { state, because } = f.decide({ ...settings.merged });
  const refs = (because.length ? because : f.keys).flatMap((p): NativeRef[] => { const r = read(settings, p); return r ? [r.ref] : []; });
  return stateReading(state, refs);
}]));

function feature(id: ConceptId): Stated {
  const reader = FEATURE_READERS.get(id);
  if (!reader) throw new Error(`features.ts has no feature ${id}`);
  return reader;
}

const CODEC_NAMES: Readonly<Record<string, string>> = { AMR: "AMR", "AMR-WB": "AMR-WB", EVS: "EVS" };

const codecs: Valued<string[]> = ({ settings }) => {
  const r = read(settings, "IMSConfig.Media.AudioCodecs");
  if (!r) return unset;
  const names = each(r).flatMap((c) => {
    const n = isJsonDict(c) ? text(c.EncodingName) : undefined;
    return n === undefined ? [] : [CODEC_NAMES[n.toUpperCase()] ?? n.toUpperCase()];
  });
  return valueReading(stringSet(names), [r.ref]);
};

/** Plain 5G runs as NSA until SA is on. */
const nrModes: Valued<string[]> = (v) => {
  const nsa = feature("5g")(v), sa = feature("5g-standalone")(v);
  const modes = [...(nsa.state !== "no" ? ["NSA"] : []), ...(sa.state !== "no" ? ["SA"] : [])];
  return valueReading(modes, [...nsa.because, ...sa.because], "derived");
};

const PRECONDITION: Readonly<Record<string, boolean>> = { supported: true, mandatory: true, required: true, none: false, disabled: false, notsupported: false };

const WFC_PREF: Readonly<Record<string, string>> = { cellular: "cellular-preferred", wifi: "wifi-preferred" };

const wfcMode = (path: string): Valued<string> =>
  at(path, (raw) => { const t = text(raw)?.toLowerCase(); return t === undefined ? undefined : WFC_PREF[t]; });

const dhGroups: Valued<number[]> = ({ settings }) => {
  const r = read(settings, "TechSettings.IKE.Proposals");
  if (!r) return unset;
  const groups = each(r).flatMap((p) => { const n = isJsonDict(p) ? num(p.DHGroup) : undefined; return n === undefined ? [] : [n]; });
  return valueReading(numberSet(groups), [r.ref]);
};

/** IMSConfig.SMS.SupportedDomains: radio -> true where texts go over IMS. */
const SMS_DOMAINS: Readonly<Record<string, string>> = { GSM: "gsm", UMTS: "umts", LTE: "lte", NR: "nr", EHRPD: "ehrpd" };

const smsDomains: Valued<string[]> = ({ settings }) => {
  const r = read(settings, "IMSConfig.SMS.SupportedDomains");
  if (!r || !isJsonDict(r.value)) return unset;
  const on = Object.entries(r.value).flatMap(([k, x]) => (x === true ? [SMS_DOMAINS[k] ?? k.toLowerCase()] : []));
  return valueReading(stringSet(on), [r.ref]);
};

const smsOverIms: Valued<boolean> = ({ settings }) => {
  const r = read(settings, "IMSConfig.SMS.SupportedDomains");
  if (!r || !isJsonDict(r.value)) return unset;
  return valueReading(Object.values(r.value).some((x) => x === true), [r.ref], "derived");
};

const mmsProxy: Valued<string> = ({ settings }) => {
  const r = read(settings, "MMS.Proxy");
  const t = text(r?.value);
  return r && t ? valueReading(t.toLowerCase(), [r.ref]) : unset;
};

/** EmergencyCalling.EmergencyNumbers[] and the per-MCC lists of EmergencyNumbers.<mcc>[]. */
const emergencyNumbers: IosReader = ({ settings }) => {
  const refs: NativeRef[] = [];
  const numbers: string[] = [];
  const take = (r: Read | undefined, list: unknown[]): void => {
    if (!r) return;
    refs.push(r.ref);
    for (const e of list) { const n = isJsonDict(e) ? text(e.Number) : undefined; if (n) numbers.push(n); }
  };
  const calling = read(settings, "EmergencyCalling.EmergencyNumbers");
  take(calling, each(calling));
  const byMcc = read(settings, "EmergencyNumbers");
  take(byMcc, each(byMcc).flatMap((l) => (Array.isArray(l) ? l : [])));
  return refs.length ? conceptValue(stringSet(numbers), refs) : unset();
};

/** CellBroadcast.MessageIDParameters3GPP[] ranges as `from-to` (decimal), single ids as `id`. */
const cbsChannels: IosReader = ({ settings }) => {
  const r = read(settings, "CellBroadcast.MessageIDParameters3GPP");
  if (!r) return unset();
  const ranges = each(r).flatMap((e) => {
    if (!isJsonDict(e)) return [];
    const from = num(e.FromServiceID), to = num(e.ToServiceID);
    if (from === undefined) return [];
    return [to === undefined || to === from ? String(from) : `${from}-${to}`];
  });
  return conceptValue(stringSet(ranges), [r.ref]);
};

/** MTU[] entries whose technology-mask covers LTE (bit 3) or NR (bit 4). */
const dataMtu: IosReader = ({ settings }) => {
  const r = read(settings, "MTU");
  if (!r) return unset();
  const sizes = each(r).flatMap((e) => {
    if (!isJsonDict(e)) return [];
    const mask = num(e["technology-mask"]) ?? 0, size = num(e.size);
    return size !== undefined && Math.floor(mask / 8) % 4 !== 0 ? [size] : [];
  });
  const size = sizes[0];
  return size === undefined ? unset([r.ref]) : conceptValue(size, [r.ref], "approx");
};

const countryIso: IosReader = ({ settings }) => {
  const r = read(settings, "ISOAlpha2CountryCode");
  const first = Array.isArray(r?.value) ? r.value[0] : r?.value;
  const t = text(first);
  return r && t ? conceptValue(t.toLowerCase(), [r.ref]) : unset();
};

const homeNetworks: IosReader = at("SupportedPLMNs", (raw) =>
  Array.isArray(raw) ? stringSet(raw.flatMap((x: unknown) => (typeof x === "string" ? [x] : []))) : undefined, "approx");

const ussd: IosReader = at("IMSConfig.Signaling.ussdEnabled", asBool, "approx");


export const IOS_READERS: Readonly<Partial<Record<ConceptId, IosReader>>> = {
  ...READERS_FEATURES,
  // voice
  rtt: at("IMSConfig.Voice.RTTSupported", asBool),
  "volte-switch": at("ShowVolteSwitch", asBool),
  "vonr-switch": at("ShowVoNRSwitch", asBool),
  "audio-codecs": codecs,
  tty: at("ShowTTY", asBool, "approx"),
  "tty-over-ims": at("IMSConfig.Voice.ttyIMSSupported", asBool),
  "sip-ipsec": at("IMSConfig.Signaling.UseIPSec", asBool),
  "sip-precondition": at("IMSConfig.Signaling.Preconditions", (raw) => { const t = text(raw)?.toLowerCase(); return t === undefined ? undefined : PRECONDITION[t]; }),
  "prack-18x": at("IMSConfig.Signaling.AlwaysPrack18x", asBool, "approx"),
  "conference-uri": at("IMSConfig.ConferenceCalling.conferenceServer", (raw) => { const t = text(raw); return t === undefined ? undefined : sipUri(t); }),
  "conference-size": at("MaxMultiPartyCalls", asNum, "approx"),
  "ringing-timer": at("IMSConfig.Signaling.RingingTimerSeconds", seconds),
  "ringback-timer": at("IMSConfig.Signaling.RingbackTimerSeconds", seconds),
  "session-expires": at("IMSConfig.Signaling.SessionExpiresSeconds", asNum),
  "ims-registration-expiry": at("IMSConfig.Signaling.RegistrationExpirationSeconds", asNum),
  "ims-retry-base": at("IMSConfig.Signaling.RegistrationRetryBaseTimeSeconds", seconds),
  "ims-retry-max": at("IMSConfig.Signaling.RegistrationRetryMaxTimeSeconds", seconds),
  "sip-timer-t1": at("IMSConfig.Signaling.SipTimers.T1", asNum),
  "sip-timer-t2": at("IMSConfig.Signaling.SipTimers.T2", asNum),
  "sip-timer-t4": at("IMSConfig.Signaling.SipTimers.T4", asNum),
  "sip-timer-b": at("IMSConfig.Signaling.SipTimers.B", asNum),
  "sip-timer-d": at("IMSConfig.Signaling.SipTimers.D", asNum),
  "sip-timer-f": at("IMSConfig.Signaling.SipTimers.F", asNum),
  "sip-timer-h": at("IMSConfig.Signaling.SipTimers.H", asNum),
  "sip-timer-j": at("IMSConfig.Signaling.SipTimers.J", asNum),
  "sip-udp-limit": at("IMSConfig.Signaling.MaxUdpMessageSize", asNum, "approx"),
  "rtp-inactivity": at("IMSConfig.Media.InactivityTimerRTPSeconds", seconds),
  "rtcp-inactivity": at("IMSConfig.Media.InactivityTimerRTCPSeconds", seconds),
  "ims-user-agent": at("IMSConfig.Signaling.UserAgentHeaderValue", asText, "approx"),
  // nr
  "nr-modes": nrModes,
  "5g-switch": at("Show5GSwitch", asBool),
  "5g-icon-advanced": at("DataIndicatorOverrideForNRMmwave", (raw) => { const t = text(raw); return t === undefined ? undefined : iconLabel(t); }),
  "lte-icon": at("DataIndicatorOverrideForLTE", (raw) => { const t = text(raw); return t === undefined ? undefined : iconLabel(t); }),
  // wifi-calling
  "wfc-mode": wfcMode("TechSettings.iRatPolicies.PreferredTechnology"),
  "wfc-roaming-mode": wfcMode("TechSettings.iRatPolicies.PreferredTechnologyRoaming"),
  "wfc-roaming": at("TechSettings.WifiCallingAllowedInRoaming", asBool, "approx"),
  "epdg-address": at("TechSettings.IKE.RemoteAddress", (raw) => text(raw)?.toLowerCase()),
  "ike-dh-groups": dhGroups,
  "wifi-calling-name": at("OverrideOperatorWiFiName", asText),
  // messaging
  "sms-over-ims": smsOverIms,
  "sms-over-ims-networks": smsDomains,
  "mms-max-size": at("MMS.MaxMessageSize", asNum),
  "mms-max-recipients": at("MMS.MaxRecipients", asNum),
  "mms-max-image": mmsImage,
  "mms-max-subject": at("MMS.MaxSubjectLenBytes", asNum, "approx"),
  "mms-group": at("MMS.GroupModeEnabled", asBool, "approx"),
  "mms-roaming-download": at("MMS.OnWhileRoaming", asBool, "approx"),
  mmsc: at("MMS.MMSC", asText),
  "mms-proxy": mmsProxy,
  "mms-uaprof": at("MMS.UAProf", asText),
  "mms-user-agent": at("MMS.UAString", asText),
  // supplementary
  "ussd-over-ims": ussd,
  "ss-over-ut": at("IMSConfig.XCAP.supported", asBool),
  "xcap-server": at("IMSConfig.XCAP.NafHost", (raw) => text(raw)?.toLowerCase()),
  "xcap-port": at("IMSConfig.XCAP.NafPort", asNum),
  "bsf-server": at("IMSConfig.XCAP.BsfHost", (raw) => text(raw)?.toLowerCase()),
  "bsf-port": at("IMSConfig.XCAP.BsfPort", asNum),
  // emergency
  "emergency-over-ims": at("IMSConfig.Voice.E911OverIMSSupported", asBool),
  "emergency-numbers": emergencyNumbers,
  "text-to-emergency": at("SMSSettings.SupportsTextToEmergency", asBool, "approx"),
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
  // roaming, display, voicemail, satellite, entitlement
  "home-networks": homeNetworks,
  "carrier-name": at("CarrierName", asText),
  "country-iso": countryIso,
  "voicemail-number": at("VoicemailPilotNumber", asText),
  "voicemail-roaming-number": at("RoamingVoicemailPilotNumber", asText),
  "satellite-name": at("SatelliteSystemName", asText),
  "entitlement-server": at("CarrierEntitlements.ServerAddress", asText),
};

/** Every concept iOS can express, read from one view. */
export function iosConcepts(v: IosView): Record<string, ConceptValue> {
  const out: Record<string, ConceptValue> = {};
  for (const [id, reader] of Object.entries(IOS_READERS)) {
    const value = reader?.(v);
    if (value) out[id] = value;
  }
  return out;
}
