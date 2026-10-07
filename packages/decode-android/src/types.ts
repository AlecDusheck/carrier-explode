/**
 * Google carrier settings protobufs as JSON: proto field names camel-cased, `optional` fields never
 * defaulted. Names (canonical_name, mcc_mnc) are required here: without them a record identifies nothing.
 */

/** CarrierConfig.Config's oneof value. */
export type CarrierConfigValue =
	| { readonly kind: "text"; readonly value: string }
	| { readonly kind: "int"; readonly value: number }
	/** int64, as a decimal string. */
	| { readonly kind: "long"; readonly value: string }
	| { readonly kind: "bool"; readonly value: boolean }
	| { readonly kind: "double"; readonly value: number }
	| { readonly kind: "text_array"; readonly value: readonly string[] }
	| { readonly kind: "int_array"; readonly value: readonly number[] }
	| { readonly kind: "bundle"; readonly value: Readonly<Record<string, CarrierConfigValue>> };

/** Enum values newer than the proto this decoder knows come through as `UNKNOWN_<n>`. */
export type UnknownEnum = `UNKNOWN_${number}`;

/** Each enum's names, by value. */
export const APN_TYPES = [
	"ALL",
	"DEFAULT",
	"MMS",
	"SUPL",
	"DUN",
	"HIPRI",
	"FOTA",
	"IMS",
	"CBS",
	"IA",
	"EMERGENCY",
	"XCAP",
	"UT",
	"RCS",
] as const;
/** NON_IP and UNSTRUCTURED as ApnSetting numbers them; the published proto stops at PPP, but satellite APNs use 4. */
export const PROTOCOLS = ["IP", "IPV6", "IPV4V6", "PPP", "NON_IP", "UNSTRUCTURED"] as const;
export const XLAT = ["SKIP_464XLAT_DEFAULT", "SKIP_464XLAT_DISABLE", "SKIP_464XLAT_ENABLE"] as const;

export type AndroidApnType = (typeof APN_TYPES)[number] | UnknownEnum;
export type AndroidProtocol = (typeof PROTOCOLS)[number] | UnknownEnum;
export type Skip464Xlat = (typeof XLAT)[number] | UnknownEnum;

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
	/** TelephonyManager NETWORK_TYPE_* numbers, unlike bearerBitmask's RIL radio technologies. */
	readonly lingeringNetworkTypeBitmask?: string;
	readonly alwaysOn?: boolean;
	readonly mtuV6?: number;
	/** ApnSetting INFRASTRUCTURE_*: 1 cellular, 2 satellite. */
	readonly infrastructureBitmask?: number;
	readonly esimBootstrapProvisioning?: number;
}

export interface VendorConfigClient {
	readonly name: string;
	/** Opaque bytes, base64. */
	readonly value?: string;
}

/** A field the decoder has no name for, and where it sat (`apns[2]`, `configs.foo_bundle`, `` for the root). */
export interface UnknownField {
	readonly path: string;
	readonly field: number;
	readonly wire: "varint" | "fixed64" | "bytes" | "fixed32";
	/** Decimal for varints, little-endian hex for fixed32/64, base64 for bytes. */
	readonly value: string;
}

/** One <canonical_name>.pb. */
export interface CarrierSettings {
	readonly canonicalName: string;
	/** int64, as a decimal string. */
	readonly version?: string;
	readonly apns: readonly ApnItem[];
	readonly configs: Readonly<Record<string, CarrierConfigValue>>;
	readonly vendorConfigs: readonly VendorConfigClient[];
	/** ISO 8601: when Google built the file. */
	readonly lastUpdated?: string;
	readonly unknown: readonly UnknownField[];
}

/** CarrierId's `mvno_data` oneof: spn exact, imsi prefix pattern, gid1 prefix, or iccid prefix. */
export interface Mvno {
	readonly kind: "spn" | "imsi" | "gid1" | "iccid";
	readonly value: string;
}

export interface CarrierId {
	readonly mccMnc: string;
	readonly mvno?: Mvno;
}

export interface CarrierMap {
	readonly canonicalName: string;
	readonly carrierIds: readonly CarrierId[];
}

/** carrier_list.pb */
export interface CarrierList {
	readonly version?: string;
	readonly lastUpdated?: string;
	readonly entries: readonly CarrierMap[];
	readonly unknown: readonly UnknownField[];
}
