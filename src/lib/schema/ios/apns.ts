/**
 * APNs from a phone's merged iOS settings. iOS keeps them in three shapes:
 *   apns[i]                        one APN, types in `type-mask`
 *   apns[i].configuration[j]       a group sharing the outer `technology-mask`
 *   AttachAPN.<3GPP|WiFiCalling3GPP>  the initial-attach APN (one dict or a list)
 * and the MMS centre in MMS.MMSC / MMS.Proxy rather than on the APN. Each comes
 * out as one Apn with its native path, in the layer (file) that set it.
 */

import { isJsonDict } from "#lib/decode/index.ts";
import type { Apn, ApnAuth, ApnType, IpProtocol } from "../types.ts";
import { num, stringSet, text } from "../values.ts";
import { read, type Settings } from "./settings.ts";

/** CTDataConnectionServiceType bit (fields.ts SERVICE_TYPES) -> the APN type Android names the same traffic. */
const SERVICE_TYPE_APN: ReadonlyMap<number, ApnType> = new Map([
  [0, "default"], // Internet
  [2, "mms"],
  [4, "dun"], // WirelessModemTraffic: Personal Hotspot
  [17, "ims"],
  [18, "emergency"],
  [20, "xcap"], // UT: XCAP / Ut supplementary services
]);

/** DataProtocolFamily (fields.ts PROTOCOL_FAMILY); 0 "Any" says nothing. */
const PROTOCOL: ReadonlyMap<number, IpProtocol> = new Map([[1, "ip"], [2, "ipv6"], [3, "ipv4v6"]]);

/** technology-mask bits (fields.ts RAT_BITS). Bit 0 is the whole 3GPP 2G/3G family. */
const RAT: ReadonlyArray<readonly [number, readonly string[]]> = [
  [0, ["gsm", "umts"]], [1, ["cdma"]], [2, ["ehrpd"]], [3, ["lte"]], [4, ["nr"]],
];

const bitsOf = (mask: number): number[] => {
  const out: number[] = [];
  for (let bit = 0; bit < 53 && 2 ** bit <= mask; bit++) if (Math.floor(mask / 2 ** bit) % 2 === 1) out.push(bit);
  return out;
};

function types(mask: number | undefined): ApnType[] {
  if (mask === undefined) return [];
  return stringSet(bitsOf(mask).flatMap((b) => SERVICE_TYPE_APN.get(b) ?? []));
}

function bearers(mask: number | undefined): string[] | undefined {
  if (mask === undefined) return undefined;
  const rats = stringSet(bitsOf(mask).flatMap((b) => RAT.find(([bit]) => bit === b)?.[1] ?? []));
  return rats.length ? rats : undefined;
}

function auth(v: unknown): ApnAuth | undefined {
  const t = text(v)?.toLowerCase();
  if (t === undefined) return undefined;
  if (t.includes("pap") && t.includes("chap")) return "pap_or_chap";
  if (t === "pap" || t === "chap" || t === "none") return t;
  return undefined;
}

const protocol = (v: unknown): IpProtocol | undefined => {
  const n = num(v);
  return n === undefined ? undefined : PROTOCOL.get(n);
};

interface MmsServer { mmsc?: string; mmsProxy?: string; mmsPort?: string }

/** MMS.Proxy is `host` or `host:port`; Android keeps the port apart, so it is split the same way. */
function mmsServer(s: Settings): MmsServer {
  const mmsc = text(read(s, "MMS.MMSC")?.value);
  const proxy = text(read(s, "MMS.Proxy")?.value);
  const m = proxy === undefined ? undefined : /^(.*?)(?::(\d+))?$/.exec(proxy);
  return {
    ...(mmsc !== undefined ? { mmsc } : {}),
    ...(m?.[1] ? { mmsProxy: m[1] } : {}),
    ...(m?.[2] ? { mmsPort: m[2] } : {}),
  };
}

function apnFrom(d: Readonly<Record<string, unknown>>, path: string, extra: { types?: ApnType[]; techMask?: number | undefined }, mms: MmsServer): Apn | undefined {
  const apn = typeof d.apn === "string" ? d.apn : undefined;
  if (apn === undefined) return undefined;
  const t = stringSet([...types(num(d["type-mask"])), ...(extra.types ?? [])]);
  const proto = protocol(d.AllowedProtocolMask);
  const roaming = protocol(d.AllowedProtocolMaskInRoaming ?? d.AllowedProtocolMaskInRoamingLTE);
  const au = auth(d.auth_type);
  const user = text(d.username);
  const rats = bearers(num(d["technology-mask"]) ?? extra.techMask);
  return {
    apn,
    types: t,
    ...(proto !== undefined ? { protocol: proto } : {}),
    ...(roaming !== undefined ? { roamingProtocol: roaming } : {}),
    ...(au !== undefined ? { auth: au } : {}),
    ...(user !== undefined ? { user } : {}),
    ...(typeof d.password === "string" ? { hasPassword: d.password !== "" } : {}),
    ...(t.includes("mms") ? mms : {}),
    ...(rats !== undefined ? { bearers: rats } : {}),
    path,
  };
}

const dicts = (v: unknown): Array<Readonly<Record<string, unknown>>> =>
  (Array.isArray(v) ? v : [v]).filter(isJsonDict);

/** Every APN the settings define, in file order: apns, then AttachAPN. */
export function iosApns(s: Settings): Apn[] {
  const mms = mmsServer(s);
  const out: Apn[] = [];
  const apns = read(s, "apns");
  if (apns && Array.isArray(apns.value)) {
    const base = apns.ref.path;
    apns.value.forEach((entry: unknown, i: number) => {
      if (!isJsonDict(entry)) return;
      if (Array.isArray(entry.configuration)) {
        const techMask = num(entry["technology-mask"]);
        entry.configuration.forEach((c: unknown, j: number) => {
          const a = isJsonDict(c) ? apnFrom(c, `${base}[${i}].configuration[${j}]`, { techMask }, mms) : undefined;
          if (a) out.push(a);
        });
      } else {
        const a = apnFrom(entry, `${base}[${i}]`, {}, mms);
        if (a) out.push(a);
      }
    });
  }
  for (const access of ["3GPP", "WiFiCalling3GPP"] as const) {
    const attach = read(s, `AttachAPN.${access}`);
    if (!attach) continue;
    const list = dicts(attach.value);
    list.forEach((d, i) => {
      const path = Array.isArray(attach.value) ? `${attach.ref.path}[${i}]` : attach.ref.path;
      const a = apnFrom(d, path, { types: ["ia"] }, mms);
      // An empty attach APN means "let the network choose"; it is still the attach rule.
      if (a) out.push(a);
    });
  }
  return out;
}
