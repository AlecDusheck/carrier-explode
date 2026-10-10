/**
 * The feature matrix: the requirements a visitor can set, each read from what the schema derives.
 * A requirement is judged here because the visitor sets it; the facts it reads are the schema's.
 */

import { conceptById, decoderFamily, expresses, needs5G } from "@carrier-explode/schema";
import type { ReleasePlatform } from "@carrier-explode/schema/types";
import type { PhoneState } from "#lib/server/features.ts";
import type { FeatureIcon } from "./feature-icons.ts";

/** States are per phone; settings are read from the carrier's own file, so the same on every phone. */
const STATES = [
	"5g",
	"5g-standalone",
	"voice-over-5g",
	"volte",
	"hd-voice-plus",
	"visual-voicemail",
	"wifi-calling",
	"video-calling",
	"calls-on-other-devices",
	"rcs",
	"rcs-business-messaging",
	"satellite",
	"branded-calling",
	"spam-call-warnings",
	"esim-transfer",
	"esim-from-android",
	"apple-watch-number-sharing",
] as const;
const SETTINGS = [
	"lte-icon",
	"volte-switch",
	"ss-over-ut",
	"voicemail-number",
	"epdg-address",
	"sip-ipsec",
	"wfc-mode",
	"wfc-roaming-mode",
	"wfc-roaming",
	"wifi-calling-name",
	"apn-internet",
	"internet-ip",
	"mmsc",
	"5g-icon-advanced",
] as const;
const MATRIX_CONCEPTS = [...STATES, ...SETTINGS] as const;
export type MatrixConcept = (typeof MATRIX_CONCEPTS)[number];
type Setting = (typeof SETTINGS)[number];

export const isSetting = (id: string): id is Setting => SETTINGS.some((s) => s === id);

export type SettingValue = string | number | boolean | readonly (string | number)[];
/** A setting the file leaves unset is "unset"; one we have no file for, "unknown". */
export type MatrixCell = PhoneState | { readonly value: SettingValue };

/** The concepts a phone can read: its platform expresses them, and a phone without a 5G modem has no 5G ones. */
export const phoneConcepts = (phone: {
	readonly platform: ReleasePlatform;
	readonly has5g: boolean | null;
}): readonly MatrixConcept[] =>
	MATRIX_CONCEPTS.filter(
		(id) => expresses(decoderFamily(phone.platform), id) && !(phone.has5g === false && needs5G(id)),
	);

type Read = (id: MatrixConcept) => MatrixCell;

/** null: the requirement does not apply, as when we have no settings for the carrier. */
export type Outcome = boolean | null;

const offered = (c: MatrixCell): Outcome => (c === "unknown" ? null : c === "on" || c === "available");
const setting = (c: MatrixCell): SettingValue | null | undefined =>
	c === "unknown" ? undefined : typeof c === "string" ? null : c.value;
const isSet = (c: MatrixCell): Outcome => {
	const v = setting(c);
	return v === undefined ? null : v !== null;
};
const not = (o: Outcome): Outcome => (o === null ? null : !o);
const equals = (c: MatrixCell, want: SettingValue): Outcome => {
	const v = setting(c);
	return v === undefined ? null : v === want;
};

export const RULE_GROUPS = ["5g", "voice", "wifi-calling", "data", "more", "emergency"] as const;
export type RuleGroup = (typeof RULE_GROUPS)[number];
export const RULE_GROUP_NAMES = {
	"5g": "5G",
	voice: "Voice",
	"wifi-calling": "Wi-Fi Calling",
	data: "Data",
	more: "More features",
	emergency: "Emergency",
} as const satisfies Record<RuleGroup, string>;

/** What a country bundle sets that a feature tree shows. */
const COUNTRY_CONCEPTS = ["emergency-numbers", "cell-broadcast-channels", "nr-modes"] as const;
export type TreeConcept = MatrixConcept | (typeof COUNTRY_CONCEPTS)[number];

interface Place {
	readonly group: RuleGroup;
	readonly icon: FeatureIcon;
	/** The feature it is a setting of or rides on. */
	readonly under: TreeConcept | null;
}

/** Each concept's place in a feature tree; key order is the tree's order. */
export const PLACES = {
	"5g": { group: "5g", icon: "tower", under: null },
	"5g-standalone": { group: "5g", icon: "bolt", under: "5g" },
	"voice-over-5g": { group: "5g", icon: "mic", under: "5g" },
	"5g-icon-advanced": { group: "5g", icon: "plus", under: "5g" },
	"nr-modes": { group: "5g", icon: "bolt", under: null },
	"lte-icon": { group: "5g", icon: "letters", under: null },
	volte: { group: "voice", icon: "handset", under: null },
	"hd-voice-plus": { group: "voice", icon: "wave", under: "volte" },
	"video-calling": { group: "voice", icon: "camera", under: "volte" },
	"sip-ipsec": { group: "voice", icon: "lock", under: "volte" },
	"volte-switch": { group: "voice", icon: "toggle", under: "volte" },
	"ss-over-ut": { group: "voice", icon: "forward", under: null },
	"visual-voicemail": { group: "voice", icon: "tape", under: null },
	"voicemail-number": { group: "voice", icon: "hash", under: null },
	"wifi-calling": { group: "wifi-calling", icon: "wifi", under: null },
	"epdg-address": { group: "wifi-calling", icon: "pin", under: "wifi-calling" },
	"wfc-mode": { group: "wifi-calling", icon: "house", under: "wifi-calling" },
	"wfc-roaming": { group: "wifi-calling", icon: "globe", under: "wifi-calling" },
	"wfc-roaming-mode": { group: "wifi-calling", icon: "house", under: "wfc-roaming" },
	"wifi-calling-name": { group: "wifi-calling", icon: "tag", under: "wifi-calling" },
	"calls-on-other-devices": { group: "wifi-calling", icon: "laptop", under: "wifi-calling" },
	"apn-internet": { group: "data", icon: "apn", under: null },
	"internet-ip": { group: "data", icon: "dual", under: "apn-internet" },
	mmsc: { group: "data", icon: "envelope", under: null },
	rcs: { group: "more", icon: "bubble", under: null },
	"rcs-business-messaging": { group: "more", icon: "shop", under: "rcs" },
	satellite: { group: "more", icon: "satellite", under: null },
	"branded-calling": { group: "more", icon: "badge", under: null },
	"spam-call-warnings": { group: "more", icon: "shield", under: null },
	"esim-transfer": { group: "more", icon: "sim", under: null },
	"esim-from-android": { group: "more", icon: "arrows", under: "esim-transfer" },
	"apple-watch-number-sharing": { group: "more", icon: "watch", under: null },
	"emergency-numbers": { group: "emergency", icon: "cross", under: null },
	"cell-broadcast-channels": { group: "emergency", icon: "alert", under: null },
} as const satisfies Record<TreeConcept, Place>;

export const isTreeConcept = (id: string): id is TreeConcept => id in PLACES;

type Param =
	| { readonly kind: "choice"; readonly options: readonly (readonly [value: string, label: string])[] }
	| { readonly kind: "text"; readonly initial: string };

interface RuleDef {
	readonly id: string;
	readonly group: RuleGroup;
	readonly name: string;
	readonly icon: FeatureIcon;
	/** A column header's label. */
	readonly short: string;
	/** The rule this one refines: a setting of it, or a feature that rides on it. */
	readonly under: string | null;
	readonly reads: readonly MatrixConcept[];
	readonly param: Param | null;
	readonly test: (read: Read, param: string) => Outcome;
}

/** A rule that a feature is offered; its id stays the feature's, so `RuleId` lists every rule. */
const feature = <const Id extends (typeof STATES)[number]>(
	id: Id,
	group: RuleGroup,
	short: string,
	under: string | null,
) =>
	({
		id,
		group,
		name: conceptById(id)?.name ?? id,
		icon: PLACES[id].icon,
		short,
		under,
		reads: [id],
		param: null,
		test: (read: Read) => offered(read(id)),
	}) satisfies RuleDef;

export const RULES = [
	{
		id: "nr",
		group: "5g",
		name: "5G",
		icon: "tower",
		short: "5G",
		under: null,
		reads: ["5g"],
		param: null,
		test: (r) => offered(r("5g")),
	},
	{
		id: "sa",
		group: "5g",
		name: "5G SA",
		icon: "bolt",
		short: "SA",
		under: "nr",
		reads: ["5g-standalone"],
		param: null,
		test: (r) => offered(r("5g-standalone")),
	},
	{
		id: "vonr",
		group: "5g",
		name: "VoNR",
		icon: "mic",
		short: "VoNR",
		under: "nr",
		reads: ["voice-over-5g"],
		param: null,
		test: (r) => offered(r("voice-over-5g")),
	},
	{
		id: "badge",
		group: "5g",
		name: "Network badge on LTE",
		icon: "letters",
		short: "LTE icon",
		under: null,
		reads: ["lte-icon"],
		param: {
			kind: "choice",
			options: [
				["4G", "4G"],
				["LTE", "LTE"],
			],
		},
		// iOS says LTE unless told otherwise.
		test: (r, p) => {
			const v = setting(r("lte-icon"));
			return v === undefined ? null : (v ?? "LTE") === p;
		},
	},
	{
		id: "ims",
		group: "voice",
		name: "VoLTE",
		icon: "handset",
		short: "VoLTE",
		under: null,
		reads: ["volte"],
		param: null,
		test: (r) => offered(r("volte")),
	},
	{
		id: "evs",
		group: "voice",
		name: "EVS codec",
		icon: "wave",
		short: "EVS",
		under: "ims",
		reads: ["hd-voice-plus"],
		param: null,
		test: (r) => offered(r("hd-voice-plus")),
	},
	{
		id: "volteDef",
		group: "voice",
		name: "VoLTE on by default",
		icon: "power",
		short: "VoLTE on",
		under: "ims",
		reads: ["volte"],
		param: null,
		test: (r) => (r("volte") === "unknown" ? null : r("volte") === "on"),
	},
	{
		id: "volteKey",
		group: "voice",
		name: "VoLTE switch in Settings",
		icon: "toggle",
		short: "VoLTE switch",
		under: "ims",
		reads: ["volte-switch"],
		param: null,
		test: (r) => not(equals(r("volte-switch"), false)),
	},
	{
		id: "xcap",
		group: "voice",
		name: "Call settings via XCAP",
		icon: "forward",
		short: "XCAP",
		under: null,
		reads: ["ss-over-ut"],
		param: null,
		test: (r) => equals(r("ss-over-ut"), true),
	},
	{
		id: "vvm",
		group: "voice",
		name: "No visual voicemail",
		icon: "slash",
		short: "No VVM",
		under: null,
		reads: ["visual-voicemail"],
		param: null,
		test: (r) => not(offered(r("visual-voicemail"))),
	},
	{
		id: "vmpilot",
		group: "voice",
		name: "No voicemail number",
		icon: "hash",
		short: "No VM no.",
		under: null,
		reads: ["voicemail-number"],
		param: null,
		test: (r) => not(isSet(r("voicemail-number"))),
	},
	{ ...feature("wifi-calling", "wifi-calling", "WFC", null), id: "wfc" },
	{
		id: "epdg",
		group: "wifi-calling",
		name: "ePDG not fixed to one carrier",
		icon: "pin",
		short: "ePDG",
		under: "wfc",
		reads: ["epdg-address"],
		param: null,
		// A templated address is filled in from the SIM.
		test: (r) => {
			const v = setting(r("epdg-address"));
			return v === undefined ? null : v === null || String(v).includes("$");
		},
	},
	{
		id: "sec",
		group: "wifi-calling",
		name: "IMS over IPsec",
		icon: "lock",
		short: "IPsec",
		under: "ims",
		reads: ["sip-ipsec", "volte"],
		param: null,
		test: (r) => (offered(r("volte")) === true ? equals(r("sip-ipsec"), true) : null),
	},
	{
		id: "prio",
		group: "wifi-calling",
		name: "Wi-Fi calling preferred",
		icon: "house",
		short: "WFC first",
		under: "wfc",
		reads: ["wfc-mode", "wfc-roaming-mode"],
		param: {
			kind: "choice",
			options: [
				["any", "at home or roaming"],
				["home", "at home"],
				["roam", "roaming"],
			],
		},
		test: (r, p) => {
			const home = equals(r("wfc-mode"), "wifi-preferred");
			const roam = equals(r("wfc-roaming-mode"), "wifi-preferred");
			return p === "home" ? home : p === "roam" ? roam : home === null ? null : home || roam === true;
		},
	},
	{
		id: "wroam",
		group: "wifi-calling",
		name: "Wi-Fi Calling when roaming",
		icon: "globe",
		short: "WFC roam",
		under: "wfc",
		reads: ["wfc-roaming"],
		param: null,
		test: (r) => equals(r("wfc-roaming"), true),
	},
	{
		id: "label",
		group: "wifi-calling",
		name: "No carrier label on Wi-Fi calls",
		icon: "tag",
		short: "No label",
		under: "wfc",
		reads: ["wifi-calling-name"],
		param: null,
		test: (r) => not(isSet(r("wifi-calling-name"))),
	},
	{
		id: "apnName",
		group: "data",
		name: "Default APN",
		icon: "apn",
		short: "APN",
		under: null,
		reads: ["apn-internet"],
		param: { kind: "text", initial: "internet" },
		test: (r, p) => {
			const v = setting(r("apn-internet"));
			return v === undefined ? null : String(v ?? "").toLowerCase() === p.trim().toLowerCase();
		},
	},
	{
		id: "inetProto",
		group: "data",
		name: "Internet APN protocol",
		icon: "dual",
		short: "IP",
		under: null,
		reads: ["internet-ip"],
		param: {
			kind: "choice",
			options: [
				["ipv4v6", "v4+v6"],
				["ip", "v4"],
				["ipv6", "v6"],
				["unset", "not set"],
			],
		},
		test: (r, p) => {
			const v = setting(r("internet-ip"));
			return v === undefined ? null : (v ?? "unset") === p;
		},
	},
	{
		id: "mms",
		group: "data",
		name: "MMS settings",
		icon: "envelope",
		short: "MMS",
		under: null,
		reads: ["mmsc"],
		param: {
			kind: "choice",
			options: [
				["empty", "empty"],
				["filled", "filled"],
			],
		},
		test: (r, p) => {
			const set = isSet(r("mmsc"));
			return p === "empty" ? not(set) : set;
		},
	},
	feature("video-calling", "more", "ViLTE", "ims"),
	feature("calls-on-other-devices", "more", "Devices", "wfc"),
	feature("rcs", "more", "RCS", null),
	feature("rcs-business-messaging", "more", "RCS biz", "rcs"),
	feature("satellite", "more", "Satellite", null),
	feature("branded-calling", "more", "Caller ID", null),
	feature("spam-call-warnings", "more", "Spam", null),
	feature("esim-transfer", "more", "eSIM", null),
	feature("esim-from-android", "more", "From Android", "esim-transfer"),
	feature("apple-watch-number-sharing", "more", "Watch", null),
	{
		id: "5g-icon-advanced",
		group: "more",
		name: conceptById("5g-icon-advanced")?.name ?? "5g-icon-advanced",
		icon: "plus",
		short: "5G+ icon",
		under: "nr",
		reads: ["5g-icon-advanced"],
		param: null,
		test: (r) => isSet(r("5g-icon-advanced")),
	},
] as const satisfies readonly RuleDef[];

export type Rule = (typeof RULES)[number];
export type RuleId = Rule["id"];

/** A rule's line of explanation: the concept it reads, as the schema describes it. */
export const ruleWhat = (rule: Rule): string => conceptById(rule.reads[0])?.description ?? "";

/** The rules a phone can judge: it reads every concept they need. */
export const phoneRules = (concepts: readonly MatrixConcept[]): readonly Rule[] =>
	RULES.filter((r) => r.reads.every((id) => concepts.includes(id)));

export const MODES = ["off", "want", "need"] as const;
export type Mode = (typeof MODES)[number];
export const MODE_NAMES = { off: "Off", want: "Nice to have", need: "Required" } as const satisfies Record<
	Mode,
	string
>;

export interface Requirement {
	readonly mode: Mode;
	readonly param: string;
}

const initialParam = (rule: Rule): string =>
	rule.param === null
		? ""
		: rule.param.kind === "text"
			? rule.param.initial
			: (rule.param.options[0]?.[0] ?? "");

/** A named set of requirements; the first is what a URL naming none means. */
interface Preset {
	readonly id: string;
	readonly name: string;
	readonly need: readonly RuleId[];
	readonly want: readonly RuleId[];
}

/** Rules that ask for something to be absent: only a bundle swap wants them. */
const ABSENCES: ReadonlySet<RuleId> = new Set(["vvm", "vmpilot", "epdg", "label"]);

export const PRESETS = [
	{ id: "everyday", name: "Everyday", need: [], want: ["nr", "ims", "wfc"] },
	{ id: "latest", name: "Latest", need: ["sa", "vonr", "wfc"], want: [] },
	{
		id: "everything",
		name: "Everything",
		need: [],
		want: RULES.map((rule) => rule.id).filter((id) => !ABSENCES.has(id)),
	},
	// For a SIM run on another carrier's settings bundle: ios-bundles' own starting selection, of the rules we read.
	{
		id: "swap",
		name: "Bundle swap",
		need: ["nr", "ims", "evs", "vvm", "epdg"],
		want: ["apnName", "volteDef"],
	},
] as const satisfies readonly Preset[];
export type PresetId = (typeof PRESETS)[number]["id"];

/** A preset's requirements, every parameter at its first. */
export const presetRequirements = (preset: Preset): ReadonlyMap<RuleId, Requirement> =>
	new Map(
		RULES.map((rule) => [
			rule.id,
			{
				mode: preset.need.includes(rule.id) ? "need" : preset.want.includes(rule.id) ? "want" : "off",
				param: initialParam(rule),
			},
		]),
	);

/** The preset the requirements are exactly, or null when edited past every one. */
export const presetOf = (reqs: ReadonlyMap<RuleId, Requirement>): PresetId | null =>
	PRESETS.find((preset) =>
		[...presetRequirements(preset)].every(([id, r]) => {
			const now = reqs.get(id);
			return now?.mode === r.mode && (r.mode === "off" || now.param === r.param);
		}),
	)?.id ?? null;

/** What `need` says when nothing is picked, so an emptied list is not read as the first preset. */
export const NONE = "none";

/**
 * Requirements as the URL keeps them: `need` and `want` list rule ids; a rule's own key holds its parameter. A URL with
 * neither list means the first preset.
 */
export function readRequirements(params: Pick<URLSearchParams, "get">): ReadonlyMap<RuleId, Requirement> {
	const fresh = params.get("need") === null && params.get("want") === null;
	const listed = (key: "need" | "want"): readonly string[] =>
		fresh ? PRESETS[0][key] : (params.get(key)?.split(",") ?? []);
	const [need, want] = [listed("need"), listed("want")];
	return new Map(
		RULES.map((rule) => [
			rule.id,
			{
				mode: need.includes(rule.id) ? "need" : want.includes(rule.id) ? "want" : "off",
				param: params.get(rule.id) ?? initialParam(rule),
			},
		]),
	);
}

export function requirementParams(reqs: ReadonlyMap<RuleId, Requirement>): Record<string, string | null> {
	const ids = (mode: Mode): string | null =>
		[...reqs].flatMap(([id, r]) => (r.mode === mode ? [id] : [])).join(",") || null;
	const [need, want] = [ids("need"), ids("want")];
	return {
		need: need === null && want === null ? NONE : need,
		want,
		...Object.fromEntries(
			RULES.map((rule) => {
				const r = reqs.get(rule.id);
				return [
					rule.id,
					r === undefined || r.mode === "off" || r.param === initialParam(rule) ? null : r.param,
				];
			}),
		),
	};
}

/** Every query parameter the matrix page reads: the requirements and their parameters, misses, search, columns and phone. */
export const MATRIX_PARAMS: readonly string[] = [
	"need",
	"want",
	...RULES.map((r) => r.id),
	"miss",
	"q",
	"all",
	"phone",
];
