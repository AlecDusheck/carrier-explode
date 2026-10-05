/** Pixel carrier settings for the v2 fixture bucket: a few carriers written as CarrierSettings protobufs, and the carrier list naming their SIMs. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const enc = new TextEncoder();

function varint(n: bigint): number[] {
  const out: number[] = [];
  // Negative ints are ten bytes of two's complement on the wire.
  let v = BigInt.asUintN(64, n);
  do {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    out.push(v ? b | 0x80 : b);
  } while (v);
  return out;
}

const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
};
const tag = (field: number, wire: number): number[] => varint(BigInt((field << 3) | wire));
const int = (field: number, v: number | bigint): Uint8Array => new Uint8Array([...tag(field, 0), ...varint(BigInt(v))]);
const bytes = (field: number, b: Uint8Array): Uint8Array => cat(new Uint8Array([...tag(field, 2), ...varint(BigInt(b.length))]), b);
const str = (field: number, s: string): Uint8Array => bytes(field, enc.encode(s));
const msg = (field: number, ...parts: Uint8Array[]): Uint8Array => bytes(field, cat(...parts));

type Value = string | number | boolean | readonly string[] | readonly number[];

/** One Config: key, then the value in the field its type takes. */
function config(key: string, v: Value): Uint8Array {
  if (typeof v === "string") return msg(2, str(1, key), str(2, v));
  if (typeof v === "boolean") return msg(2, str(1, key), int(5, v ? 1 : 0));
  if (typeof v === "number") return msg(2, str(1, key), int(3, v));
  if (v.every((x) => typeof x === "number")) return msg(2, str(1, key), msg(7, ...v.map((x) => int(1, x))));
  return msg(2, str(1, key), msg(6, ...v.map((x) => str(1, String(x)))));
}

const APN_TYPE = { DEFAULT: 1, MMS: 2, SUPL: 3, DUN: 4, IMS: 7, IA: 9, XCAP: 11 } as const;
const PROTOCOL = { IP: 0, IPV6: 1, IPV4V6: 2 } as const;

interface Apn {
  readonly name: string;
  readonly apn: string;
  readonly types: ReadonlyArray<keyof typeof APN_TYPE>;
  readonly protocol: keyof typeof PROTOCOL;
  readonly mmsc?: string;
}

const apn = (a: Apn): Uint8Array =>
  msg(2, str(1, a.name), str(2, a.apn), ...a.types.map((t) => int(3, APN_TYPE[t])), ...(a.mmsc ? [str(11, a.mmsc)] : []),
    int(14, PROTOCOL[a.protocol]), int(15, PROTOCOL.IPV4V6));

function settings(name: string, version: bigint, apns: readonly Apn[], configs: Readonly<Record<string, Value>>): Uint8Array {
  return cat(str(1, name), int(2, version), msg(3, ...apns.map(apn)), msg(4, ...Object.entries(configs).map(([k, v]) => config(k, v))));
}

export interface AndroidFixture {
  readonly name: string;
  /** The file a device carries in a build: `generation` 0 is the older build. */
  readonly bytes: (generation: number, device: string) => Uint8Array;
}

export const ANDROID_FILES: readonly AndroidFixture[] = [
  {
    name: "att_us",
    bytes: (g, device) => settings("att_us", 79000000030n + BigInt(g * 4 + (device === "frankel" ? 1 : 0)), [
      { name: "ATT Nextgenphone", apn: "nxtgenphone", types: ["DEFAULT", "MMS", "SUPL"], protocol: "IPV4V6", mmsc: "http://mmsc.mobile.att.net" },
      { name: "ATT IMS", apn: "ims", types: ["IMS"], protocol: "IPV4V6" },
      { name: "ATT Hotspot", apn: "Broadband", types: ["DUN"], protocol: "IPV4V6" },
    ], {
      carrier_name_string: "AT&T",
      carrier_volte_available_bool: true,
      carrier_wfc_ims_available_bool: true,
      carrier_nr_availabilities_int_array: g ? [1, 2] : [1],
      vonr_enabled_bool: g > 0,
      maxMessageSize: 1048576,
      emergency_number_prefix_string_array: ["911"],
      ...(device === "frankel" ? { satellite_attach_supported_bool: true } : {}),
    }),
  },
  {
    name: "tmobile_us",
    bytes: (g) => settings("tmobile_us", 79000000020n + BigInt(g), [
      { name: "T-Mobile US LTE", apn: "fast.t-mobile.com", types: ["DEFAULT", "MMS", "SUPL", "XCAP"], protocol: "IPV6", mmsc: "http://mms.msg.eng.t-mobile.com/mms/wapenc" },
      { name: "T-Mobile IMS", apn: "ims", types: ["IMS"], protocol: "IPV6" },
    ], {
      carrier_name_string: "T-Mobile",
      carrier_volte_available_bool: true,
      carrier_wfc_ims_available_bool: true,
      carrier_nr_availabilities_int_array: [1, 2],
      vonr_enabled_bool: true,
      maxMessageSize: g ? 3145728 : 1048576,
    }),
  },
  {
    name: "verizon_us",
    bytes: (g) => settings("verizon_us", 79000000010n + BigInt(g), [
      { name: "Verizon Internet", apn: "VZWINTERNET", types: ["DEFAULT", "SUPL"], protocol: "IPV4V6" },
      { name: "Verizon IMS", apn: "VZWIMS", types: ["IMS"], protocol: "IPV4V6" },
      { name: "Verizon Admin", apn: "VZWADMIN", types: ["IA"], protocol: "IPV4V6" },
    ], {
      carrier_name_string: "Verizon",
      carrier_volte_available_bool: true,
      carrier_wfc_ims_available_bool: true,
      carrier_nr_availabilities_int_array: [1],
      maxMessageSize: 1228800,
      // Structured values, as Verizon's own file writes them.
      iwlan_handover_policy_string_array: [
        "source=GERAN|UTRAN|EUTRAN|NGRAN|IWLAN|UNKNOWN, target=GERAN|UTRAN|EUTRAN|NGRAN|IWLAN, roaming=true, type=disallowed, capabilities=IMS|EIMS|MMS|XCAP|CBS",
        "source=IWLAN|UNKNOWN, target=GERAN|UTRAN, type=disallowed, capabilities=IMS|EIMS|MMS|XCAP|CBS",
        "source=GERAN|UTRAN, target=IWLAN, type=disallowed, capabilities=IMS|EIMS|MMS|XCAP|CBS",
        "source=EUTRAN|NGRAN|IWLAN|UNKNOWN, target=EUTRAN|NGRAN|IWLAN, type=disallowed, capabilities=EIMS",
        "source=EUTRAN|NGRAN|IWLAN, target=EUTRAN|NGRAN|IWLAN, type=allowed, capabilities=IMS|MMS|XCAP|CBS",
      ],
      telephony_data_setup_retry_rules_string_array: [
        "capabilities=eims, retry_interval=1000, maximum_retries=20",
        "permanent_fail_causes=8|27|28|29|32|33|35|50|51|-5|-6|65538|-3, retry_interval=2500",
        "capabilities=mms|supl|cbs, retry_interval=2000",
        "capabilities=internet|enterprise|dun|ims|fota, retry_interval=2500|3000|5000|10000|15000|20000|40000|60000|120000|240000|600000|1200000|1800000, maximum_retries=20",
      ],
      "5g_icon_configuration_string": "connected_mmwave:5G_Plus,connected:5G,not_restricted_rrc_idle:5G,not_restricted_rrc_con:5G",
      "5g_icon_display_grace_period_string": "connected_mmwave,any,3;not_restricted_rrc_idle,not_restricted_rrc_con,2",
      lte_rsrp_thresholds_int_array: [-115, -105, -95, -85],
      ims_reasoninfo_mapping_string_array: ["501|call completion elsewhere|1014", "*|Call is dropped due to Wi-Fi signal is degraded|1407"],
      carrier_certificate_string_array: ["FF82050BF6BED1F152AC1A12DC83CACBAD401775161882872C6665FC5E15C8F2:com.verizon.mips.services"],
    }),
  },
  {
    name: "docomo_jp",
    bytes: (g) => settings("docomo_jp", 79000000040n + BigInt(g), [
      { name: "sp-mode", apn: "spmode.ne.jp", types: ["DEFAULT", "MMS", "SUPL"], protocol: "IPV4V6" },
      { name: "IMS", apn: "ims", types: ["IMS"], protocol: "IPV4V6" },
    ], {
      carrier_name_string: "NTT DOCOMO",
      carrier_volte_available_bool: true,
      carrier_nr_availabilities_int_array: [1, 2],
    }),
  },
  {
    name: "spektrummso_us",
    bytes: () => readFileSync(join(import.meta.dirname, "../../../../../packages/firmware/test/fixtures/android/tree/etc/CarrierSettings/spektrummso_us.pb")),
  },
];

const carrierId = (mccMnc: string, spn?: string): Uint8Array => msg(2, str(1, mccMnc), ...(spn ? [str(2, spn)] : []));

/** carrier_list.pb: each canonical name and the SIMs that load it. */
export const CARRIER_LIST: Uint8Array = cat(
  msg(1, str(1, "att_us"), carrierId("310410"), carrierId("310280")),
  msg(1, str(1, "tmobile_us"), carrierId("310260"), carrierId("310160")),
  msg(1, str(1, "verizon_us"), carrierId("311480"), carrierId("310590")),
  msg(1, str(1, "docomo_jp"), carrierId("44010")),
  msg(1, str(1, "spektrummso_us"), carrierId("311480", "Spectrum")),
  int(2, 7),
);
