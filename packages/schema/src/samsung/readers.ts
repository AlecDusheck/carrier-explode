/**
 * How a Samsung carrier pack answers each concept: its APNs, the CarrierFeature switches its whole pack sets, and its
 * operator's entries in the firmware's IMS service. A concept is unset unless every IMS value deciding it is set, so a
 * reading over the entries alone holds over the service's defaults too.
 */

import { apnField, apnName } from "../apn-readings.ts";
import { readConcepts, type Readers } from "../concepts.ts";
import type { Apn, ConceptValue, Fidelity, Json, NativeRef } from "../types.ts";
import {
	bool,
	mmsProxyAddress,
	num,
	sipUri,
	stateReading,
	stringSet,
	text,
	unset,
	valueReading,
	type StateReading,
	type Unset,
	type ValueReading,
} from "../values.ts";
import type { ImsView } from "./ims.ts";

export interface SamsungView {
	readonly apns: readonly Apn[];
	/** The pack's CarrierFeature switches, each with where it is set. */
	readonly features: ReadonlyMap<string, NativeRef>;
	/** null when the firmware's IMS service names no operator with switches for the pack's SIMs. */
	readonly ims: ImsView | null;
	/** customer.xml's GeneralInfo.CountryISO. */
	readonly countryIso: string | undefined;
	/** customer.xml's leaves by path below its root, repeated elements indexed: `Settings.Main.Network.SOSNumber[1]`. */
	readonly customer: ReadonlyMap<string, Json>;
}

/** What the IMS readers read: the operator's entries, or (for phone states) its entries over the service's defaults. */
type ImsReading = Pick<SamsungView, "ims">;

/** The Mobile networks menu's switches: `+vonrcall` shows the VoNR switch, `-voltecall` hides VoLTE's. */
const MENU = "CarrierFeature_VoiceCall_ConfigOpStyleMobileNetworkSettingMenu";

/** A `+token`/`-token` of the menu feature: the switch shown or hidden, unset when the pack says neither. */
function menuSwitch(token: string): (v: SamsungView) => ValueReading<boolean> | Unset {
	return ({ features }) => {
		const ref = features.get(MENU);
		const tokens = typeof ref?.value === "string" ? ref.value.split(",").map((t) => t.trim()) : [];
		if (ref === undefined) return unset;
		if (tokens.includes(`+${token}`)) return valueReading(true, [ref]);
		if (tokens.includes(`-${token}`)) return valueReading(false, [ref]);
		return unset;
	};
}

/** An imsswitch.json service of the operator: on when IMS (`enableIms`) and the service are both on. */
function imsSwitches(ims: ImsView | null, key: string): { on: boolean; refs: NativeRef[] } | undefined {
	const gate = ims?.switch("enableIms");
	if (ims === null || gate === undefined || typeof gate.value !== "boolean") return undefined;
	if (!gate.value) return { on: false, refs: [gate] };
	const service = ims.switch(key);
	return service === undefined || typeof service.value !== "boolean"
		? undefined
		: { on: service.value, refs: [gate, service] };
}

function imsService(key: string): (v: ImsReading) => StateReading | Unset {
	return ({ ims }) => {
		const s = imsSwitches(ims, key);
		return s === undefined ? unset : stateReading(s.on ? "on" : "no", s.refs);
	};
}

/** One field of the operator's first IMS profile. */
function imsProfile<T extends Json>(
	key: string,
	convert: (v: unknown) => T | undefined,
	fidelity: Fidelity = "exact",
): (v: ImsReading) => ValueReading<T> | Unset {
	return ({ ims }) => {
		const r = ims?.profile(key);
		const value = r === undefined ? undefined : convert(r.value);
		return r === undefined || value === undefined ? unset : valueReading(value, [r], fidelity);
	};
}

/** imsprofile.json's `timer`: `1:2000,2:16000,4:17000,A:2000,B:128000,…`, RFC 3261's T1, T2, T4 and A–K, in ms. */
function sipTimer(name: string): (v: ImsReading) => ValueReading<number> | Unset {
	return imsProfile("timer", (raw) => {
		const pair =
			typeof raw === "string"
				? raw
						.split(",")
						.map((p) => p.split(":"))
						.find(([k]) => k === name)
				: undefined;
		return pair?.[1] === undefined ? undefined : num(pair[1]);
	});
}

/** imsprofile.json's `audio_codec` names, as the concept names codecs: its octet-aligned and bandwidth-efficient AMRs are one. */
const CODECS: ReadonlyMap<string, string> = new Map([
	["AMR", "AMR"],
	["AMRBE", "AMR"],
	["AMROPEN", "AMR"],
	["AMR-WB", "AMR-WB"],
	["AMRBE-WB", "AMR-WB"],
	["EVS", "EVS"],
	["EVS_A2", "EVS"],
]);
const audioCodecs = (raw: unknown): string[] | undefined =>
	typeof raw === "string" ? stringSet(raw.split(",").flatMap((c) => CODECS.get(c.trim()) ?? [])) : undefined;

const evs = ({ ims }: ImsReading): StateReading | Unset => {
	const r = ims?.profile("enable_evs_codec");
	return r === undefined || typeof r.value !== "boolean" ? unset : stateReading(r.value ? "on" : "no", [r]);
};

/** One customer.xml leaf, converted. */
function customer<T extends Json>(
	path: string,
	convert: (v: string) => T | undefined,
	fidelity: Fidelity = "exact",
): (v: SamsungView) => ValueReading<T> | Unset {
	return ({ customer: leaves }) => {
		const raw = leaves.get(path);
		const value = typeof raw === "string" ? convert(raw) : undefined;
		return raw === undefined || value === undefined
			? unset
			: valueReading(value, [{ path: `customer.xml:${path}`, value: raw }], fidelity);
	};
}

/** A customer.xml leaf, else a CarrierFeature: packs set the MMS identity in one or the other. */
function customerOrFeature(path: string, feature: string): (v: SamsungView) => ValueReading<string> | Unset {
	const fromCustomer = customer(path, text);
	return (v) => {
		const c = fromCustomer(v);
		if (c.kind !== "unset") return c;
		const ref = v.features.get(feature);
		const value = text(ref?.value);
		return ref === undefined || value === undefined ? unset : valueReading(value, [ref]);
	};
}

const onOff = (v: string): boolean | undefined => (v === "on" ? true : v === "off" ? false : undefined);

/** `1m`, `1.2m`, `300k`: MMS size limits in binary units. A bare number states no unit, so it is not read. */
function mmsSize(v: string): number | undefined {
	const m = /^(\d+(?:\.\d+)?)([km])$/i.exec(v.trim());
	return m?.[1] === undefined || m[2] === undefined
		? undefined
		: Math.round(Number(m[1]) * (m[2].toLowerCase() === "m" ? 1024 * 1024 : 1024));
}

/** ImageResizeResolution's display standards, by their longer side. */
const IMAGE_SIDES: ReadonlyMap<string, number> = new Map([
	["uxga", 1600],
	["qsxga", 2560],
]);

/** MmsReceiving's modes: `auto` downloads at once, `manual` waits to be asked. */
const AUTO_DOWNLOAD: ReadonlyMap<string, boolean> = new Map([
	["auto", true],
	["manual", false],
]);

/** customer.xml's SOSNumber list. */
const emergencyNumbers = ({ customer: leaves }: SamsungView): ValueReading<string[]> | Unset => {
	const refs = [...leaves]
		.filter(([k]) => /^Settings\.Main\.Network\.SOSNumber(\[\d+\])?$/.test(k))
		.flatMap(([k, v]): NativeRef[] =>
			typeof v === "string" ? [{ path: `customer.xml:${k}`, value: v }] : [],
		);
	return refs.length === 0
		? unset
		: valueReading(stringSet(refs.map((r) => String(r.value))), refs, "approx");
};

/** One globalsettings.json value of the operator, as its schema's enum documents it. */
function imsSetting<T extends Json>(
	key: string,
	convert: (v: unknown) => T | undefined,
	fidelity: Fidelity = "exact",
): (v: ImsReading) => ValueReading<T> | Unset {
	return ({ ims }) => {
		const r = ims?.setting(key);
		const value = r === undefined ? undefined : convert(r.value);
		return r === undefined || value === undefined ? unset : valueReading(value, [r], fidelity);
	};
}

/** ss_domain_setting: `CS`/`CS_ALWAYS` never use Ut; `PS`, `PS_ALWAYS` and the PS-only-when-registered modes use XCAP. */
const SS_DOMAINS: ReadonlyMap<unknown, boolean> = new Map([
	["CS", false],
	["CS_ALWAYS", false],
	["PS", true],
	["PS_ALWAYS", true],
	["PS_ONLY_VOLTEREGIED", true],
	["PS_ONLY_PSREGIED", true],
]);
/** ussd_domain_setting: `PSCS` tries IMS first, then CS. */
const USSD_DOMAINS: ReadonlyMap<unknown, boolean> = new Map([
	["CS", false],
	["PS", true],
	["PSCS", true],
]);
const EMERGENCY_DOMAINS: ReadonlyMap<unknown, boolean> = new Map([
	["CS", false],
	["PS", true],
]);

const countryIso = ({ countryIso: iso }: SamsungView): ValueReading<string> | Unset =>
	iso === undefined
		? unset
		: valueReading(iso.toLowerCase(), [{ path: "customer.xml:GeneralInfo.CountryISO", value: iso }]);

const mmsProxy = ({ apns }: SamsungView): ValueReading<string> | Unset => {
	const a = apns.find((x) => x.types.includes("mms") && x.mmsProxy !== undefined);
	if (a?.mmsProxy === undefined) return unset;
	return valueReading(mmsProxyAddress(a.mmsProxy, a.mmsPort), [
		{ path: `${a.path}.Proxy`, value: a.mmsProxy },
	]);
};

const IMS_READERS = {
	volte: imsService("enableServiceVolte"),
	"wifi-calling": imsService("enableServiceVowifi"),
	"video-calling": imsService("enableServiceVilte"),
	rcs: imsService("enableServiceRcs"),
	"sms-over-ims": ({ ims }: ImsReading): ValueReading<boolean> | Unset => {
		const s = imsSwitches(ims, "enableServiceSmsip");
		return s === undefined ? unset : valueReading(s.on, s.refs);
	},
	"sip-ipsec": imsProfile("support_ipsec", bool),
	"ims-user-agent": imsProfile("useragent", text),
	"hd-voice-plus": evs,
	"audio-codecs": imsProfile("audio_codec", audioCodecs),
	"sip-precondition": imsProfile("use_precondition", bool),
	"conference-uri": imsProfile("conference_uri", (raw) => {
		const t = text(raw);
		return t === undefined ? undefined : sipUri(t);
	}),
	"session-expires": imsProfile("session_expires", num),
	"ims-registration-expiry": imsProfile("reg_expires", num),
	"sip-timer-t1": sipTimer("1"),
	"sip-timer-t2": sipTimer("2"),
	"sip-timer-t4": sipTimer("4"),
	"sip-timer-b": sipTimer("B"),
	"sip-timer-d": sipTimer("D"),
	"sip-timer-f": sipTimer("F"),
	"sip-timer-h": sipTimer("H"),
	"sip-timer-j": sipTimer("J"),
	"ussd-over-ims": imsSetting("ussd_domain_setting", (v) => USSD_DOMAINS.get(v), "approx"),
	"ss-over-ut": imsSetting("ss_domain_setting", (v) => SS_DOMAINS.get(v)),
	"bsf-server": imsSetting("bsf_ip", (v) => text(v)?.toLowerCase()),
	// A port names nothing without a server.
	"bsf-port": (v: ImsReading) =>
		text(v.ims?.setting("bsf_ip")?.value) === undefined ? unset : imsSetting("bsf_port", num)(v),
	"emergency-over-ims": imsSetting("emergency_domain_setting", (v) => EMERGENCY_DOMAINS.get(v), "approx"),
} satisfies Readers<ImsReading>;

const SAMSUNG_READERS = {
	...IMS_READERS,
	"emergency-numbers": emergencyNumbers,
	"mms-max-size": customer("Settings.Messages.MMS.MmsSending.MessageSize", mmsSize, "approx"),
	"mms-max-recipients": customer("Settings.Messages.MMS.MmsSending.MaxRecipientMMS", num),
	"mms-max-image": customer(
		"Settings.Messages.MMS.MmsSending.ImageResizeResolution",
		(v) => IMAGE_SIDES.get(v.toLowerCase()),
		"derived",
	),
	"mms-group": customer("Settings.Messages.MMS.GroupMessaging", onOff, "approx"),
	"mms-roaming-download": customer("Settings.Messages.MMS.MmsReceiving.Roaming", (v) =>
		AUTO_DOWNLOAD.get(v.toLowerCase()),
	),
	"mms-uaprof": customerOrFeature(
		"Settings.Messages.MMS.MMSView.MessageUaProfUrl",
		"CarrierFeature_Message_UaProfUrl",
	),
	"mms-user-agent": customerOrFeature(
		"Settings.Messages.MMS.MMSView.MessageUserAgent",
		"CarrierFeature_Message_UserAgent",
	),
	"volte-switch": menuSwitch("voltecall"),
	"vonr-switch": menuSwitch("vonrcall"),
	mmsc: apnField("mms", "mmsc", "URL"),
	"mms-proxy": mmsProxy,
	"apn-internet": apnName("default"),
	"apn-mms": apnName("mms"),
	"apn-ims": apnName("ims"),
	"apn-emergency": apnName("emergency"),
	"apn-xcap": apnName("xcap"),
	"apn-attach": apnName("ia"),
	"internet-ip": apnField("default", "protocol", "IpVersion"),
	"internet-ip-roaming": apnField("default", "roamingProtocol", "RoamingIpVersion"),
	"data-mtu": apnField("default", "mtu", "MTUSize", "approx"),
	"tethering-apn": apnName("dun"),
	"country-iso": countryIso,
} satisfies Readers<SamsungView>;

export const SAMSUNG_CONCEPT_IDS: ReadonlySet<string> = new Set(Object.keys(SAMSUNG_READERS));

export const samsungConcepts = (v: SamsungView): Record<string, ConceptValue> =>
	readConcepts<SamsungView>(SAMSUNG_READERS, v);

export const imsConcepts = (v: ImsReading): Record<string, ConceptValue> =>
	readConcepts<ImsReading>(IMS_READERS, v);
