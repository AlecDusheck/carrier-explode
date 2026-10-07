/** A Pixel's CarrierSettings in AOSP's XML: its ApnItems as apns-conf.xml rows, its configs as a CarrierConfig bundle. */

import type {
	AndroidApnType,
	AndroidProtocol,
	ApnItem,
	CarrierConfigValue,
	CarrierSettings,
	Skip464Xlat,
} from "@carrier-explode/decode-android";
import { escapeXml, xmlAttrs, type AospApn, type XmlAttrs } from "../aosp.ts";

/** ApnSetting's type strings. An enum newer than the decoder's proto has no name to give. */
const apnType = (t: AndroidApnType): string | undefined =>
	t === "ALL" ? "*" : t.startsWith("UNKNOWN_") ? undefined : t.toLowerCase();

const protocol = (p: AndroidProtocol | undefined): string | undefined =>
	p === undefined || p.startsWith("UNKNOWN_") ? undefined : p.replace("_", "-");

/** Telephony.Carriers' SKIP_464XLAT_* numbers. */
const SKIP_464XLAT: Readonly<Record<string, number>> = {
	SKIP_464XLAT_DEFAULT: -1,
	SKIP_464XLAT_DISABLE: 0,
	SKIP_464XLAT_ENABLE: 1,
};

const skip464xlat = (x: Skip464Xlat): number | undefined => SKIP_464XLAT[x];

/** ApnSetting's INFRASTRUCTURE_* bits by the names apns-conf.xml spells them in. */
const INFRASTRUCTURES = [
	[1, "cellular"],
	[2, "satellite"],
] as const;

const infrastructures = (mask: number | undefined): string | undefined =>
	mask === undefined
		? undefined
		: INFRASTRUCTURES.flatMap(([bit, name]) => (mask & bit ? [name] : [])).join("|");

/** Every field TelephonyProvider reads from apns-conf.xml that the proto has, by its attribute. */
function apnItemAttrs(item: ApnItem): XmlAttrs {
	const fields: ReadonlyArray<readonly [string, string | number | boolean | undefined]> = [
		["apn", item.value ?? ""],
		["type", item.type.flatMap((t) => apnType(t) ?? []).join(",")],
		["bearer_bitmask", item.bearerBitmask],
		["lingering_network_type_bitmask", item.lingeringNetworkTypeBitmask],
		["infrastructure_bitmask", infrastructures(item.infrastructureBitmask)],
		["protocol", protocol(item.protocol)],
		["roaming_protocol", protocol(item.roamingProtocol)],
		["authtype", item.authtype === -1 ? undefined : item.authtype],
		["user", item.user],
		["password", item.password],
		["server", item.server],
		["proxy", item.proxy],
		["port", item.port],
		["mmsc", item.mmsc],
		["mmsproxy", item.mmscProxy],
		["mmsport", item.mmscProxyPort],
		["mtu", item.mtu],
		["mtu_v6", item.mtuV6],
		["profile_id", item.profileId],
		["max_conns", item.maxConns],
		["wait_time", item.waitTime],
		["max_conns_time", item.maxConnsTime],
		["apn_set_id", item.apnSetId],
		["skip_464xlat", item.skip464xlat === undefined ? undefined : skip464xlat(item.skip464xlat)],
		["modem_cognitive", item.modemCognitive],
		["user_visible", item.userVisible],
		["user_editable", item.userEditable],
		["always_on", item.alwaysOn],
		[
			"esim_bootstrap_provisioning",
			item.esimBootstrapProvisioning === undefined ? undefined : item.esimBootstrapProvisioning !== 0,
		],
	];
	return fields.flatMap(([k, v]) => (v === undefined || v === "" ? [] : [[k, String(v)] as const]));
}

/** The file's APNs, each named as the APN list shows it, else by the source. */
export const pixelApns = (cs: CarrierSettings, source: string): AospApn[] =>
	cs.apns.map((item) => ({ carrier: item.name || source, attrs: apnItemAttrs(item) }));

const items = (values: ReadonlyArray<string | number>, indent: string): string =>
	values.map((x) => `${indent}  <item${xmlAttrs([["value", String(x)]])}/>\n`).join("");

/** One config as PersistableBundle's XML (XmlUtils' tags; a bundle as `pbundle_as_map`), each type as the proto states it. */
function configXml(name: string, c: CarrierConfigValue, indent: string): string {
	const named = xmlAttrs([["name", name]]);
	switch (c.kind) {
		case "text":
			return `${indent}<string${named}>${escapeXml(c.value)}</string>\n`;
		case "int":
			return `${indent}<int${named} value="${c.value}"/>\n`;
		case "long":
			return `${indent}<long${named} value="${c.value}"/>\n`;
		case "bool":
			return `${indent}<boolean${named} value="${c.value}"/>\n`;
		case "double":
			return `${indent}<double${named} value="${c.value}"/>\n`;
		case "text_array":
			return `${indent}<string-array${named} num="${c.value.length}">\n${items(c.value, indent)}${indent}</string-array>\n`;
		case "int_array":
			return `${indent}<int-array${named} num="${c.value.length}">\n${items(c.value, indent)}${indent}</int-array>\n`;
		case "bundle":
			return `${indent}<pbundle_as_map${named}>\n${configsXml(c.value, `${indent}  `)}${indent}</pbundle_as_map>\n`;
	}
}

const configsXml = (configs: Readonly<Record<string, CarrierConfigValue>>, indent: string): string =>
	Object.entries(configs)
		.map(([k, c]) => configXml(k, c, indent))
		.join("");

/** The file's configs, as the body of a carrier_config element. */
export const pixelConfigBody = (cs: CarrierSettings): string => configsXml(cs.configs, "    ");
