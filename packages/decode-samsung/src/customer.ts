/** customer.xml: a carrier pack's general info, its data profiles (APNs) and which profile serves each role. */

import { child, childrenNamed, childText, parseXml, type XmlElement } from "./xml.ts";

/** One data profile, as Connections.Profile writes it. Fields the file leaves out stay out. */
export interface CustomerProfile {
	/** Index among Connections' Profile elements. */
	readonly index: number;
	/** The network (GeneralInfo.NetworkInfo.NetworkName) the profile is for. */
	readonly networkName?: string;
	readonly name?: string;
	readonly apn?: string;
	/** `normal` (PAP), `secure` (CHAP), `normalorsecure`, `none`. */
	readonly auth?: string;
	readonly user?: string;
	readonly password?: string;
	/** `ipv4`, `ipv6`, `ipv4v6`. */
	readonly ipVersion?: string;
	readonly roamingIpVersion?: string;
	/** The MMS centre, on an MMS profile. */
	readonly url?: string;
	/** Set only when Proxy.EnableFlag is on. */
	readonly proxy?: { readonly host: string; readonly port?: string };
	readonly mtu?: number;
	readonly bearer?: string;
	readonly editable?: boolean;
	readonly hidden?: boolean;
}

/** ProfileHandle: for one network, which profile (by ProfileName) serves each role: `ProfBrowser`, `ProfMMS`, `ProfIMS`, … */
export interface ProfileHandle {
	readonly networkName?: string;
	readonly roles: Readonly<Record<string, string>>;
}

export interface Customer {
	readonly salesCode?: string;
	readonly country?: string;
	/** Upper-case ISO 3166 alpha-2. */
	readonly countryIso?: string;
	readonly profiles: readonly CustomerProfile[];
	readonly handles: readonly ProfileHandle[];
	/** The whole document, for the settings view. */
	readonly root: XmlElement;
}

function profileOf(e: XmlElement, index: number): CustomerProfile {
	const ps = child(e, "PSparam");
	const proxy = child(e, "Proxy");
	const host = proxy === undefined ? undefined : childText(proxy, "ServAddr");
	const port = proxy === undefined ? undefined : childText(proxy, "Port");
	const proxied = proxy !== undefined && childText(proxy, "EnableFlag") === "on";
	const mtu = childText(e, "MTUSize");
	const hidden = childText(e, "HiddenStatus");
	const editable = childText(e, "Editable");
	const networkName = childText(e, "NetworkName"),
		name = childText(e, "ProfileName"),
		auth = childText(e, "Auth");
	const apn = ps === undefined ? undefined : childText(ps, "APN");
	const user = ps === undefined ? undefined : childText(ps, "UserId");
	const password = ps === undefined ? undefined : childText(ps, "Password");
	const ipVersion = childText(e, "IpVersion"),
		roamingIpVersion = childText(e, "RoamingIpVersion");
	const url = childText(e, "URL"),
		bearer = childText(e, "Bearer");
	return {
		index,
		...(networkName === undefined ? {} : { networkName }),
		...(name === undefined ? {} : { name }),
		...(apn === undefined ? {} : { apn }),
		...(auth === undefined ? {} : { auth }),
		...(user === undefined ? {} : { user }),
		...(password === undefined ? {} : { password }),
		...(ipVersion === undefined ? {} : { ipVersion }),
		...(roamingIpVersion === undefined ? {} : { roamingIpVersion }),
		...(url === undefined ? {} : { url }),
		...(proxied && host !== undefined
			? { proxy: { host, ...(port !== undefined && port !== "0" ? { port } : {}) } }
			: {}),
		...(mtu === undefined ? {} : { mtu: Number(mtu) }),
		...(bearer === undefined ? {} : { bearer }),
		...(editable === undefined ? {} : { editable: editable.toLowerCase() === "yes" }),
		...(hidden === undefined ? {} : { hidden: hidden === "hidden" }),
	};
}

function handleOf(e: XmlElement): ProfileHandle {
	const networkName = childText(e, "NetworkName");
	const roles = Object.fromEntries(
		e.children.filter((c) => c.name.startsWith("Prof") && c.text !== "").map((c) => [c.name, c.text]),
	);
	return { ...(networkName === undefined ? {} : { networkName }), roles };
}

export function decodeCustomer(xml: string): Customer {
	const root = parseXml(xml);
	const general = child(root, "GeneralInfo");
	const settings = child(root, "Settings");
	const connections = settings === undefined ? undefined : child(settings, "Connections");
	const salesCode = general === undefined ? undefined : childText(general, "SalesCode");
	const country = general === undefined ? undefined : childText(general, "Country");
	const countryIso = general === undefined ? undefined : childText(general, "CountryISO")?.toUpperCase();
	return {
		...(salesCode === undefined ? {} : { salesCode }),
		...(country === undefined ? {} : { country }),
		...(countryIso === undefined ? {} : { countryIso }),
		profiles: connections === undefined ? [] : childrenNamed(connections, "Profile").map(profileOf),
		handles: connections === undefined ? [] : childrenNamed(connections, "ProfileHandle").map(handleOf),
		root,
	};
}
