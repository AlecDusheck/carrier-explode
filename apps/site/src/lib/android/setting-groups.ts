/**
 * Reading groups for Android CarrierConfig keys. A nested class's keys (`ims.sip_timer_t1_millis_int`) group by
 * that class; flat keys by the first pattern their name matches, so the narrower groups come first.
 */

const CONFIG_GROUPS = [
	["Wi-Fi Calling", /(wfc|wifi|epdg|iwlan|vowifi)/],
	["5G", /(5g|(^|_)nr(_|$)|vonr|mmwave|nrarfcn)/],
	["Voice, VoLTE and IMS", /(volte|ims|sip|rtt|tty|call|dial|ussd|cdma|voice|vt_|video)/],
	["SMS and MMS", /(sms|mms|cellbroadcast|messag)/],
	["Data, APNs and tethering", /(apn|data|tether|dun|mtu|pdn|internet)/],
	["Roaming", /roam/],
	["Emergency", /(emergency|ecbm|e911|ecm_)/],
	["Name, icons and signal", /(name|icon|spn|plmn|signal|rsrp|rssnr|sinr|threshold|display)/],
	["SIM and network selection", /(sim|network|manual_selection|operator|gid|mvno)/],
] as const satisfies ReadonlyArray<readonly [string, RegExp]>;

export function configGroup(key: string): string {
	const dot = key.indexOf(".");
	if (dot > 0) return `${key.slice(0, dot)}.* keys`;
	return CONFIG_GROUPS.find(([, re]) => re.test(key))?.[0] ?? "Other";
}

/** Group titles in display order: the table's, then nested classes, then Other. */
export function groupOrder(title: string): number {
	const i = CONFIG_GROUPS.findIndex(([t]) => t === title);
	if (i >= 0) return i;
	return title === "Other" ? CONFIG_GROUPS.length + 1 : CONFIG_GROUPS.length;
}
