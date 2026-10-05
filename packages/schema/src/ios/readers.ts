/** How Apple bundles answer each concept, from the merged settings a phone runs with. Absent keys are never filled with a guessed default. */

import { isJsonDict } from "@carrier-explode/decode-ios";
import { apnField, apnName } from "../apn-readings.ts";
import { readConcepts, type Readers } from "../concepts.ts";
import type { Apn, ConceptValue, Fidelity, Json, NativeRef } from "../types.ts";
import { bool, hasBit, iconLabel, mmsProxyAddress, num, numberSet, sipUri, stringSet, text, unset, valueReading, type Unset, type ValueReading } from "../values.ts";
import { appleFeature, type AppleFeatureSlug } from "./features.ts";
import { FIVE_G_SWITCH } from "./radio.ts";
import { members, read, type Settings } from "./settings.ts";

interface IosView {
  readonly settings: Settings;
  readonly apns: readonly Apn[];
}

type Valued<T extends Json> = (v: IosView) => ValueReading<T> | Unset;

/** The value at `path`, converted; unset when absent or not convertible. */
function at<T extends Json>(path: string, convert: (raw: unknown) => T | undefined, fidelity: Fidelity = "exact"): Valued<T> {
  return ({ settings }) => {
    const r = read(settings, path);
    const v = r === undefined ? undefined : convert(r.value);
    return r === undefined || v === undefined ? unset : valueReading(v, [r.ref], fidelity);
  };
}

/** A list at `path`, each member converted; unset when the path is absent. */
function list<T extends Json>(path: string, convert: (member: unknown) => T | undefined, collect: (xs: T[]) => T[]): Valued<T[]> {
  return at(path, (raw) => collect(members(raw).flatMap((m) => { const v = convert(m); return v === undefined ? [] : [v]; })));
}

const seconds = (raw: unknown): number | undefined => { const n = num(raw); return n === undefined ? undefined : n * 1000; };
const lower = (raw: unknown): string | undefined => text(raw)?.toLowerCase();
const field = (key: string) => (member: unknown): unknown => (isJsonDict(member) ? member[key] : undefined);
const fromMap = <T extends Json>(map: ReadonlyMap<string, T>) => (raw: unknown): T | undefined => { const t = lower(raw); return t === undefined ? undefined : map.get(t); };

const codec = (m: unknown): string | undefined => text(field("EncodingName")(m))?.toUpperCase();

/** Plain 5G runs as NSA until SA is on. */
const nrModes: Valued<string[]> = (v) => {
  const nsa = appleFeature("5g")(v), sa = appleFeature("5g-standalone")(v);
  const modes = [...(nsa.state === "no" ? [] : ["NSA"]), ...(sa.state === "no" ? [] : ["SA"])];
  return valueReading(modes, [...nsa.because, ...sa.because], "derived");
};

const PRECONDITION: ReadonlyMap<string, boolean> = new Map([
  ["supported", true], ["mandatory", true], ["required", true], ["none", false], ["disabled", false], ["notsupported", false],
]);

const WFC_PREF: ReadonlyMap<string, string> = new Map([["cellular", "cellular-preferred"], ["wifi", "wifi-preferred"]]);

/** IMSConfig.SMS.SupportedDomains: radio -> true where texts go over IMS. */
const SMS_DOMAINS: ReadonlyMap<string, string> = new Map([["GSM", "gsm"], ["UMTS", "umts"], ["LTE", "lte"], ["NR", "nr"], ["EHRPD", "ehrpd"]]);

const imsDomains = (raw: unknown): string[] | undefined =>
  isJsonDict(raw) ? stringSet(Object.entries(raw).flatMap(([k, x]) => (x === true ? [SMS_DOMAINS.get(k) ?? k.toLowerCase()] : []))) : undefined;

/** EmergencyCalling.EmergencyNumbers[] and the per-MCC lists of EmergencyNumbers.<mcc>[]. */
const emergencyNumbers: Valued<string[]> = ({ settings }) => {
  const calling = read(settings, "EmergencyCalling.EmergencyNumbers");
  const byMcc = read(settings, "EmergencyNumbers");
  const reads = [calling, byMcc].flatMap((r) => r ?? []);
  const entries = [...members(calling?.value), ...members(byMcc?.value).flatMap(members)];
  const numbers = stringSet(entries.flatMap((e) => text(field("Number")(e)) ?? []));
  return reads.length > 0 ? valueReading(numbers, reads.map((r): NativeRef => r.ref)) : unset;
};

/** CellBroadcast.MessageIDParameters3GPP[] as `from-to` ranges (decimal), single ids as `id`. */
const cbsRange = (m: unknown): string | undefined => {
  const from = num(field("FromServiceID")(m)), to = num(field("ToServiceID")(m));
  if (from === undefined) return undefined;
  return to === undefined || to === from ? String(from) : `${from}-${to}`;
};

/** The first MTU[] entry whose technology-mask covers LTE (bit 3) or NR (bit 4). */
const lteMtu = (raw: unknown): number | undefined =>
  members(raw).flatMap((e) => {
    const mask = num(field("technology-mask")(e)) ?? 0, size = num(field("size")(e));
    return size !== undefined && (hasBit(mask, 3) || hasBit(mask, 4)) ? [size] : [];
  })[0];

const firstIso = (raw: unknown): string | undefined => lower(Array.isArray(raw) ? raw[0] : raw);

const plmns = (raw: unknown): string[] | undefined =>
  Array.isArray(raw) ? stringSet(raw.flatMap((x: unknown) => (typeof x === "string" ? [x] : []))) : undefined;

const IOS_READERS = {
  "5g": appleFeature("5g"),
  "5g-standalone": appleFeature("5g-standalone"),
  "voice-over-5g": appleFeature("voice-over-5g"),
  volte: appleFeature("volte"),
  "hd-voice-plus": appleFeature("hd-voice-plus"),
  "wifi-calling": appleFeature("wifi-calling"),
  "calls-on-other-devices": appleFeature("calls-on-other-devices"),
  rcs: appleFeature("rcs"),
  "rcs-business-messaging": appleFeature("rcs-business-messaging"),
  satellite: appleFeature("satellite"),
  "visual-voicemail": appleFeature("visual-voicemail"),
  "esim-transfer": appleFeature("esim-transfer"),
  "esim-from-android": appleFeature("esim-from-android"),
  "apple-watch-number-sharing": appleFeature("apple-watch-number-sharing"),
  "branded-calling": appleFeature("branded-calling"),
  "spam-call-warnings": appleFeature("spam-call-warnings"),
  rtt: at("IMSConfig.Voice.RTTSupported", bool),
  "volte-switch": at("ShowVolteSwitch", bool),
  "vonr-switch": at("ShowVoNRSwitch", bool),
  "audio-codecs": list("IMSConfig.Media.AudioCodecs", codec, stringSet),
  tty: at("ShowTTY", bool, "approx"),
  "tty-over-ims": at("IMSConfig.Voice.ttyIMSSupported", bool),
  "sip-ipsec": at("IMSConfig.Signaling.UseIPSec", bool),
  "sip-precondition": at("IMSConfig.Signaling.Preconditions", fromMap(PRECONDITION)),
  "prack-18x": at("IMSConfig.Signaling.AlwaysPrack18x", bool, "approx"),
  "conference-uri": at("IMSConfig.ConferenceCalling.conferenceServer", (raw) => { const t = text(raw); return t === undefined ? undefined : sipUri(t); }),
  "conference-size": at("MaxMultiPartyCalls", num, "approx"),
  "ringing-timer": at("IMSConfig.Signaling.RingingTimerSeconds", seconds),
  "ringback-timer": at("IMSConfig.Signaling.RingbackTimerSeconds", seconds),
  "session-expires": at("IMSConfig.Signaling.SessionExpiresSeconds", num),
  "ims-registration-expiry": at("IMSConfig.Signaling.RegistrationExpirationSeconds", num),
  "ims-retry-base": at("IMSConfig.Signaling.RegistrationRetryBaseTimeSeconds", seconds),
  "ims-retry-max": at("IMSConfig.Signaling.RegistrationRetryMaxTimeSeconds", seconds),
  "sip-timer-t1": at("IMSConfig.Signaling.SipTimers.T1", num),
  "sip-timer-t2": at("IMSConfig.Signaling.SipTimers.T2", num),
  "sip-timer-t4": at("IMSConfig.Signaling.SipTimers.T4", num),
  "sip-timer-b": at("IMSConfig.Signaling.SipTimers.B", num),
  "sip-timer-d": at("IMSConfig.Signaling.SipTimers.D", num),
  "sip-timer-f": at("IMSConfig.Signaling.SipTimers.F", num),
  "sip-timer-h": at("IMSConfig.Signaling.SipTimers.H", num),
  "sip-timer-j": at("IMSConfig.Signaling.SipTimers.J", num),
  "sip-udp-limit": at("IMSConfig.Signaling.MaxUdpMessageSize", num, "approx"),
  "rtp-inactivity": at("IMSConfig.Media.InactivityTimerRTPSeconds", seconds),
  "rtcp-inactivity": at("IMSConfig.Media.InactivityTimerRTCPSeconds", seconds),
  "ims-user-agent": at("IMSConfig.Signaling.UserAgentHeaderValue", text, "approx"),
  "nr-modes": nrModes,
  "5g-switch": at(FIVE_G_SWITCH, bool),
  "5g-icon-advanced": at("DataIndicatorOverrideForNRMmwave", (raw) => { const t = text(raw); return t === undefined ? undefined : iconLabel(t); }),
  "lte-icon": at("DataIndicatorOverrideForLTE", (raw) => { const t = text(raw); return t === undefined ? undefined : iconLabel(t); }),
  "wfc-mode": at("TechSettings.iRatPolicies.PreferredTechnology", fromMap(WFC_PREF)),
  "wfc-roaming-mode": at("TechSettings.iRatPolicies.PreferredTechnologyRoaming", fromMap(WFC_PREF)),
  "wfc-roaming": at("TechSettings.WifiCallingAllowedInRoaming", bool, "approx"),
  "epdg-address": at("TechSettings.IKE.RemoteAddress", lower),
  "ike-dh-groups": list("TechSettings.IKE.Proposals", (m) => num(field("DHGroup")(m)), numberSet),
  "wifi-calling-name": at("OverrideOperatorWiFiName", text),
  "sms-over-ims": at("IMSConfig.SMS.SupportedDomains", (raw) => { const on = imsDomains(raw); return on === undefined ? undefined : on.length > 0; }, "derived"),
  "sms-over-ims-networks": at("IMSConfig.SMS.SupportedDomains", imsDomains),
  "mms-max-size": at("MMS.MaxMessageSize", num),
  "mms-max-recipients": at("MMS.MaxRecipients", num),
  "mms-max-image": at("MMS.MaxImageDimension", num),
  "mms-max-subject": at("MMS.MaxSubjectLenBytes", num, "approx"),
  "mms-group": at("MMS.GroupModeEnabled", bool, "approx"),
  "mms-roaming-download": at("MMS.OnWhileRoaming", bool, "approx"),
  mmsc: at("MMS.MMSC", text),
  "mms-proxy": at("MMS.Proxy", (raw) => {
    const [host, port] = lower(raw)?.split(":") ?? [];
    return host === undefined ? undefined : mmsProxyAddress(host, port);
  }),
  "mms-uaprof": at("MMS.UAProf", text),
  "mms-user-agent": at("MMS.UAString", text),
  "ussd-over-ims": at("IMSConfig.Signaling.ussdEnabled", bool, "approx"),
  "ss-over-ut": at("IMSConfig.XCAP.supported", bool),
  "xcap-server": at("IMSConfig.XCAP.NafHost", lower),
  "xcap-port": at("IMSConfig.XCAP.NafPort", num),
  "bsf-server": at("IMSConfig.XCAP.BsfHost", lower),
  "bsf-port": at("IMSConfig.XCAP.BsfPort", num),
  "emergency-over-ims": at("IMSConfig.Voice.E911OverIMSSupported", bool),
  "emergency-numbers": emergencyNumbers,
  "text-to-emergency": at("SMSSettings.SupportsTextToEmergency", bool, "approx"),
  "cell-broadcast-channels": list("CellBroadcast.MessageIDParameters3GPP", cbsRange, stringSet),
  "apn-internet": apnName("default"),
  "apn-mms": apnName("mms"),
  "apn-ims": apnName("ims"),
  "apn-emergency": apnName("emergency"),
  "apn-xcap": apnName("xcap"),
  "apn-attach": apnName("ia"),
  "internet-ip": apnField("default", "protocol", "AllowedProtocolMask"),
  "internet-ip-roaming": apnField("default", "roamingProtocol", "AllowedProtocolMaskInRoaming"),
  "data-mtu": at("MTU", lteMtu, "approx"),
  "tethering-apn": apnName("dun"),
  // Includes the carrier's own networks; Android lists only the extra ones.
  "home-networks": at("SupportedPLMNs", plmns, "approx"),
  "carrier-name": at("CarrierName", text),
  "country-iso": at("ISOAlpha2CountryCode", firstIso),
  "voicemail-number": at("VoicemailPilotNumber", text),
  "voicemail-roaming-number": at("RoamingVoicemailPilotNumber", text),
  "satellite-name": at("SatelliteSystemName", text),
  "entitlement-server": at("CarrierEntitlements.ServerAddress", text),
} satisfies Readers<IosView> & Record<AppleFeatureSlug, unknown>;

/** The concepts Apple's bundles can express. */
export const IOS_CONCEPT_IDS: ReadonlySet<string> = new Set(Object.keys(IOS_READERS));

export const iosConcepts = (v: IosView): Record<string, ConceptValue> => readConcepts<IosView>(IOS_READERS, v);
