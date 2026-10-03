/** Google carrier settings protobufs as JSON: proto field names camel-cased, `optional` fields never defaulted. */

/** CarrierConfig.Config's oneof value. */
export type CarrierConfigValue =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "int"; readonly value: number }
  /** int64, as a decimal string. */
  | { readonly type: "long"; readonly value: string }
  | { readonly type: "bool"; readonly value: boolean }
  | { readonly type: "double"; readonly value: number }
  | { readonly type: "text_array"; readonly value: readonly string[] }
  | { readonly type: "int_array"; readonly value: readonly number[] }
  | { readonly type: "bundle"; readonly value: Readonly<Record<string, CarrierConfigValue>> };

/** Enum values newer than the proto this decoder knows come through as `UNKNOWN_<n>`. */
export type UnknownEnum = `UNKNOWN_${number}`;

export type AndroidApnType =
  | "ALL" | "DEFAULT" | "MMS" | "SUPL" | "DUN" | "HIPRI" | "FOTA" | "IMS" | "CBS" | "IA"
  | "EMERGENCY" | "XCAP" | "UT" | "RCS" | UnknownEnum;
export type AndroidProtocol = "IP" | "IPV6" | "IPV4V6" | "PPP" | UnknownEnum;
export type Skip464Xlat = "SKIP_464XLAT_DEFAULT" | "SKIP_464XLAT_DISABLE" | "SKIP_464XLAT_ENABLE" | UnknownEnum;

export interface ApnItem {
  readonly name?: string;
  /** The APN itself. */
  readonly value?: string;
  readonly type: readonly AndroidApnType[];
  readonly bearerBitmask?: string;
  readonly server?: string;
  readonly proxy?: string;
  readonly port?: string;
  readonly user?: string;
  readonly password?: string;
  readonly authtype?: number;
  readonly mmsc?: string;
  readonly mmscProxy?: string;
  readonly mmscProxyPort?: string;
  readonly protocol?: AndroidProtocol;
  readonly roamingProtocol?: AndroidProtocol;
  readonly mtu?: number;
  readonly profileId?: number;
  readonly maxConns?: number;
  readonly waitTime?: number;
  readonly maxConnsTime?: number;
  readonly modemCognitive?: boolean;
  readonly userVisible?: boolean;
  readonly userEditable?: boolean;
  readonly apnSetId?: number;
  readonly skip464xlat?: Skip464Xlat;
}

export interface VendorConfigClient {
  readonly name: string;
  /** Opaque bytes, base64. */
  readonly value?: string;
}

/** A field the decoder has no name for. `value`: decimal for varints, little-endian hex for fixed, base64 for bytes. */
export interface UnknownField {
  readonly path: string;
  readonly field: number;
  readonly wire: "varint" | "fixed64" | "bytes" | "fixed32";
  readonly value: string;
}

/** One <canonical_name>.pb. */
export interface CarrierSettings {
  readonly canonicalName?: string;
  /** int64, as a decimal string. */
  readonly version?: string;
  readonly apns: readonly ApnItem[];
  readonly configs: Readonly<Record<string, CarrierConfigValue>>;
  readonly vendorConfigs: readonly VendorConfigClient[];
  readonly unknown: readonly UnknownField[];
}

/** others.pb: many CarrierSettings in one file. */
export interface MultiCarrierSettings {
  readonly version?: string;
  readonly settings: readonly CarrierSettings[];
  readonly unknown: readonly UnknownField[];
}

/** CarrierId's `mvno_data` oneof: spn exact, imsi prefix pattern, or gid1 prefix. */
export type Mvno =
  | { readonly kind: "spn"; readonly value: string }
  | { readonly kind: "imsi"; readonly value: string }
  | { readonly kind: "gid1"; readonly value: string };

export interface CarrierId {
  readonly mccMnc?: string;
  readonly mvno?: Mvno;
}

export interface CarrierMap {
  readonly canonicalName?: string;
  readonly carrierIds: readonly CarrierId[];
}

/** carrier_list.pb */
export interface CarrierList {
  readonly version?: string;
  readonly entries: readonly CarrierMap[];
  readonly unknown: readonly UnknownField[];
}
