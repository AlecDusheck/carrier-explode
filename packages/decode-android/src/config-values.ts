/**
 * CarrierConfig values with a format of their own, read the way the AOSP code that consumes each key
 * reads it (named beside each reader). A key without a reader here is a plain value.
 */

/** AccessNetworkConstants.AccessNetworkType.fromString. */
export const ACCESS_NETWORKS = ["GERAN", "UTRAN", "EUTRAN", "CDMA2000", "IWLAN", "NGRAN", "UNKNOWN"] as const;
export type AccessNetwork = (typeof ACCESS_NETWORKS)[number];

/** DataUtils.getNetworkCapabilityFromString: the capabilities a rule may name. */
export const NET_CAPABILITIES = [
	"MMS",
	"SUPL",
	"DUN",
	"FOTA",
	"IMS",
	"CBS",
	"XCAP",
	"EIMS",
	"INTERNET",
	"MCX",
	"VSIM",
	"BIP",
	"ENTERPRISE",
	"PRIORITIZE_BANDWIDTH",
	"PRIORITIZE_LATENCY",
	"RCS",
] as const;
export type NetCapability = (typeof NET_CAPABILITIES)[number];

/** NetworkTypeController.ALL_STATES: the 5G states icons and timers are keyed by. */
export const NR_STATES = [
	"connected_mmwave",
	"connected",
	"connected_rrc_idle",
	"not_restricted_rrc_idle",
	"not_restricted_rrc_con",
	"restricted",
	"legacy",
] as const;
export type NrState = (typeof NR_STATES)[number];

/** One entry of a list value: read, or kept as written with why the platform would not use it. */
export type Entry<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly text: string; readonly reason: string };

/** DataNetworkController.HandoverRule. */
export interface HandoverRule {
	readonly type: "allowed" | "disallowed";
	readonly source: readonly AccessNetwork[];
	readonly target: readonly AccessNetwork[];
	readonly roamingOnly: boolean;
	/** Empty: any capability. */
	readonly capabilities: readonly NetCapability[];
}

/** DataRetryManager.DataSetupRetryRule. */
export interface RetryRule {
	/** Empty: whatever the failed request asked for. */
	readonly capabilities: readonly NetCapability[];
	/** DataFailCause codes; empty: any cause. */
	readonly failCauses: readonly number[];
	/** The causes are permanent: no timed retry on this APN, `intervalsMs` paces the next APN. */
	readonly permanent: boolean;
	readonly intervalsMs: readonly number[];
	readonly maxRetries: number;
	/** Keys the platform skips over. */
	readonly ignored: readonly string[];
}

export interface NrIcon {
	readonly state: NrState;
	/** As the config spells it. */
	readonly icon: "5G" | "5G_Plus" | "None";
}

export interface NrIconTimer {
	readonly from: NrState | "any";
	readonly to: NrState | "any";
	readonly seconds: number;
}

/** CarrierConfigManager.CARRIER_NR_AVAILABILITY_*. */
export type NrMode = "NSA" | "SA";

/** Four thresholds splitting a measurement's range into five signal levels. */
export interface SignalLevels {
	/** `LTE RSRP`, `NR SS-SINR`. */
	readonly measure: string;
	readonly unit: "dBm" | "dB";
	readonly min: number;
	readonly max: number;
	readonly thresholds: readonly [number, number, number, number];
}

/** ImsPhoneCallTracker's ImsReasonInfo remapping; null matches any. */
export interface ReasonRemap {
	readonly from: number | null;
	readonly message: string | null;
	readonly to: number;
}

/** UiccAccessRule.decodeRulesFromCarrierConfig. */
export interface CarrierCertificate {
	readonly digest: "SHA-1" | "SHA-256";
	readonly hash: string;
	/** Empty: any package signed by it. */
	readonly packages: readonly string[];
}

/** Each format a reader produces, by name. */
export interface ConfigFormats {
	readonly "handover-rules": readonly Entry<HandoverRule>[];
	readonly "retry-rules": readonly Entry<RetryRule>[];
	readonly "nr-icons": readonly Entry<NrIcon>[];
	readonly "nr-icon-timers": readonly Entry<NrIconTimer>[];
	readonly "nr-modes": readonly Entry<NrMode>[];
	readonly "signal-levels": SignalLevels;
	readonly "reason-remaps": readonly Entry<ReasonRemap>[];
	readonly certificates: readonly Entry<CarrierCertificate>[];
}
export type ConfigFormat = keyof ConfigFormats;

/** A value in one format, paired with its name so a view can be picked for it. */
export type DecodedConfig<F extends ConfigFormat = ConfigFormat> = {
	[K in F]: { readonly format: K; readonly value: ConfigFormats[K] };
}[F];

/** A value with a reader: decoded, or not understood as a whole. */
export type ConfigReading =
	| { readonly kind: "decoded"; readonly decoded: DecodedConfig }
	| { readonly kind: "not-understood"; readonly reason: string };

class Rejected extends Error {}
const reject = (reason: string): never => {
	throw new Rejected(reason);
};

const oneOf = <T extends string>(names: readonly T[], word: string, what: string): T =>
	names.find((n) => n === word) ?? reject(`unknown ${what} ${word}`);

const lookup = <T>(table: Readonly<Record<string | number, T>>, k: string | number, what: string): T =>
	(Object.hasOwn(table, k) ? table[k] : undefined) ?? reject(`unknown ${what} ${k}`);

/** Java's Integer.parseInt / Long.valueOf. */
const integer = (s: string): number => (/^[+-]?\d+$/.test(s) ? Number(s) : reject(`${s} is not an integer`));

/** `key=value, key=value`, as both rule parsers split it. */
function expressions(text: string): Array<readonly [string, string]> {
	return text
		.trim()
		.toLowerCase()
		.split(/\s*,\s*/)
		.map((e) => {
			const tokens = e.trim().split(/\s*=\s*/);
			const [k, v] = tokens;
			return tokens.length === 2 && k !== undefined && v !== undefined
				? [k, v]
				: reject(`"${e}" is not key=value`);
		});
}

const words = (v: string): string[] => v.split(/\s*\|\s*/).map((w) => w.trim().toUpperCase());

function capabilities(v: string): NetCapability[] {
	if (!/^(\s*[a-zA-Z_]+\s*)(\|\s*[a-zA-Z_]+\s*)*$/.test(v)) reject(`malformed capabilities ${v}`);
	return words(v).map((w) => oneOf(NET_CAPABILITIES, w, "capability"));
}

function handoverRule(text: string): HandoverRule {
	let source: AccessNetwork[] = [],
		target: AccessNetwork[] = [],
		caps: NetCapability[] = [];
	let type: HandoverRule["type"] | undefined,
		roamingOnly = false;
	for (const [k, v] of expressions(text)) {
		if (k === "source") source = words(v).map((w) => oneOf(ACCESS_NETWORKS, w, "access network"));
		else if (k === "target") target = words(v).map((w) => oneOf(ACCESS_NETWORKS, w, "access network"));
		else if (k === "type") type = v === "allowed" || v === "disallowed" ? v : reject(`unknown type ${v}`);
		else if (k === "capabilities") caps = capabilities(v);
		else if (k === "roaming") roamingOnly = v === "true";
		else reject(`unknown key ${k}`);
	}
	if (!source.length || !target.length) reject("needs both source and target");
	if (type === undefined) return reject("no type");
	if (source.includes("UNKNOWN") && type !== "disallowed") reject("UNKNOWN source only in a disallowed rule");
	if (target.includes("UNKNOWN")) reject("UNKNOWN target");
	if (!source.includes("IWLAN") && !target.includes("IWLAN")) reject("IWLAN on neither side");
	return { type, source, target, roamingOnly, capabilities: caps };
}

function retryRule(text: string): RetryRule {
	let caps: NetCapability[] = [],
		causes: number[] = [],
		permanentCauses: number[] | undefined,
		intervalsMs = [5000],
		maxRetries = 10;
	const ignored: string[] = [];
	for (const [k, v] of expressions(text)) {
		if (k === "capabilities") caps = capabilities(v);
		else if (k === "fail_causes") causes = v.split(/\s*\|\s*/).map(integer);
		// Read after the plain causes, so it wins wherever it sits.
		else if (k === "permanent_fail_causes") permanentCauses = v.split(/\s*\|\s*/).map(integer);
		else if (k === "retry_interval") intervalsMs = v.split(/\s*\|\s*/).map(integer);
		else if (k === "maximum_retries") maxRetries = integer(v);
		else ignored.push(k);
	}
	if (maxRetries < 0) reject("negative maximum_retries");
	if (intervalsMs.some((i) => i <= 0)) reject("a retry_interval not above 0");
	const failCauses = permanentCauses ?? causes;
	if (!failCauses.length && !caps.length) reject("neither capabilities nor fail causes");
	return {
		capabilities: caps,
		failCauses,
		permanent: permanentCauses !== undefined,
		intervalsMs,
		maxRetries,
		ignored,
	};
}

const ICONS = { "5g": "5G", "5g_plus": "5G_Plus", none: "None" } as const satisfies Record<
	string,
	NrIcon["icon"]
>;

function nrIcon(text: string): NrIcon {
	const [state, icon, ...rest] = text.trim().toLowerCase().split(":");
	if (state === undefined || icon === undefined || rest.length) return reject("not state:icon");
	return { state: oneOf(NR_STATES, state, "5G state"), icon: lookup<NrIcon["icon"]>(ICONS, icon, "icon") };
}

const NR_STATES_OR_ANY = [...NR_STATES, "any"] as const;

function nrIconTimer(text: string): NrIconTimer {
	const [from, to, seconds, ...rest] = text.trim().toLowerCase().split(",");
	if (from === undefined || to === undefined || seconds === undefined || rest.length)
		return reject("not from,to,seconds");
	return {
		from: oneOf(NR_STATES_OR_ANY, from, "5G state"),
		to: oneOf(NR_STATES_OR_ANY, to, "5G state"),
		seconds: integer(seconds),
	};
}

const NR_MODES = { 1: "NSA", 2: "SA" } as const satisfies Record<number, NrMode>;

const nrMode = (n: number): NrMode => lookup<NrMode>(NR_MODES, n, "mode");

function reasonRemap(text: string): ReasonRemap {
	// Java's split drops trailing empty strings.
	const parts = text.split("|");
	while (parts.at(-1) === "") parts.pop();
	const [from, message, to, ...rest] = parts;
	if (from === undefined || message === undefined || to === undefined || rest.length)
		return reject("not code|message|code");
	return {
		from: from === "*" ? null : integer(from),
		message: message === "*" ? null : message,
		to: integer(to),
	};
}

const DIGESTS = { 40: "SHA-1", 64: "SHA-256" } as const satisfies Record<
	number,
	CarrierCertificate["digest"]
>;

function certificate(text: string): CarrierCertificate {
	const [hash = "", packages] = text.split(":");
	if (!/^[0-9a-fA-F]+$/.test(hash)) reject("not a hex digest");
	return {
		digest: lookup<CarrierCertificate["digest"]>(DIGESTS, hash.length, "digest of length"),
		hash: hash.toUpperCase(),
		packages: packages === undefined ? [] : packages.split(","),
	};
}

function entry<T, R>(raw: R, read: (raw: R) => T): Entry<T> {
	try {
		return { ok: true, value: read(raw) };
	} catch (e) {
		if (e instanceof Rejected) return { ok: false, text: String(raw), reason: e.message };
		throw e;
	}
}

const isStrings = (v: unknown): v is readonly string[] =>
	Array.isArray(v) && v.every((x) => typeof x === "string");
const isNumbers = (v: unknown): v is readonly number[] =>
	Array.isArray(v) && v.every((x) => typeof x === "number");
const strings = (v: unknown): readonly string[] => (isStrings(v) ? v : reject("not a string array"));
const numbers = (v: unknown): readonly number[] => (isNumbers(v) ? v : reject("not an int array"));
const text = (v: unknown): string => (typeof v === "string" ? v : reject("not a string"));
/** A string of entries split by `sep`, empty ones skipped as the platform skips them. */
const splitText = (v: unknown, sep: string): string[] =>
	text(v)
		.trim()
		.split(sep)
		.filter((s) => s.trim());

type Reader = (value: unknown) => DecodedConfig;

function levels(measure: string, unit: SignalLevels["unit"], min: number, max: number): Reader {
	return (v) => {
		const t = numbers(v);
		const [a, b, c, d, ...rest] = t;
		if (a === undefined || b === undefined || c === undefined || d === undefined || rest.length)
			return reject(`${t.length} thresholds, not 4`);
		if (t.some((x) => x < min || x > max)) reject(`a threshold outside [${min}, ${max}]`);
		return { format: "signal-levels", value: { measure, unit, min, max, thresholds: [a, b, c, d] } };
	};
}

/** Bounds as each key's javadoc states them. */
const READERS: Readonly<Record<string, Reader>> = {
	iwlan_handover_policy_string_array: (v) => ({
		format: "handover-rules",
		value: strings(v).map((s) => entry(s, handoverRule)),
	}),
	telephony_data_setup_retry_rules_string_array: (v) => ({
		format: "retry-rules",
		value: strings(v).map((s) => entry(s, retryRule)),
	}),
	"5g_icon_configuration_string": (v) => ({
		format: "nr-icons",
		value: splitText(v, ",").map((s) => entry(s, nrIcon)),
	}),
	"5g_icon_display_grace_period_string": (v) => ({
		format: "nr-icon-timers",
		value: splitText(v, ";").map((s) => entry(s, nrIconTimer)),
	}),
	"5g_icon_display_secondary_grace_period_string": (v) => ({
		format: "nr-icon-timers",
		value: splitText(v, ";").map((s) => entry(s, nrIconTimer)),
	}),
	carrier_nr_availabilities_int_array: (v) => ({
		format: "nr-modes",
		value: numbers(v).map((n) => entry(n, nrMode)),
	}),
	ims_reasoninfo_mapping_string_array: (v) => ({
		format: "reason-remaps",
		value: strings(v).map((s) => entry(s, reasonRemap)),
	}),
	carrier_certificate_string_array: (v) => ({
		format: "certificates",
		value: strings(v).map((s) => entry(s, certificate)),
	}),
	lte_rsrp_thresholds_int_array: levels("LTE RSRP", "dBm", -140, -44),
	lte_rsrq_thresholds_int_array: levels("LTE RSRQ", "dB", -34, 3),
	lte_rssnr_thresholds_int_array: levels("LTE RSSNR", "dB", -20, 30),
	ntn_lte_rsrp_thresholds_int_array: levels("NTN LTE RSRP", "dBm", -140, -44),
	ntn_lte_rsrq_thresholds_int_array: levels("NTN LTE RSRQ", "dB", -34, 3),
	ntn_lte_rssnr_thresholds_int_array: levels("NTN LTE RSSNR", "dB", -20, 30),
	"5g_nr_ssrsrp_thresholds_int_array": levels("NR SS-RSRP", "dBm", -140, -44),
	"5g_nr_ssrsrq_thresholds_int_array": levels("NR SS-RSRQ", "dB", -43, 20),
	"5g_nr_sssinr_thresholds_int_array": levels("NR SS-SINR", "dB", -23, 40),
	wcdma_rscp_thresholds_int_array: levels("WCDMA RSCP", "dBm", -120, -24),
	wcdma_ecno_thresholds_int_array: levels("WCDMA Ec/No", "dB", -24, 1),
	gsm_rssi_thresholds_int_array: levels("GSM RSSI", "dBm", -113, -51),
};

/** A config value (as plain JSON) read by its key's format; null when the key has no format of its own. */
export function readConfigValue(key: string, value: unknown): ConfigReading | null {
	const read = Object.hasOwn(READERS, key) ? READERS[key] : undefined;
	if (!read) return null;
	try {
		return { kind: "decoded", decoded: read(value) };
	} catch (e) {
		if (e instanceof Rejected) return { kind: "not-understood", reason: e.message };
		throw e;
	}
}
