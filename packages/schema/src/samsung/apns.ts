/** customer.xml's data profiles → Apns: each profile serves the roles its network's ProfileHandle names it for. */

import type { CustomerProfile, ProfileHandle } from "@carrier-explode/decode-samsung";
import type { Apn, ApnAuth, ApnType, IpProtocol } from "../types.ts";
import { stringSet } from "../values.ts";

/** ProfileHandle roles that carry APN traffic Android names; app profiles (Email, Streaming, ActiveSync, …) carry none. */
const ROLE_TYPES: Readonly<Record<string, readonly ApnType[]>> = {
	ProfBrowser: ["default"],
	ProfMMS: ["mms"],
	ProfIntSharing: ["dun"],
	ProfIMS: ["ims"],
	ProfXCAP: ["xcap"],
	ProfEmergencyIMSCall: ["emergency"],
	ProfIA: ["ia"],
	ProfSGPS: ["supl"],
	ProfAGPS: ["supl"],
	ProfRCS: ["rcs"],
};

const AUTH: Readonly<Record<string, ApnAuth>> = {
	none: "none",
	normal: "pap",
	secure: "chap",
	normalorsecure: "pap_or_chap",
};
const IP: Readonly<Record<string, IpProtocol>> = { ipv4: "ip", ipv6: "ipv6", ipv4v6: "ipv4v6" };

/** The roles naming `p` in its own network's handle. */
function typesOf(p: CustomerProfile, handles: readonly ProfileHandle[]): ApnType[] {
	const mine = handles.filter((h) => h.networkName === p.networkName);
	return stringSet(
		mine.flatMap((h) =>
			Object.entries(h.roles).flatMap(([role, name]) => (name === p.name ? (ROLE_TYPES[role] ?? []) : [])),
		),
	);
}

function apnOf(p: CustomerProfile, handles: readonly ProfileHandle[]): Apn | undefined {
	if (p.apn === undefined) return undefined;
	const types = typesOf(p, handles);
	const mms = types.includes("mms");
	const auth = p.auth === undefined ? undefined : AUTH[p.auth];
	const protocol = p.ipVersion === undefined ? undefined : IP[p.ipVersion];
	const roamingProtocol = p.roamingIpVersion === undefined ? undefined : IP[p.roamingIpVersion];
	return {
		apn: p.apn,
		...(p.name === undefined ? {} : { label: p.name }),
		types,
		...(protocol === undefined ? {} : { protocol }),
		...(roamingProtocol === undefined ? {} : { roamingProtocol }),
		...(auth === undefined ? {} : { auth }),
		...(p.user === undefined ? {} : { user: p.user }),
		hasPassword: p.hasPassword,
		// An MMS profile's proxy is the MMS proxy; any other's, its HTTP proxy.
		...(p.proxy === undefined
			? {}
			: mms
				? { mmsProxy: p.proxy.host, ...(p.proxy.port === undefined ? {} : { mmsPort: p.proxy.port }) }
				: { proxy: p.proxy.host, ...(p.proxy.port === undefined ? {} : { port: p.proxy.port }) }),
		...(mms && p.url !== undefined ? { mmsc: p.url } : {}),
		...(p.mtu !== undefined && p.mtu > 0 ? { mtu: p.mtu } : {}),
		path: `customer.xml:Settings.Connections.Profile[${p.index}]`,
	};
}

export const samsungApns = (profiles: readonly CustomerProfile[], handles: readonly ProfileHandle[]): Apn[] =>
	profiles.flatMap((p) => apnOf(p, handles) ?? []);
