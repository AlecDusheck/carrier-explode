/**
 * Decoded shapes of Google's carrier settings protobufs (AOSP
 * tools/carrier_settings/proto/carrier_settings.proto and carrier_list.proto),
 * as plain JSON. Field names are the proto's, camel-cased. Contract file: the
 * schema mapper (src/lib/schema/android.ts) is written against these.
 */

/** CarrierConfig.Config value, tagged by which oneof member was set. */
export type CarrierConfigValue =
  | { type: "text"; value: string }
  | { type: "int"; value: number }
  | { type: "long"; value: string } // int64, as a decimal string
  | { type: "bool"; value: boolean }
  | { type: "double"; value: number }
  | { type: "text_array"; value: string[] }
  | { type: "int_array"; value: number[] }
  | { type: "bundle"; value: Record<string, CarrierConfigValue> };

export type AndroidApnType =
  | "ALL" | "DEFAULT" | "MMS" | "SUPL" | "DUN" | "HIPRI" | "FOTA" | "IMS" | "CBS" | "IA"
  | "EMERGENCY" | "XCAP" | "UT" | "RCS" | `UNKNOWN_${number}`;
export type AndroidProtocol = "IP" | "IPV6" | "IPV4V6" | "PPP" | `UNKNOWN_${number}`;

/** ApnItem. Fields the file does not set are absent (proto defaults are NOT filled in). */
export interface ApnItem {
  name?: string;
  value?: string; // the APN itself
  type: AndroidApnType[];
  bearerBitmask?: string;
  server?: string;
  proxy?: string;
  port?: string;
  user?: string;
  password?: string;
  authtype?: number;
  mmsc?: string;
  mmscProxy?: string;
  mmscProxyPort?: string;
  protocol?: AndroidProtocol;
  roamingProtocol?: AndroidProtocol;
  mtu?: number;
  profileId?: number;
  maxConns?: number;
  waitTime?: number;
  maxConnsTime?: number;
  modemCognitive?: boolean;
  userVisible?: boolean;
  userEditable?: boolean;
  apnSetId?: number;
  skip464xlat?: "SKIP_464XLAT_DEFAULT" | "SKIP_464XLAT_DISABLE" | "SKIP_464XLAT_ENABLE" | `UNKNOWN_${number}`;
}

export interface VendorConfigClient {
  name: string;
  /** Opaque bytes, base64. */
  value?: string;
}

/** CarrierSettings: one <canonical_name>.pb. */
export interface CarrierSettings {
  canonicalName: string;
  /** int64 as a decimal string. */
  version?: string;
  apns: ApnItem[];
  configs: Record<string, CarrierConfigValue>;
  vendorConfigs: VendorConfigClient[];
  /** Fields this decoder does not know, anywhere in the file (additive; absent when there are none). */
  unknown?: UnknownField[];
}

/** MultiCarrierSettings: others.pb holds many CarrierSettings in one file. */
export interface MultiCarrierSettings {
  version?: string;
  settings: CarrierSettings[];
  unknown?: UnknownField[];
}

/** CarrierId: mcc_mnc plus at most one of spn / imsi (prefix pattern) / gid1 (prefix). */
export interface CarrierId {
  mccMnc: string;
  spn?: string;
  imsi?: string;
  gid1?: string;
}

/** carrier_list.pb */
export interface CarrierList {
  version?: string;
  entries: Array<{ canonicalName: string; carrierIds: CarrierId[] }>;
  unknown?: UnknownField[];
}

/**
 * A protobuf field the decoder has no name for (a newer proto, a vendor
 * extension), kept so nothing in the file goes unseen. Additive to the contract.
 * `path` is where it sat, in decoded terms (`apns[2]`, `configs.foo_bundle`,
 * `vendorConfigs[0]`, `` for the root). `value`: varint as a decimal string,
 * fixed32/fixed64 as little-endian hex, length-delimited as base64.
 */
export interface UnknownField {
  path: string;
  field: number;
  wire: "varint" | "fixed64" | "bytes" | "fixed32";
  value: string;
}
