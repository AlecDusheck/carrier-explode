/** Android ApnItem -> Apn. Fields the file leaves out stay out: proto defaults are not facts about the carrier. */

import type { AndroidApnType, AndroidProtocol, ApnItem } from "#lib/decode/android/types.ts";
import type { Apn, ApnAuth, ApnType, IpProtocol } from "../types.ts";
import { stringSet, text } from "../values.ts";

const TYPES: Readonly<Partial<Record<AndroidApnType, ApnType>>> = {
  ALL: "all", DEFAULT: "default", MMS: "mms", SUPL: "supl", DUN: "dun", HIPRI: "hipri", FOTA: "fota", IMS: "ims",
  CBS: "cbs", IA: "ia", EMERGENCY: "emergency", XCAP: "xcap", UT: "ut", RCS: "rcs",
};

const PROTOCOLS: Readonly<Partial<Record<AndroidProtocol, IpProtocol>>> = { IP: "ip", IPV6: "ipv6", IPV4V6: "ipv4v6", PPP: "ppp" };

/** ApnSetting AUTH_TYPE_*; -1 is the proto's "unset". */
const AUTH: ReadonlyMap<number, ApnAuth> = new Map([[0, "none"], [1, "pap"], [2, "chap"], [3, "pap_or_chap"]]);

/**
 * ServiceState RIL_RADIO_TECHNOLOGY_* in bearer_bitmask, by radio family, named
 * the way the iOS mapper names technology-mask bits so the two compare.
 */
const RADIO_FAMILY: ReadonlyMap<number, string> = new Map([
  [1, "gsm"], [2, "gsm"], [16, "gsm"],
  [3, "umts"], [9, "umts"], [10, "umts"], [11, "umts"], [15, "umts"], [17, "umts"],
  [4, "cdma"], [5, "cdma"], [6, "cdma"], [7, "cdma"], [8, "cdma"], [12, "cdma"],
  [13, "ehrpd"], [14, "lte"], [19, "lte"], [18, "iwlan"], [20, "nr"],
]);

function bearers(mask: string | undefined): string[] | undefined {
  if (mask === undefined) return undefined;
  const families = mask.split("|").flatMap((x) => RADIO_FAMILY.get(Number(x.trim())) ?? []);
  // "0" (the proto default) means every radio: no restriction.
  return families.length ? stringSet(families) : undefined;
}

function apnOf(item: ApnItem, i: number): Apn {
  const types = stringSet(item.type.flatMap((t) => TYPES[t] ?? []));
  const protocol = item.protocol === undefined ? undefined : PROTOCOLS[item.protocol];
  const roamingProtocol = item.roamingProtocol === undefined ? undefined : PROTOCOLS[item.roamingProtocol];
  const auth = item.authtype === undefined ? undefined : AUTH.get(item.authtype);
  const rats = bearers(item.bearerBitmask);
  const label = text(item.name), user = text(item.user), proxy = text(item.proxy), port = text(item.port);
  const mmsc = text(item.mmsc), mmsProxy = text(item.mmscProxy), mmsPort = text(item.mmscProxyPort);
  return {
    apn: item.value ?? "",
    ...(label !== undefined ? { label } : {}),
    types,
    ...(protocol !== undefined ? { protocol } : {}),
    ...(roamingProtocol !== undefined ? { roamingProtocol } : {}),
    ...(auth !== undefined ? { auth } : {}),
    ...(user !== undefined ? { user } : {}),
    ...(item.password !== undefined ? { hasPassword: item.password !== "" } : {}),
    ...(proxy !== undefined ? { proxy } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(mmsc !== undefined ? { mmsc } : {}),
    ...(mmsProxy !== undefined ? { mmsProxy } : {}),
    ...(mmsPort !== undefined ? { mmsPort } : {}),
    ...(item.mtu !== undefined && item.mtu > 0 ? { mtu: item.mtu } : {}),
    ...(rats !== undefined ? { bearers: rats } : {}),
    path: `apns[${i}]`,
  };
}

export const androidApns = (items: readonly ApnItem[]): Apn[] => items.map(apnOf);
