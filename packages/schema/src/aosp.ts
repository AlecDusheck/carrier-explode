/**
 * AOSP's XML formats, written from decoded settings: TelephonyProvider's apns-conf.xml, and the carrier_config_list
 * that CarrierConfig's vendor.xml holds. A source's elements repeat once per SIM rule the format can filter on.
 */

import type { Apn, SimMatcher, SimRule } from "./types.ts";

export type XmlAttrs = ReadonlyArray<readonly [name: string, value: string]>;

const ESCAPES: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

/** XML 1.0's Char production: what it can carry, escaped or not. */
const isXmlChar = (c: string): boolean => {
	const n = c.codePointAt(0) ?? 0;
	return n === 0x9 || n === 0xa || n === 0xd || (n >= 0x20 && n !== 0xfffe && n !== 0xffff);
};

export function escapeXml(s: string): string {
	if (![...s].every(isXmlChar)) throw new Error(`${JSON.stringify(s)}: not representable in XML`);
	return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

export const xmlAttrs = (list: XmlAttrs): string => list.map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join("");

const XML_DECLARATION = '<?xml version="1.0" encoding="utf-8"?>\n';

/** The documents' open and close: everything else is elements. `version` is the one AOSP's own apns-conf.xml states. */
export const AOSP_DOCUMENTS = {
	apnsConf: { head: `${XML_DECLARATION}<apns version="8">\n`, tail: "</apns>\n" },
	carrierConfigList: { head: `${XML_DECLARATION}<carrier_config_list>\n`, tail: "</carrier_config_list>\n" },
} as const;

type Qualifier = Exclude<keyof SimMatcher, "mccmnc">;

const plmn = (mccmnc: string): XmlAttrs => [
	["mcc", mccmnc.slice(0, 3)],
	["mnc", mccmnc.slice(3)],
];

/** ApnSetting's mvno_type per qualifier; GID2 has none. */
const MVNO_TYPE = {
	gid1: "gid",
	gid2: null,
	spn: "spn",
	imsiPrefix: "imsi",
	iccidPrefix: "iccid",
} as const satisfies Record<Qualifier, string | null>;

const isQualifier = (k: string): k is Qualifier => k in MVNO_TYPE;

/** A rule as apns-conf.xml filters: its PLMN and at most one MVNO match; null for one it cannot state. */
function apnFilter(rule: SimRule): XmlAttrs | null {
	if (rule.by !== "plmn") return null;
	const { mccmnc, ...rest } = rule.sim;
	const qualifiers = Object.entries(rest).filter(
		(e): e is [Qualifier, string] => isQualifier(e[0]) && typeof e[1] === "string",
	);
	const [only, ...more] = qualifiers;
	if (only === undefined) return plmn(mccmnc);
	const type = MVNO_TYPE[only[0]];
	if (type === null || more.length > 0) return null;
	return [...plmn(mccmnc), ["mvno_type", type], ["mvno_match_data", only[1]]];
}

const regexLiteral = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A rule as CarrierConfig filters (DefaultCarrierConfigService.checkFilters): SPN and IMSI are regular expressions; ICCID it cannot state. */
function configFilter(rule: SimRule): XmlAttrs | null {
	if (rule.by !== "plmn") return null;
	const { mccmnc, gid1, gid2, spn, imsiPrefix, iccidPrefix } = rule.sim;
	if (iccidPrefix !== undefined) return null;
	return [
		...plmn(mccmnc),
		...(gid1 === undefined ? [] : [["gid1", gid1] as const]),
		...(gid2 === undefined ? [] : [["gid2", gid2] as const]),
		...(spn === undefined ? [] : [["spn", regexLiteral(spn)] as const]),
		...(imsiPrefix === undefined ? [] : [["imsi", `${regexLiteral(imsiPrefix)}.*`] as const]),
	];
}

/** An APN as apns-conf.xml states it: `carrier` is the name the APN list shows. */
export interface AospApn {
	readonly carrier: string;
	readonly attrs: XmlAttrs;
}

/** A filter as a list of one, for flatMap; none for a rule the format cannot state. */
const stated = (filter: XmlAttrs | null): XmlAttrs[] => (filter === null ? [] : [filter]);

/** Each APN once per rule apns-conf.xml can state. */
export const apnElements = (rules: readonly SimRule[], apns: readonly AospApn[]): string =>
	rules
		.flatMap((r) => stated(apnFilter(r)))
		.flatMap((filter) =>
			apns.map((a) => `  <apn${xmlAttrs([["carrier", a.carrier], ...filter, ...a.attrs])}/>\n`),
		)
		.join("");

/**
 * A bundle once per rule CarrierConfig can state, named by its source (CarrierConfig reads `name` for readability
 * only); with no rules, once and unfiltered, which every SIM reads under the elements after it.
 */
export function carrierConfigElements(
	name: string,
	rules: readonly SimRule[] | "every SIM",
	body: string,
): string {
	const filters: XmlAttrs[] = rules === "every SIM" ? [[]] : rules.flatMap((r) => stated(configFilter(r)));
	return filters
		.map(
			(filter) => `  <carrier_config${xmlAttrs([["name", name], ...filter])}>\n${body}  </carrier_config>\n`,
		)
		.join("");
}

const AUTH_TYPE = { none: 0, pap: 1, chap: 2, pap_or_chap: 3 } as const satisfies Record<
	NonNullable<Apn["auth"]>,
	number
>;

/** A platform-neutral APN's fields as apns-conf.xml names them; its bearers are radio families, which the format cannot state. */
function apnAttrs(apn: Apn): XmlAttrs {
	const fields: ReadonlyArray<readonly [string, string | number | undefined]> = [
		["apn", apn.apn],
		["type", apn.types.map((t) => (t === "all" ? "*" : t)).join(",")],
		["protocol", apn.protocol?.toUpperCase()],
		["roaming_protocol", apn.roamingProtocol?.toUpperCase()],
		["authtype", apn.auth === undefined ? undefined : AUTH_TYPE[apn.auth]],
		["user", apn.user],
		["password", apn.password],
		["proxy", apn.proxy],
		["port", apn.port],
		["mmsc", apn.mmsc],
		["mmsproxy", apn.mmsProxy],
		["mmsport", apn.mmsPort],
		["mtu", apn.mtu],
	];
	return fields.flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)] as const]));
}

/** Decoded APNs, each named as its file names it, else by the source. */
export const profileApns = (apns: readonly Apn[], source: string): AospApn[] =>
	apns.map((apn) => ({ carrier: apn.label ?? source, attrs: apnAttrs(apn) }));
