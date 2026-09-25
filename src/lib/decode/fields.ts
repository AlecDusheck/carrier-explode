/**
 * Field documentation for carrier.plist / country-bundle keys: what a key means,
 * its enum values and bitmask bits, and how sure we are. Shipped to the browser
 * so the viewer can explain a field without a round trip.
 *
 * Evidence comes from iOS 27.0 (24A437) binaries, the value distribution across
 * the 907 bundles in that build, and public specs. `confidence` is omitted when
 * the meaning was read from code or a spec; "med" means code plus a consistent
 * value pattern; "low" means inferred from the name and values only.
 */

import { maskBits } from "./bytes";
import { describeMessageId } from "./cbs";
import type { Confidence } from "./confidence";
import { describeImsSetting, defaultEndReason, TERMINATION_EVENTS, type ImsSetting } from "./ims";

export type FieldType = "string" | "integer" | "real" | "boolean" | "data" | "date" | "array" | "dict";

/** How the value should be read beyond its plist type. */
export type FieldFormat = "bitmask" | "enum" | "plmn" | "cbs-message-id";

export interface FieldDoc {
  note: string;
  type?: FieldType;
  format?: FieldFormat;
  /** Value used when the key is absent, where the reader's default is known. */
  default?: string | number | boolean;
  /** Enum value -> label. */
  values?: Readonly<Record<string, string>>;
  /** Bit index -> label, for bitmasks. */
  bits?: Readonly<Record<number, string>>;
  unit?: string;
  /** Omitted = high. */
  confidence?: Confidence;
}

/* ------------------------------------------------------------------------ */
/* Shared tables                                                            */
/* ------------------------------------------------------------------------ */

/** CTDataConnectionServiceType; bit index == enum index.
 *  libCommCenterBase.dylib: _kCTDataConnectionServiceTypeFromIndex (36-entry table) */
export const SERVICE_TYPES: Readonly<Record<number, string>> = {
  0: "Internet",
  1: "VVM (visual voicemail)",
  2: "MMS",
  3: "PushEmail",
  4: "WirelessModemTraffic (Personal Hotspot data)",
  5: "WirelessModemAuthentication (Personal Hotspot auth)",
  6: "CellularDataPlanProvisioning",
  7: "AppleWirelessDiagnostics",
  8: "DataTest",
  9: "OTAActivation",
  10: "3GFaceTimeTraffic",
  11: "3GFaceTimeAuthentication",
  12: "OMADM",
  13: "OTAInternet",
  14: "ZeroRated",
  15: "EntitlementTraffic",
  16: "InternalDataProbe",
  17: "IMS",
  18: "Emergency",
  19: "BootstrapProvisioning",
  20: "UT (XCAP / Ut supplementary services)",
  21: "BootstrapRoamingInternetBypass",
  22: "EmergencyLocation",
  23: "CellularDataPlanProvisioning2",
  24: "CarrierSpace",
  25: "InternetProbe",
  26: "ThumperIMS (IMS for calls relayed to other devices)",
  27: "LLWirelessModemTraffic (low-latency hotspot)",
  28: "InternetSlice1",
  29: "InternetSlice2",
  30: "InternetSlice3",
  31: "InternetSlice4",
  32: "InternetSlice5",
  33: "InternetSlice6",
  34: "InternetSlice7",
  35: "InternetSlice8",
};

/** Radio technologies in `technology-mask` (MTU and APN entries). The decoder tests
 *  bits 0-4 only; bit 5 (32) occurs in bundles but is unnamed.
 *  CommCenter (macOS 26.6 build): technology-mask asString decoder (1 UMTS, 2 CDMA, 4 eHRPD, 8 LTE, 16 NR); bundle values agree */
export const RAT_BITS: Readonly<Record<number, string>> = {
  0: "UMTS (GSM/UMTS, 3GPP)",
  1: "CDMA 1x",
  2: "eHRPD",
  3: "LTE",
  4: "NR (5G)",
};

/** DataProtocolFamily. libCommCenterBase.dylib: asString(DataProtocolFamily) */
export const PROTOCOL_FAMILY: Readonly<Record<string, string>> = {
  0: "Any",
  1: "IPv4",
  2: "IPv6",
  3: "IPv4v6 (dual stack)",
};

/** AttachAPNType. libCommCenterBase.dylib: asString(AttachAPNType) */
export const ATTACH_APN_TYPE: Readonly<Record<string, string>> = {
  0: "Normal",
  1: "Provisioning",
  2: "VoLTE",
  3: "WiFiCalling",
  4: "DataOff",
  5: "Invalid",
};

/** How CommCenter classifies the bundle a value was read from.
 *  libCommCenterBase.dylib: asString(BundleType) */
export const BUNDLE_TYPE: Readonly<Record<string, string>> = {
  0: "Unknown",
  1: "Carrier",
  2: "Operator (MVNO override)",
  3: "Bootstrap",
  4: "Default",
  5: "CarrierCountry",
  6: "OperatorCountry",
  7: "DefaultBootstrap",
};

/** Entitlement classes, bit n = entitlement enum index n. Named span is 2-22; 4, 5
 *  and 9 are empty slots, 0, 1 and 23 fall outside it.
 *  CommCenter (macOS 26.6 build): entitlement name->index function and index->name table; bundle tally agrees (bit 19 only on satellite carriers) */
export const ENTITLEMENT_CLASSES: Readonly<Record<number, string>> = {
  2: "facetime",
  3: "tethering",
  6: "VoLTE",
  7: "VoWiFi",
  8: "iCloudVoWiFi (Wi-Fi calling on other devices)",
  10: "Multi-SIM (Watch number sharing)",
  11: "sa-watch (standalone Watch plan)",
  12: "MultiSIM-transfer",
  13: "iphone-plan-transfer",
  14: "sa-watch-transfer",
  15: "5g-service",
  16: "ipad-signup",
  17: "custom-qos",
  18: "private-net-provisioning",
  19: "nt-carrier-service (satellite)",
  20: "hera-service",
  21: "enhanced-throughput",
  22: "rcs",
};

/** Status-bar data labels a carrier can force. CommCenter (macOS 26.6 build) strings; support.apple.com/108383 */
export const DATA_INDICATOR: Readonly<Record<string, string>> = {
  "4G": "4G",
  LTE: "LTE",
  LTEA: "LTE-A",
  LTEPlus: "LTE+",
  "5GE": "5GE (LTE-Advanced, AT&T '5G Evolution')",
  NRPlus: "5G+",
  NRUWB: "5G UW",
  NRUC: "5G UC",
  NRCA: "NR carrier-aggregation label (icon unconfirmed)",
};

/** Emergency Service Category bits. 3GPP TS 24.008 10.5.4.33.
 *  libCommCenterBase.dylib: asString(EmergencyCategory) 1 Police, 2 Ambulance, 4 FireBrigade, 8 MarineGuard, 16 MountainRescue */
export const EMERGENCY_CATEGORY_BITS: Readonly<Record<number, string>> = {
  0: "Police",
  1: "Ambulance",
  2: "Fire Brigade",
  3: "Marine Guard",
  4: "Mountain Rescue",
  5: "Manually initiated eCall",
  6: "Automatically initiated eCall",
};

/** CDMA CMAS service categories. 3GPP2 C.R1001 */
export const CDMA_CMAS_CATEGORY: Readonly<Record<string, string>> = {
  4096: "Presidential-level alert",
  4097: "Extreme threat",
  4098: "Severe threat",
  4099: "Child abduction (AMBER)",
  4100: "CMAS test",
};

/** IKEv2 Diffie-Hellman groups. IANA IKEv2 Transform Type 4 (RFC 3526, 5903) */
export const IKE_DH_GROUP: Readonly<Record<string, string>> = {
  1: "768-bit MODP",
  2: "1024-bit MODP",
  5: "1536-bit MODP",
  14: "2048-bit MODP",
  15: "3072-bit MODP",
  16: "4096-bit MODP",
  17: "6144-bit MODP",
  18: "8192-bit MODP",
  19: "256-bit ECP (P-256)",
  20: "384-bit ECP (P-384)",
  21: "521-bit ECP (P-521)",
};

/** IKEv2 configuration attribute types. RFC 7296 3.15.1, RFC 7651; 16384-32767 private use */
export const IKE_CONFIG_ATTRIBUTE: Readonly<Record<string, string>> = {
  1: "INTERNAL_IP4_ADDRESS",
  3: "INTERNAL_IP4_DNS",
  8: "INTERNAL_IP6_ADDRESS",
  10: "INTERNAL_IP6_DNS",
  20: "P_CSCF_IP4_ADDRESS",
  21: "P_CSCF_IP6_ADDRESS",
  16384: "Private use",
  16385: "Private use",
  16386: "Private use",
  16389: "Private use",
  16390: "Private use",
};

/** Highest AMR-WB codec mode. 3GPP TS 26.201 */
export const AMR_WB_MODE: Readonly<Record<string, string>> = {
  0: "6.60 kbit/s",
  1: "8.85 kbit/s",
  2: "12.65 kbit/s",
  3: "14.25 kbit/s",
  4: "15.85 kbit/s",
  5: "18.25 kbit/s",
  6: "19.85 kbit/s",
  7: "23.05 kbit/s",
  8: "23.85 kbit/s",
};

/** Highest AMR-NB codec mode. 3GPP TS 26.071 */
export const AMR_NB_MODE: Readonly<Record<string, string>> = {
  0: "4.75 kbit/s",
  1: "5.15 kbit/s",
  2: "5.90 kbit/s",
  3: "6.70 kbit/s",
  4: "7.40 kbit/s",
  5: "7.95 kbit/s",
  6: "10.2 kbit/s",
  7: "12.2 kbit/s",
};

/** Slice/Service Type. 3GPP TS 23.501 5.15.2.2 */
export const SLICE_SERVICE_TYPE: Readonly<Record<string, string>> = {
  1: "eMBB",
  2: "URLLC",
  3: "MIoT",
  4: "V2X",
  5: "HMTC",
};

/** ERI text encoding. 3GPP2 C.R1001 data encoding table */
export const CDMA_TEXT_ENCODING: Readonly<Record<string, string>> = {
  0: "Octet",
  1: "IS-91 extended protocol",
  2: "7-bit ASCII",
  3: "IA5",
  4: "UNICODE (UCS-2)",
  5: "Shift-JIS",
  6: "Korean (KS X 1001)",
  7: "Latin/Hebrew (ISO 8859-8)",
  8: "Latin (ISO 8859-1)",
  9: "GSM 7-bit default alphabet",
};

/** sd::ImsServiceType option set; bit n = service. Unnamed bits are unused.
 *  libCommCenterBase.dylib: sd::asString(option_set<ImsServiceType>) */
export const IMS_SERVICE_BITS: Readonly<Record<number, string>> = {
  0: "Voice",
  1: "SMS",
  6: "Pager",
  7: "Chat",
  8: "Chatbot",
  11: "File transfer",
  12: "GeoPush",
  13: "Image",
  14: "Image",
  15: "IM",
  18: "E2EE",
  19: "Push",
};

/** Radio data modes as bits: bit n = DataMode n+1 (bits 5-8 unused).
 *  libCommCenterBase.dylib: asString(DataMode) 1 kGPRS .. 18 kLTEiTech */
export const DATA_MODE_BITS: Readonly<Record<number, string>> = {
  0: "GPRS",
  1: "EDGE",
  2: "WCDMA",
  3: "HSDPA",
  4: "HSUPA",
  9: "CDMA 1x",
  10: "EV-DO Rev0",
  11: "EV-DO RevA",
  12: "eHRPD",
  13: "LTE",
  14: "EV-DO RevB",
  15: "NR NSA",
  16: "NR SA",
  17: "LTE (iTech)",
};

/** How incoming SMS fan out across twinned devices. libCommCenterBase.dylib: asString(SMSForkingMechanism) */
export const SMS_FORKING_MECHANISM: Readonly<Record<string, string>> = {
  0: "primary-only",
  1: "fan-out-with-msg-ref",
  2: "fan-out-without-msg-ref",
  3: "selective",
  4: "primary-updating-to-fan-out-without-msg-ref",
};

/** libCommCenterBase.dylib: asString(SatelliteDataPlanTier) */
export const SATELLITE_TIER: Readonly<Record<string, string>> = {
  0: "No service",
  1: "Tier A",
  2: "Tier B",
  3: "Tier C",
  4: "Tier D",
  5: "Tier E",
};

/* ------------------------------------------------------------------------ */
/* Field table                                                              */
/* ------------------------------------------------------------------------ */

/** TerminationEvent name -> its ReasonCode. */
const TERMINATION_EVENT_VALUES: Readonly<Record<string, string>> = /* @__PURE__ */ Object.fromEntries(
  TERMINATION_EVENTS.map((name, code) => [name, `ReasonCode ${code}`]),
);

/** Parameters in Default.bundle's com.apple.bodythreshold_<class>.plist files.
 *  CoreMotion: CMOnBodyStatusManager key strings */
const BODY_THRESHOLD_KEYS = [
  "ClassifierTheta0", "ClassifierTheta1", "ClassifierTheta2", "ClassifierTheta3", "ClassifierTheta4", "ClassifierTheta5",
  "ClassifierMaxLowPower", "ClassifierMinLowPower", "ClassifierMaxHighPower", "LowBandStart", "LowBandStop",
  "HighBandStart", "HighBandStop", "OddsThreshold", "ConfidenceThreshold", "WakeThreshold", "AngleMetricThreshold",
  "MedianFilterSize", "UseHysteresis", "UseAngleOverride",
];
const bodyThreshold = (): Record<string, FieldDoc> =>
  Object.fromEntries(
    BODY_THRESHOLD_KEYS.map((k): [string, FieldDoc] => [
      `CMOnBodyStatusManager${k}`,
      { note: `CoreMotion on-body detection parameter (${k}); one file per device class.`, confidence: "med" },
    ]),
  );

const serviceMask = (note: string, confidence?: Confidence): FieldDoc => ({
  note,
  type: "integer",
  format: "bitmask",
  bits: SERVICE_TYPES,
  ...(confidence ? { confidence } : {}),
});

const protocolFamily = (note: string, confidence?: Confidence): FieldDoc => ({
  note,
  type: "integer",
  format: "enum",
  values: PROTOCOL_FAMILY,
  ...(confidence ? { confidence } : {}),
});

const plmnList = (note: string, confidence?: Confidence): FieldDoc => ({
  note,
  type: "array",
  format: "plmn",
  ...(confidence ? { confidence } : {}),
});

const unnamedMask = (note: string, confidence: Confidence = "low"): FieldDoc => ({
  note,
  type: "integer",
  format: "bitmask",
  confidence,
});

export const FIELDS: Readonly<Record<string, FieldDoc>> = {
  /* ---- identity / matching ---- */
  CarrierName: { note: "Operator name shown in the status bar and in Settings.", type: "string" }, // CommCenter (macOS 26.6 build); bundle values
  StatusBarCarrierName: { note: "Operator name used specifically in the status bar.", type: "string", confidence: "med" },
  OverrideOperatorWiFiName: { note: "Operator name shown while on Wi-Fi Calling. No iOS 27 reader found.", type: "string", confidence: "med" },
  PreferCarrierNameFromMetadata: { note: "Prefer the operator name from bundle metadata over the network-provided name. No iOS 27 reader found.", type: "boolean", confidence: "low" },
  HomeBundleIdentifier: { note: "The country bundle this carrier bundle sits on top of.", type: "string" }, // CommCenter (macOS 26.6 build); bundle values
  SupportedSIMs: plmnList("MCC+MNC values (optionally with _GID1-/_GID2-/_ID- qualifiers) this bundle claims. The handset picks a bundle by matching the SIM against this list."),
  SupportedPLMNs: plmnList("Networks treated as the home network for this bundle. No iOS 27 reader found."),
  IntlDataRoamingAllowed: plmnList("Networks where international data roaming is allowed without the roaming switch. No iOS 27 reader found.", "med"),
  IntlDataRoamingExceptions: plmnList("Networks exempt from the international data-roaming rules. No iOS 27 reader found.", "med"),
  BlacklistedSIMs: plmnList("SIM MCC+MNC values this bundle refuses to match.", "med"),
  AllPLMNs: plmnList("Every PLMN belonging to this operator. No iOS 27 reader found.", "med"),
  AllowPrefixMatching: { note: "Allow a SIM to match this bundle by MCC+MNC prefix.", type: "boolean", confidence: "med" },
  SupportedCarrierIds: { note: "US CDMA-style carrier IDs (e.g. 310VZW) this bundle claims. No iOS 27 reader found.", type: "array" },
  SupportedCountryIds: { note: "Country IDs (MCC or com.apple.<Country>) this bundle applies to. No iOS 27 reader found.", type: "array" },
  ISOAlpha2CountryCode: { note: "ISO-3166 alpha-2 codes covered by this country bundle.", type: "array" },
  CountryName: { note: "Country name of a country bundle.", type: "string" },
  MVNOOverrides: { note: "Per-MVNO deltas applied on top of the host operator's settings, keyed by Configuration_<name>; each entry matches SIMs (GID/SPN/IMSI) and holds an OverrideConfiguration. No iOS 27 reader found.", type: "dict" },
  SupportsNITZ: { note: "Honour network time and time-zone updates (NITZ).", type: "boolean", confidence: "med" },
  CBSignature1: { note: "Detached signature over the bundle's plists, checked before the bundle is trusted.", type: "data" }, // CarrierBundleUtilities.dylib: VerifyCarrierBundleSignature
  CBSignature2: { note: "Detached signature over the bundle's plists (SHA-2 variant).", type: "data" }, // CarrierBundleUtilities.dylib: PublicKeys::get_sha2_256
  CBSignature3: { note: "Detached signature over the bundle's plists (SHA-2 variant).", type: "data" }, // CarrierBundleUtilities.dylib: PublicKeys::get_sha2_384

  /* ---- entitlements / provisioning ---- */
  CarrierEntitlements: { note: "Entitlement server that gates carrier features (Wi-Fi Calling, tethering, Watch plans).", type: "dict" }, // libCommCenterBase.dylib: kCarrierEntitlementsWalletDomain export
  SupportedEntitlements: {
    // CommCenter (macOS 26.6 build): entitlement name->index table; bundle tally agrees
    note: "Bitmask of entitlement classes the device may query from the entitlement server. Bit n is entitlement enum index n. Bits 4, 5 and 9 are empty slots in the enum; bits 0, 1 and 23 lie outside its named range (bit 0 is set in almost every bundle).",
    type: "integer",
    format: "bitmask",
    bits: ENTITLEMENT_CLASSES,
  },
  SupportedEntitlementsStandaloneMode: {
    // CommCenter (macOS 26.6 build): same entitlement reader as SupportedEntitlements
    note: "SupportedEntitlements for standalone (Watch) mode; same bits.",
    type: "integer",
    format: "bitmask",
    bits: ENTITLEMENT_CLASSES,
    confidence: "med",
  },
  SupportedAuthorizationTokens: {
    // CommCenter (macOS 26.6 build): near service-token / transfer-token / blind-signature strings
    note: "Authorization-token types the entitlement client accepts (service-token, transfer-token, blind-signature). Almost always 2.",
    type: "integer",
    format: "bitmask",
    confidence: "low",
  },
  ServerAddress: { note: "Server URL (entitlement server when under CarrierEntitlements).", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  UpdatePeriod: { note: "How often the cached entitlement state (or the EncryptedIdentity certificate) is refreshed.", type: "integer", unit: "hours", default: 24, confidence: "med" }, // CommCenter (macOS 26.6 build): value x60, 1440 min default
  ProvisioningRecheckPeriod: { note: "How often a pending provisioning state is rechecked.", type: "integer", unit: "hours", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  EnableWiFiCallingWithoutEntitlement: { note: "Allow Wi-Fi Calling before the entitlement server approves it.", type: "boolean", confidence: "med" },
  RemoteCardProvisioningSettings: { note: "eSIM download settings: SM-DP+ hostnames, ICCID prefixes that match this carrier, and whether an Apple Account check is required.", type: "dict" },
  MatchingICCIDPrefixes: { note: "ICCID prefixes that route an eSIM download to this carrier. No iOS 27 reader found.", type: "array" },
  ProvisioningMethod: { note: "eSIM provisioning flow.", type: "string", format: "enum", values: { CarrierFlow: "Carrier-hosted web flow" } }, // CellularPlanManager
  SupportedSKUs: { note: "Device SKUs allowed to provision an eSIM with this carrier. No iOS 27 reader found.", type: "array", confidence: "med" },
  RequireLiveIDCheck: { note: "Requires a signed-in Apple Account before the eSIM can be downloaded. No iOS 27 reader found.", type: "boolean" },
  SupportsFauxCard: { note: "Carrier supports a placeholder eSIM profile during activation. No iOS 27 reader found.", type: "boolean", confidence: "low" },
  CellularTrialPlan: { note: "Trial eSIM plan offered at setup. No iOS 27 reader found.", type: "dict", confidence: "med" },
  SupportsTrialPlan: { note: "Carrier offers a trial eSIM plan. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  MinCompatibleWatchOS: { note: "Minimum watchOS for this carrier's Watch cellular plans.", type: "string" }, // CellularBridgeUI: -[NPHCellularBridgeUIManager _minMajorWatchOSVersionForSubscription:]
  MinCompatibleOS: { note: "Minimum OS version for this feature (e.g. account transfer). No iOS 27 reader found.", type: "string", confidence: "med" },
  PhoneAccountTransfer: { note: "Rules for moving a line between devices: SM-DP+ URL, one-time-code sender short codes, minimum OS.", type: "dict" },
  LocalInstallSMDPURL: { note: "SM-DP+ server used for on-device eSIM transfer. No iOS 27 reader found.", type: "string", confidence: "med" },
  SupportPhysicalSIMtoESIMTransfer: { note: "Carrier supports converting a physical SIM to eSIM.", type: "boolean", confidence: "med" },
  SupportsOnDevicePhysicalSIMConvert: { note: "Physical SIM can be converted to eSIM on the same device.", type: "boolean", confidence: "med" },
  SupportsFallbackToLegacyFlow: { note: "Transfer may fall back to the carrier's legacy web flow. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  TransferErrorCodes: { note: "Carrier error codes returned during eSIM transfer, mapped to handset behaviour. No iOS 27 reader found.", type: "dict", confidence: "med" },
  OTAActivation: { note: "Over-the-air activation behaviour, including SIMs excluded from it.", type: "dict" },
  OTAActivationAPN: { note: "APN used for over-the-air activation (type-mask usually OTAActivation). No iOS 27 reader found.", type: "dict", confidence: "med" },
  CellularPlanProvisioningSettings: { note: "Behaviour of the in-Settings 'Add Cellular Plan' flow.", type: "dict" },
  EncryptedIdentity: { note: "Certificate used to encrypt subscriber identity (IMSI privacy). No iOS 27 reader found.", type: "dict" },

  /* ---- data / APNs ---- */
  apns: { note: "Access Point Names. Each entry has a type-mask (which services may use it), protocol masks, credentials and optional per-technology overrides.", type: "array" }, // CommCenter (macOS 26.6 build): APNInfo formatter; bundle data
  apn: { note: "Access point name string.", type: "string" }, // CoreTelephony: kAPNCapability export; bundle data
  username: { note: "APN authentication username.", type: "string" },
  password: { note: "APN authentication password.", type: "string" },
  "type-mask": serviceMask("Bitmask of data services allowed on this APN (bit n = CTDataConnectionServiceType n). 48 = Personal Hotspot, 131072 = IMS, 262144 = Emergency."), // libCommCenterBase.dylib: _kCTDataConnectionServiceTypeFromIndex
  typemask: serviceMask("Legacy spelling of type-mask.", "low"),
  "tech-type-mask": serviceMask(
    "Service bitmask (same bits as type-mask, not a radio mask) merged per wireless technology. Seen on IMS/Emergency/XCAP APNs with SupportSwitchOver; most likely the services this APN may carry over the alternate (IWLAN/Wi-Fi) technology.",
    "med",
  ), // CommCenter (macOS 26.6 build): "merging tech-type-mask" log; APNInfo formatter uses the service-type printer
  serviceMask: serviceMask("Service bitmask (same bits as type-mask) selecting which services an iWLAN / Wi-Fi Calling policy applies to.", "med"), // Support/tech_config.plist: iWLanPolicies
  "technology-mask": {
    // CommCenter (macOS 26.6 build): technology-mask asString decoder; bundle values agree; bit 5 seen (32) but unnamed
    note: "Radio technologies this MTU or APN entry applies to. Absent = all technologies. Bit 5 (32) appears in some bundles but the decoder does not name it.",
    type: "integer",
    format: "bitmask",
    bits: RAT_BITS,
  },
  AllowedServicesTypeMaskOnInternet: serviceMask(
    "Services that may run over the public internet (e.g. Wi-Fi) instead of cellular. 32768 = EntitlementTraffic.",
    "med",
  ), // CommCenter (macOS 26.6 build): IsServiceOverPublicInternet
  IgnoresDeactivateOnNetworkScanServiceMask: serviceMask("Services whose data context stays up during a manual network scan (131072 = IMS, 393216 = IMS + Emergency).", "med"), // CommCenter (macOS 26.6 build): "CB::IgnoresDeactivateOnNetworkScanServiceMask" log
  IPCUApnTypemask: serviceMask("type-mask used for IPCU APN entries (probably APNs installed by a configuration profile).", "med"), // CommCenter (macOS 26.6 build): fIPCUApnTypemask log
  APNEditabilityTypemask: {
    // EDGESettings.bundle: tests &1, &2, &4, &0x20000 and 48
    ...serviceMask("Which APN sections Settings > Cellular Data Network lets the user edit, by service bit (1 Internet, 4 MMS, 48 Personal Hotspot, 131072 IMS). 0 = nothing editable.", "med"),
    default: 5,
  },
  APNEditabilityTypemaskNew: { ...serviceMask("Newer variant of APNEditabilityTypemask; same bits.", "med") },
  AllowEDGEEditing: { note: "Show the Cellular Data Network APN editor in Settings.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build)
  AllowAttachAPNEditing: { note: "Let the user edit the LTE attach APN in Settings. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  AllowedProtocolMask: protocolFamily("IP type requested for this APN. An enum despite the name. Absent = the handset's dual-stack default."), // libCommCenterBase.dylib: asString(DataProtocolFamily)
  DefaultProtocolMask: protocolFamily("Default IP type for this APN when no more specific mask applies.", "med"),
  AllowedProtocolMaskInRoaming: protocolFamily("IP type requested while roaming."), // ManagedConfiguration: -[MCAPNConfiguration initWithDictionary:outError:]
  AllowedProtocolMaskInDomesticRoaming: protocolFamily("IP type requested while roaming domestically."), // ManagedConfiguration: -[MCAPNConfiguration initWithDictionary:outError:]
  AllowedProtocolMaskInRoamingLTE: protocolFamily("IP type requested while roaming on LTE."),
  AllowedProtocolMaskInRoamingUMTS: protocolFamily("IP type requested while roaming on UMTS; pushed to the modem for the attach APN.", "med"), // libCommCenterMCommandDrivers.dylib: Mav20QMIAttachApnCommandDriver::performPushSettingsToBB_sync
  AllowedProtocolMaskInRoamingNR: protocolFamily("IP type requested while roaming on 5G NR. Not seen in the iOS 27 bundles.", "med"),
  AllowedPdpTypeMask: protocolFamily("PDP type requested for this context; same enum as AllowedProtocolMask (1, 2, 3 seen).", "med"), // bundle tally: values 1/2/3 only
  IPv6SupportedDataModeMask: {
    // libCommCenterBase.dylib: asString(DataMode) gives the bit names; CommCenter (macOS 26.6 build): isIPv6Allowed default 0x1B01C, LTE bit ORs in 0x18000
    note: "Radio data modes in which IPv6 is offered (bit n = data mode n+1). Absent = 0x1B01C (WCDMA, HSDPA, HSUPA, eHRPD, LTE, NR NSA, NR SA). Ignored for IPv4v6 APNs. The LTE bit (0x2000) also sets both NR bits (0x18000).",
    type: "integer",
    format: "bitmask",
    default: 110620,
    bits: DATA_MODE_BITS,
    confidence: "med",
  },
  RequiresIPv4v6PDPTypes: { note: "Force dual-stack IPv4v6 PDP activation.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build)
  enableXLAT464: { note: "Enable 464XLAT (IPv4 over an IPv6-only APN).", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): XLAT464 logs
  AllowNoDNS: { note: "Accept a data context that comes up without DNS servers. Values look like protocol-family codes.", type: "integer", values: PROTOCOL_FAMILY, confidence: "med" }, // CommCenter (macOS 26.6 build): APNInfo "allow no DNS"
  SupportSwitchOver: { note: "APN may hand over between cellular and Wi-Fi (IWLAN).", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): APNInfo "support SwitchOver"
  SupportContextSwitchOver: { note: "Data context may switch between technologies without teardown. No iOS 27 reader found.", type: "boolean", confidence: "low" },
  Support5GSaHandOver: { note: "APN supports handover to 5G standalone.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): APNInfo "support5GSaHandOver"
  UseNetworkMTU: { note: "Use the MTU the network supplies instead of the bundle's.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): APNInfo "use network MTU"
  NoCellularReconnectCauseCodes: { note: "Reconnect-throttle rules for this APN: {Type, CauseCodes, NumTriesAllowed, Timeout, RecoversOnAirplaneMode} entries.", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  CauseCodes: { note: "Network cause codes this rule applies to.", type: "array", confidence: "med" },
  NumTriesAllowed: { note: "Attempts allowed before the throttle rule applies.", type: "integer", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  AttachAPN: { note: "APN used at LTE/NR registration, before any user-selected APN. Keyed by attach context: 3GPP, 3GPP2, WiFiCalling3GPP.", type: "dict" }, // libCommCenterBase.dylib: getDefaultAttachApn, kWiFiCallingProfile export
  APNClass: { note: "APN class number pushed to the modem (Verizon-style: 1 IMS, 3 Internet).", type: "integer", confidence: "med" }, // libCommCenterMCommandDrivers.dylib: Mav20QMIAttachApnCommandDriver::performPushSettingsToBB_sync
  MTU: { note: "Per-technology MTU overrides: {size, technology-mask} entries.", type: "array" }, // CommCenter (macOS 26.6 build): kCFMTUSizeKey/kCFTechMaskKey; bundle data
  size: { note: "MTU in bytes (inside an MTU entry).", type: "integer", unit: "bytes", confidence: "med" },
  MMS: { note: "MMSC URL, WAP proxy, size limits and junk-report routing.", type: "dict" }, // CommCenter (macOS 26.6 build): DataConnectionMMS; bundle data
  MMSC: { note: "MMS message-center URL.", type: "string" },
  MaxMessageSize: { note: "Largest MMS the handset will send.", type: "integer", unit: "bytes", confidence: "med" },
  MaxRecipients: { note: "Largest number of recipients in one MMS.", type: "integer", confidence: "med" },
  GroupModeEnabled: { note: "Group messages are sent as group MMS.", type: "boolean", confidence: "med" },
  PcoOptions: { note: "Protocol Configuration Options containers to request from the network during attach (ContainerIds, PcoMcc, PcoMnc).", type: "dict" }, // libCommCenterMCommandDrivers.dylib: QMIDataContextIPAggregator::set3GPPParameters
  MaxBluetoothModemConnections: { note: "Maximum simultaneous Personal Hotspot connections over Bluetooth.", type: "integer", confidence: "med" },
  TetheringPhoneNumber: { note: "Number to call to add Personal Hotspot to the plan.", type: "string" }, // SettingsCellularUI: -[PSUICellularController setupCellularFaceTime:]
  DataIndicatorOverride: { note: "Forces the status-bar data label ('4G' in every iOS 27 bundle that sets it; shows 4G in place of 3G).", type: "string", format: "enum", values: DATA_INDICATOR }, // SettingsCellularUI: -[PSUICoreTelephonyCarrierBundleCache shouldOverride3Gto4G:]; bundle tally "4G" x20
  DataIndicatorOverrideForLTE: { note: "Forces the status-bar label on LTE: '4G' or 'LTE'.", type: "string", format: "enum", values: DATA_INDICATOR }, // CommCenter (macOS 26.6 build); bundle tally: "4G" x326, "LTE" x26
  DataIndicatorOverrideForEvo: { note: "Status-bar label on LTE-Advanced; AT&T sets '5GE'.", type: "string", format: "enum", values: DATA_INDICATOR }, // CommCenter (macOS 26.6 build); bundle values
  DataIndicatorOverrideForNRMmwave: { note: "Status-bar label on mmWave / high-band 5G: NRPlus (5G+), NRUWB (5G UW), NRUC (5G UC) or NRCA.", type: "string", format: "enum", values: DATA_INDICATOR }, // CommCenter (macOS 26.6 build); support.apple.com/108383
  SliceServiceType: { note: "5G network slice type (SST).", type: "integer", format: "enum", values: SLICE_SERVICE_TYPE }, // 3GPP TS 23.501

  /* ---- 5G / radio switches ---- */
  Show5GSwitch: { note: "Show the 5G options in Settings > Cellular.", type: "boolean", confidence: "med" },
  Enable5GAutoByDefault: { note: "Default the voice & data setting to '5G Auto'.", type: "boolean", confidence: "med" },
  Show5GStandaloneSwitch: { note: "Show the 5G standalone switch. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  Enable5GStandaloneByDefault: { note: "5G standalone on by default.", type: "boolean" }, // SettingsCellularUI: -[PSUICoreTelephonyCarrierBundleCache is5GSAEnabledByDefault:]
  Show5GWarningUnsupportedCarrier: { note: "Warn that the carrier does not support 5G.", type: "boolean" }, // SettingsCellularUI: -[PSUICoreTelephonyCarrierBundleCache show5GWarningUnsupportedCarrier:]
  ShowHighDataModeSwitch: { note: "Show the 'Allow More Data on 5G' / high data mode option.", type: "boolean", confidence: "med" },
  SupportsNRNSAInboundRoaming: { note: "Inbound roamers may use 5G NSA on this network. No iOS 27 reader found.", type: "boolean", confidence: "low" },
  Show4GSwitch: { note: "Show the 4G/LTE on-off switch. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  Show4GSwitchWith5G: { note: "Keep the 4G option visible alongside 5G options. No iOS 27 reader found.", type: "boolean", confidence: "low" },
  Show3GSwitch: { note: "Show the 3G on-off switch. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  Show3GSwitchWith4G: { note: "Show the 3G option alongside 4G. No iOS 27 reader found.", type: "boolean", confidence: "low" },
  Show3GSwitchWith5G: { note: "Show the 3G option alongside 5G. No iOS 27 reader found.", type: "boolean", confidence: "low" },
  Show3GSwitchWithVolte: { note: "Show the 3G option when VoLTE is on. No iOS 27 reader found.", type: "boolean", confidence: "low" },
  EnableLTEAfterUpgrade: { note: "Turn LTE on after an iOS update.", type: "boolean", confidence: "med" }, // libCommCenterBase.dylib: kCFEnableLTEAfterUpgrade export
  NetworkEncryptionCiphers: { note: "Ciphers the modem is permitted to negotiate. No iOS 27 reader found.", type: "dict" },
  "A5/3": { note: "GSM A5/3 ciphering allowed. No iOS 27 reader found.", type: "boolean", confidence: "med" }, // 3GPP TS 43.020

  /* ---- voice / IMS ---- */
  IMSConfig: { note: "IMS (VoLTE / Wi-Fi Calling) configuration, one dict per registry section (Signaling, Media, XCAP, ...). Keys the bundle omits take the IMS stack's compiled-in defaults.", type: "dict" }, // libIPTelephony.dylib: ImsDefaultPrefs::addDefaultPrefs; libSystemDetermination.dylib: sd::IMSSubscriberConfig
  Voice: { note: "IMS voice (VoLTE / VoNR) settings: emergency redial, CS blocking, QoS revoke.", type: "dict" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig voice getters
  Signaling: { note: "SIP signalling and registration settings (IMS registry section Signaling).", type: "dict" }, // libIPTelephony.dylib: ImsDefaultPrefs::addDefaultPrefs
  Media: { note: "IMS media: codecs, RTP/RTCP timers, SDP options (IMS registry section Media).", type: "dict" }, // libIPTelephony.dylib: ImsDefaultPrefs::addDefaultPrefs
  SMS: { note: "SMS over IMS settings: supported domains, DCN policy, non-VoLTE mode.", type: "dict" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig SMS getters
  XCAP: { note: "XCAP / Ut supplementary-service server settings (IMS registry section XCAP).", type: "dict" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::isXCAPSupported
  RCS: { note: "RCS (Rich Communication Services) settings: switches, auto-configuration data, vendor.", type: "dict" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getRCSWatchdogTimeoutValue
  EnableRCSByDefault: { note: "RCS messaging on by default.", type: "boolean", confidence: "med" },
  supported: { note: "Feature is supported (in the enclosing IMS section).", type: "boolean", confidence: "med" },
  EnableVolteByDefault: { note: "VoLTE on by default for a user who never opens Settings.", type: "boolean", confidence: "med" },
  ShowVolteSwitch: { note: "Show the VoLTE switch in Settings.", type: "boolean", confidence: "med" },
  ShowVolteWarningUnsupportedCarrier: { note: "Warn that the carrier does not support VoLTE.", type: "boolean", confidence: "med" }, // libSystemDetermination.dylib
  SupportsVoNR: { note: "Carrier supports voice over 5G NR. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  ShowVoNRSwitch: { note: "Show the VoNR switch. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  EnableVoNRByDefault: { note: "VoNR on by default. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  ShowWiFiCallingWarningUnsupportedCarrier: { note: "Warn that the carrier does not support Wi-Fi Calling.", type: "boolean", confidence: "med" },
  SupportsImsCapability: { note: "Carrier advertises IMS capability.", type: "boolean", confidence: "med" },
  PcscfAddressRequired: { note: "IMS needs a P-CSCF address before registering.", type: "boolean", confidence: "med" },
  enableInNonVoLTEMode: { note: "Keep this IMS feature on when VoLTE is off.", type: "boolean", confidence: "med" }, // libSystemDetermination.dylib
  imsRegistrationDependency: { note: "Feature depends on IMS registration. No iOS 27 reader found.", type: "boolean", confidence: "low" },
  imsFeatureDependency: { note: "Feature depends on another IMS feature. No iOS 27 reader found.", type: "boolean", confidence: "low" },
  allowCSFBInVolteMode: { note: "Allow CS fallback while VoLTE is on. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  InviteErrorResponsesToTriggerCSFB: { note: "SIP INVITE error codes that trigger fallback to a circuit-switched call.", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build)
  TriggerCSFBOnSDPError: { note: "Fall back to CS when SDP negotiation fails.", type: "boolean", confidence: "med" },
  TriggerCSFBOnWaitForRingingTimeout: { note: "Fall back to CS when ringing never arrives.", type: "boolean", confidence: "med" },
  BlockSilentRedialOverCS: { note: "Do not silently redial a failed IMS call over CS.", type: "boolean", confidence: "med" },
  RingbackTimerSeconds: { note: "Seconds to wait for ringback on an outgoing call.", type: "integer", unit: "s", confidence: "low" }, // CommCenter (macOS 26.6 build)
  RingingTimerSeconds: { note: "Seconds an unanswered call rings before timing out.", type: "integer", unit: "s", confidence: "low" },
  WaitForRingingTimerMOSeconds: { note: "Outgoing call: seconds to wait for 180 Ringing.", type: "integer", unit: "s", confidence: "med" },
  WaitForRingingTimerMTSeconds: { note: "Incoming call: seconds to wait for ringing to start.", type: "integer", unit: "s", confidence: "low" },
  InviteResponseTimeout: { note: "Milliseconds to wait for a response to SIP INVITE.", type: "integer", unit: "ms", confidence: "med" },
  Preconditions: { note: "SIP QoS precondition mode (RFC 3312).", type: "string", confidence: "low" },
  RequirePreconditionsWhenMandatory: { note: "Require SIP preconditions when the remote marks them mandatory.", type: "boolean", confidence: "low" },
  EarlyMediaNeedsHeader: { note: "Play early media only when P-Early-Media is present.", type: "boolean", confidence: "low" },
  SupportPEarlyMediaHeader: { note: "Support the P-Early-Media SIP header (RFC 5009).", type: "boolean", confidence: "med" }, // libSystemDetermination.dylib
  AlwaysSendSessionProgress: { note: "Always send 183 Session Progress on incoming calls.", type: "boolean", confidence: "low" },
  UseIPSec: { note: "Protect IMS signalling with IPsec (TS 33.203).", type: "boolean", confidence: "med" },
  ConferenceCalling: { note: "IMS conference-call settings (IMS registry section ConferenceCalling).", type: "dict" }, // libIPTelephony.dylib: ImsDefaultPrefs::addDefaultPrefs
  conferenceServer: { note: "Conference factory URI.", type: "string", confidence: "med" },
  RegistrationPolicy: { note: "IMS registration flavour: an operator profile (VZW, TMO, ATT, KDDI, ...) or RFC5626 (SIP outbound).", type: "string", confidence: "med" },
  RegistrationRetryIntervals: { note: "Back-off intervals for IMS registration retries.", type: "string", confidence: "med" },
  SipTimers: { note: "SIP timer overrides in ms (A-J, T1, T2, T4; RFC 3261). Legacy SipTimerX names are still accepted.", type: "dict" }, // libIPTelephony.dylib: ImsPrefs::getSipTimers
  MaxUdpMessageSize: { note: "SIP messages larger than this go over TCP (RFC 3261 18.1.1).", type: "integer", unit: "bytes", confidence: "med" },
  AudioCodecs: { note: "Audio codec list and parameters for IMS calls.", type: "dict", confidence: "med" },
  EncodingName: { note: "rtpmap codec name (EVS, AMR, AMR-WB, telephone-event).", type: "string" }, // libIPTelephony.dylib: SDPTemplateBuilder::createSDPTemplate
  SampleRate: { note: "rtpmap clock rate (8000 or 16000).", type: "integer", unit: "Hz" }, // libIPTelephony.dylib: extractRTPMapInfo
  PreferredAMRWBMode: { note: "Highest AMR-WB codec mode.", type: "integer", format: "enum", values: AMR_WB_MODE }, // 3GPP TS 26.201
  PreferredAMRNBMode: { note: "Highest AMR-NB codec mode.", type: "integer", format: "enum", values: AMR_NB_MODE }, // 3GPP TS 26.071
  InactivityTimerRTPSeconds: { note: "Drop the call after this many seconds with no RTP.", type: "integer", unit: "s", confidence: "med" },
  InactivityTimerRTCPSeconds: { note: "Drop the call after this many seconds with no RTCP.", type: "integer", unit: "s", confidence: "med" },
  RTCPIntervalSeconds: { note: "RTCP report interval.", type: "integer", unit: "s", confidence: "med" },
  E911OverITechSupported: { note: "Emergency calls may use IMS over Wi-Fi.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build)
  E911OverCSIfNoIMSReg: { note: "Place emergency calls over CS when IMS is not registered. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  DialAsEmergencyOverIMSForUndetectedEmergency: { note: "Redial as an IMS emergency call when the network flags an undetected emergency number.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::isIMSRedialAllowedForUndetectedEmergency
  tLte911Timer: { note: "Seconds to try an LTE emergency call before falling back to another domain (0 = off).", type: "integer", unit: "s", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SupportsCLIR: { note: "Caller-ID restriction setting is supported. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  SupportsCW: { note: "Call waiting setting is supported. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  SupportsCFErasure: { note: "Call-forwarding erasure is supported.", type: "boolean", confidence: "low" },
  AllowHandoverWithoutIMSVoiceService: { note: "Allow call handover even when the network does not offer IMS voice.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::isCallHandoverWithoutIMSVoiceServiceSupported
  ussdEnabled: { note: "USSD codes can be sent.", type: "boolean", confidence: "med" },
  VerstatFeatureCapability: { note: "STIR/SHAKEN caller verification (verstat) support.", type: "string", confidence: "med" },

  /* ---- Wi-Fi Calling / ePDG (TechSettings) ---- */
  TechSettings: { note: "Wi-Fi Calling (ePDG / IKEv2) configuration.", type: "dict" },
  "5wiServiceMask": serviceMask("Data services allowed over Wi-Fi Calling (same bits as type-mask): 1 = Internet, 3 = Internet + VVM.", "med"), // libIPTelephony.dylib; bundle tally 1/3
  IMSServiceMask: {
    // libCommCenterBase.dylib: sd::asString(option_set<ImsServiceType>); CommCenter (macOS 26.6 build): key string only
    note: "IMS services offered over satellite (IMSConfig.Satellite). 2 = SMS only in every bundle that sets it.",
    type: "integer",
    format: "bitmask",
    bits: IMS_SERVICE_BITS,
    confidence: "med",
  },
  WiFiCallingIdentityProtectionMethod: {
    // libIPTelephony.dylib; 3GPP TS 33.402
    note: "How the IMSI is protected during ePDG authentication.",
    type: "string",
    format: "enum",
    values: { PseudoID: "Pseudonym identity", PseudoIdentity: "Pseudonym identity", EncryptedIdentity: "Encrypted IMSI" },
  },
  EAPMethod: { note: "EAP method for ePDG authentication (EAP-AKA, EAP-TLS).", type: "string" },
  PreferredTechnology: { note: "Wi-Fi Calling preference at home: wifi or cellular. No iOS 27 reader found.", type: "string", format: "enum", values: { wifi: "Wi-Fi preferred", cellular: "Cellular preferred" }, confidence: "med" },
  PreferredTechnologyRoaming: { note: "Wi-Fi Calling preference while roaming. No iOS 27 reader found.", type: "string", format: "enum", values: { wifi: "Wi-Fi preferred", cellular: "Cellular preferred" }, confidence: "med" },
  WifiCallingAllowedInRoaming: { note: "Wi-Fi Calling allowed while roaming.", type: "boolean", confidence: "med" },
  WiFiCallingControlsAlliWLanServices: { note: "The Wi-Fi Calling switch also controls the other iWLAN services.", type: "boolean", confidence: "med" },
  SupportCallHandover: { note: "Calls hand over between Wi-Fi and cellular.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SetHandOverIPv6Prefix: { note: "Keep the IPv6 prefix across Wi-Fi/cellular handover.", type: "boolean", confidence: "med" }, // libCommCenterMCommandDrivers.dylib: QMIDataContextIP::activateDataContextIPAfterProfileConfiguration
  EPDGResolutionFallbackEnabled: { note: "Fall back to another ePDG address resolution method (static IP, other FQDN) on failure.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  EPDGTimeout: { note: "ePDG connection setup timeout.", type: "integer", unit: "s", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  IPSecMTU: { note: "MTU of the IPsec tunnel.", type: "integer", unit: "bytes", default: 1280, confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  FallbackMethod: { note: "Call-handling fallback. 2 = CS fallback to CDMA 1x; absent keeps the 3GPP default. Only CDMA-heritage bundles set it.", type: "integer", format: "enum", values: { 2: "CDMA 1x" }, confidence: "med" }, // bundle tally: 2 in all 24 (Verizon, Sprint, KDDI, US regionals); reader not located in iOS 27
  StaticNATType: { note: "Static NAT / keepalive setting for the ePDG tunnel. Values (8400, 448, 192) look like packed fields.", type: "integer", format: "bitmask", confidence: "low" },
  NATTKeepAliveEnabled: { note: "Send IPsec NAT-T keepalives (RFC 3948).", type: "boolean" }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary
  NATTKeepAliveOffload: { note: "Offload NAT-T keepalives to the Wi-Fi chip.", type: "boolean" }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary
  IKE: { note: "IKEv2 session for the ePDG tunnel (NetworkExtension IKE dictionary format). Missing keys come from Support/default_tech.plist.", type: "dict" }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary
  ChildSAs: { note: "IPsec child SA settings.", type: "dict" },
  Proposals: { note: "IKE SA proposals.", type: "array" },
  ChildProposals: { note: "IPsec child SA proposals.", type: "array" },
  DHGroup: { note: "IKEv2 Diffie-Hellman group for the ePDG tunnel; 14 (2048-bit MODP) in most bundles.", type: "integer", format: "enum", values: IKE_DH_GROUP }, // IANA IKEv2 Transform Type 4; bundle tally 1/2/5/14/15/16/18/21
  EncryptionAlgorithm: { note: "IKE/ESP encryption algorithm.", type: "string" },
  IntegrityAlgorithm: { note: "IKE/ESP integrity algorithm.", type: "string" },
  PRFAlgorithm: { note: "IKE pseudo-random function.", type: "string" },
  Lifetime: { note: "SA lifetime.", type: "integer", unit: "s", default: 86400 }, // NetworkExtension: -[NEConfiguration configureIKE:vpnType:payloadBase:vpn:]; Support/default_tech.plist
  ProtocolVersion: { note: "Protocol version (2 = IKEv2 inside TechSettings).", type: "integer", confidence: "med" },
  DeadPeerDetectionEnabled: { note: "Send IKE dead-peer-detection probes.", type: "boolean", default: false }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary; Support/default_tech.plist
  DeadPeerDetectionInterval: { note: "Seconds between DPD probes.", type: "integer", unit: "s", default: 600 }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary; Support/default_tech.plist
  DeadPeerDetectionMaxRetries: { note: "Unanswered DPD probes before the tunnel is torn down.", type: "integer", default: 4 }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary; Support/default_tech.plist
  DeadPeerDetectionRetryInterval: { note: "Seconds between DPD retries.", type: "integer", unit: "s", default: 10 }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary; Support/default_tech.plist
  ReplayWindowSize: { note: "IPsec anti-replay window.", type: "integer", default: 12 }, // NetworkExtension: NEIPSecDBReceivePFKeyMessage; Support/default_tech.plist
  LocalIdentifier: { note: "IKE local identity (IDi): NAI template with $imsi/$mcc/$mnc placeholders.", type: "string", default: "0$imsi@nai.epc.mnc$mnc.mcc$mcc.3gppnetwork.org" }, // NetworkExtension: -[NEConfiguration initWithAlwaysOnVPNPayload:configurationName:grade:]; Support/default_tech.plist
  RemoteAddress: { note: "ePDG address: FQDN template with $mcc/$mnc placeholders, or an IP.", type: "string", default: "epdg.epc.mnc$mnc.mcc$mcc.pub.3gppnetwork.org" }, // NetworkExtension: -[NEConfiguration initWithAlwaysOnVPNPayload:configurationName:grade:]; Support/default_tech.plist; 3GPP TS 23.003
  ExtraConfigurationAttributeRequestv4: { note: "Extra IKEv2 configuration attributes requested on an IPv4 tunnel (e.g. P-CSCF).", type: "array" },
  ExtraConfigurationAttributeRequestv6: { note: "Extra IKEv2 configuration attributes requested on an IPv6 tunnel (e.g. P-CSCF).", type: "array" },
  TechPolicies: { note: "Per-technology service policies. No iOS 27 reader found.", type: "array", confidence: "med" },
  iRatPolicies: { note: "Inter-RAT (Wi-Fi/cellular) handover policies. No iOS 27 reader found.", type: "dict", confidence: "med" },
  iWLanPolicies: { note: "Wi-Fi (iWLAN) policies, each with a serviceMask.", type: "array", confidence: "med" }, // Support/tech_config.plist
  policy: { note: "Policy expression deciding when the entry's serviceMask may use Wi-Fi ('true', 'cellData=false').", type: "string", default: "true", confidence: "med" }, // Support/default_tech.plist, tech_config.plist

  /* ---- emergency ---- */
  e_only_whitelist: { note: "Numbers that remain dialable when the device has no service other than emergency ('Emergency calls only').", type: "array" },
  EmergencyCalling: { note: "Emergency number list and dialling behaviour for this country/carrier.", type: "dict" }, // CommCenter (macOS 26.6 build); bundle data
  EmergencyNumbers: { note: "Numbers routed as emergency calls, with their service category ({Number, Category, Title}).", type: "array" }, // CommCenter (macOS 26.6 build); bundle data
  PreferredEmergencyNumber: { note: "Number offered by Emergency SOS. No iOS 27 reader found.", type: "boolean", confidence: "low" },
  EmergencyURNs: { note: "SOS URN (RFC 5031) per dialled emergency number. Keyed by number; 'default' covers unlisted numbers.", type: "dict" }, // libIPTelephony.dylib: ImsDefaultPrefs::addDefaultPrefs
  EmergencyCallBackModeExpirationSeconds: { note: "Length of emergency callback mode after an emergency call.", type: "integer", unit: "s", confidence: "med" },
  TestEmergencyNumber: { note: "Number used to test the emergency path without reaching a PSAP.", type: "string" },
  DisallowedDialingPrefixes: { note: "Dial strings the handset refuses to send.", type: "array" },
  VoicemailPilotNumber: { note: "Number dialled when the user long-presses 1.", type: "string" },
  RoamingVoicemailPilotNumber: { note: "Voicemail number used while roaming.", type: "string", confidence: "med" },
  VisualVoicemailServiceName: { note: "Visual voicemail service type. No iOS 27 reader found.", type: "string", confidence: "med" },
  VVMIgnoresIntlDataRoaming: { note: "Visual voicemail downloads even when international data roaming is off.", type: "boolean", confidence: "med" },
  "com.apple.voicemail.imap": { note: "Visual voicemail IMAP server settings. No iOS 27 reader found.", type: "dict", confidence: "med" },

  /* ---- cell broadcast (country bundles) ---- */
  CellBroadcast: { note: "Public-warning (cell broadcast) configuration. Only country bundles carry the full schema; carrier bundles carry at most throttling knobs.", type: "dict" }, // EmergencyAlerts.framework
  MessageIDParameters3GPP: { note: "Maps 3GPP cell-broadcast message identifier ranges (TS 23.041) onto named alert types. An identifier that is not mapped is ignored by the handset.", type: "array" }, // EmergencyAlerts.framework: EAEmergencyAlertCenter
  MessageIDParameters3GPP2: { note: "Maps CDMA broadcast service categories (3GPP2 C.R1001) onto alert types. No iOS 27 reader found.", type: "array" },
  FromServiceID: { note: "First message identifier of the range.", type: "integer", format: "cbs-message-id" }, // 3GPP TS 23.041
  ToServiceID: { note: "Last message identifier of the range.", type: "integer", format: "cbs-message-id" }, // 3GPP TS 23.041
  AlertType: { note: "Name of the AlertTypes entry this range is shown as.", type: "string" },
  AlertConfiguration: { note: "Name of the AlertConfigurations entry (sound + vibration) used for this range.", type: "string" },
  EmergencyAlert: { note: "Treat this range as an emergency (WEA) alert rather than informational.", type: "boolean", default: false, confidence: "med" },
  AlertTypes: { note: "Per-alert-type presentation, keyed by alert-type name (referenced by MessageIDParameters AlertType). UserConfigurable:false means there is no off switch in Settings.", type: "dict" },
  UserConfigurable: { note: "false = the user cannot turn this alert off in Settings.", type: "boolean" },
  EnabledByDefault: { note: "Whether the alert is on for a user who never opens Settings.", type: "boolean" },
  NotificationTitle: { note: "Title shown on the alert.", type: "string" },
  SwitchName: { note: "Label of the alert's switch in Settings > Notifications.", type: "string" },
  SwitchDescription: { note: "Explanatory text under the alert's switch.", type: "string" },
  SoundAlertDeviceInMute: { note: "Plays the alert tone even when the ringer switch is set to silent.", type: "boolean" }, // EmergencyAlerts.framework
  SoundIsMutableInDND: { note: "Whether Focus/Do Not Disturb may silence the alert.", type: "boolean" },
  SoundisMutableInDND: { note: "Misspelled SoundIsMutableInDND found in some bundles. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  SoundAlertPeriod: { note: "How long the alert tone plays.", type: "integer", unit: "ms", confidence: "med" },
  ShowTimestamp: { note: "Show the received time on the alert.", type: "boolean" }, // EmergencyAlerts: -[UNMutableNotificationContent(EmergencyAlerts) ea_setPropertiesForCellBroadcastMessage:withActivePhoneCall:]
  GeofencingConfiguration: { note: "Device-side geofencing (WEA 3.0 style): the handset re-checks the alert area before displaying.", type: "dict" },
  DuplicateDetectionParameters: { note: "How long, and across which SIMs, a repeated broadcast is suppressed. No iOS 27 reader found.", type: "dict" },
  SwitchGroupTitle: { note: "Section header used for these alerts in Settings > Notifications. No iOS 27 reader found.", type: "string" },
  PrimaryBroadcastLanguages: { note: "Languages the handset prefers when a broadcast is sent in several. No iOS 27 reader found.", type: "array" },
  MinimumDeviceCategorySupported: { note: "Minimum device class required to receive these broadcasts (10 in almost every bundle).", type: "integer", confidence: "med" },
  AppleSafetyAlert: { note: "Message-ID ranges that additionally feed Apple's own safety-alert surface.", type: "dict" }, // EmergencyAlerts.framework: handleAppleSafetyAlertMessage
  AlertConfigurations: { note: "Named sound + vibration profiles (keyed by Configuration_<name>) referenced by the message-ID mappings. No iOS 27 reader found.", type: "dict" },
  CustomPreferences: { note: "Extra user-facing switches nested under a parent alert type.", type: "array" },
  EnableAlwaysDeliverByDefault: { note: "Default state of the 'always deliver' switch for this range.", type: "boolean" },
  ShowAlwaysDeliverSwitch: { note: "Show an 'always deliver' switch for this range.", type: "boolean", confidence: "med" },
  MessageValidityPeriod: { note: "How long a received broadcast stays valid (TimeLimit, minutes) for duplicate detection.", type: "dict", confidence: "med" },
  SupportsWEAMaps: { note: "WEA alerts may show a map of the alert area. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  WeaEnrichment: { note: "WEA enrichment (extra payload) settings. No iOS 27 reader found.", type: "dict", confidence: "med" },
  IgnoreInvalidLengthPage: { note: "Accept broadcast pages whose length field is malformed.", type: "boolean", confidence: "med" },
  DataThrottleOnMessageReceive: { note: "Briefly throttle cellular data after a broadcast arrives. No iOS 27 reader found.", type: "boolean", confidence: "med" },
  DataThrottleTimeout: { note: "How long data stays throttled after a broadcast. No iOS 27 reader found.", type: "integer", unit: "s", confidence: "med" },
  PreventScreenCapture: { note: "Block screenshots of the alert.", type: "boolean", confidence: "med" }, // EmergencyAlerts: key string
  AutoReadOutLanguages: { note: "Languages in which the alert is read aloud automatically. No iOS 27 reader found.", type: "array", confidence: "low" },

  /* ---- location ---- */
  Location: { note: "Location policy during emergency calls, including AML.", type: "dict" },
  AML: { note: "Advanced Mobile Location: the handset SMSes its position to an emergency short code.", type: "dict" },
  SUPL: { note: "Secure User-Plane Location: H-SLP address, TLS policy and root certificate.", type: "dict" },
  EmergencyLocation: { note: "Location delivery during emergency calls.", type: "dict", confidence: "med" },
  AlwaysAddGeolocationForEmergencyCalls: { note: "Always attach a Geolocation header (RFC 6442) to emergency INVITEs.", type: "boolean", confidence: "med" },
  UseCIDUrlInPIDF: { note: "Reference location by cid: URL in the PIDF-LO body.", type: "boolean", confidence: "low" },

  /* ---- misc ---- */
  StatusBarImages: { note: "Carrier logos drawn in place of the operator name (older iOS only).", type: "array" },
  CarrierSpace: { note: "Carrier plan/usage API: OAuth endpoints, refresh intervals and the team IDs of carrier apps allowed to use it.", type: "dict" }, // libCommCenterBase.dylib: carrier_space::getCarrierSpaceSettings
  ManagedHours: { note: "Off-peak time windows (TimeWindows, keyed by weekday) and their ExpirationDate. No iOS 27 reader found.", type: "dict" },
  OTASoftwareUpdate: { note: "Whether iOS updates over cellular need carrier opt-in.", type: "dict" },
  SoftwareUpdateOptInRequired: { note: "Carrier opt-in required before an iOS update downloads over cellular.", type: "boolean", confidence: "med" },
  RegistrationOptInRequired: { note: "Opt-in required before the phone number is registered with Apple services.", type: "boolean", confidence: "low" },
  PhoneNumberRegistrationGatewayAddress: { note: "Short code the handset SMSes to register its number with Apple services (iMessage/FaceTime).", type: "string" },
  ShowDialAssist: { note: "Show the Dial Assist setting.", type: "boolean", confidence: "med" },
  MyAccountURL: { note: "Carrier account page linked from Settings > Cellular; also imported as a Safari bookmark.", type: "string" }, // SettingsCellularUI: -[PSUICoreTelephonyCarrierBundleCache carrierServicesAccountUrl:]
  MyAccountURLTitle: { note: "Title of the account link in Settings.", type: "string" }, // SettingsCellularUI: -[PSUICoreTelephonyCarrierBundleCache carrierServicesMyAccountUrlTitle:]
  Services: { note: "USSD/short-code shortcuts surfaced in the carrier menu in Settings.", type: "array" },
  ServiceName: { note: "Label of a carrier service shortcut.", type: "string" }, // SettingsCellularUI: -[PSUICarrierServicesSpecifierCache fetchSpecifiers]
  ServiceCode: { note: "Dial string or USSD code of a carrier service shortcut.", type: "string" }, // SettingsCellularUI: -[PSUICarrierServicesSpecifierCache fetchSpecifiers]
  SMSCarrierReportJunkAddress: { note: "Short code that reported junk SMS are forwarded to.", type: "string", confidence: "med" },
  PRLFileName: { note: "CDMA Preferred Roaming List shipped inside the bundle.", type: "string" },
  PRIFileName: { note: "Plaintext baseband PRI shipped inside the bundle (see the PRI tab).", type: "string" },
  DerPriFileName: { note: "Binary baseband PRI (.der.pri) this override plist pairs with. No iOS 27 reader found.", type: "string" },
  DerPriFileVersion: { note: "Version of the paired .der.pri. No iOS 27 reader found.", type: "string" },
  EFSFiles: { note: "Qualcomm EFS files written to the modem alongside the PRI. No iOS 27 reader found.", type: "array" },
  character_encoding_type: { note: "ERI text encoding. No iOS 27 reader found.", type: "integer", format: "enum", values: CDMA_TEXT_ENCODING, confidence: "med" }, // 3GPP2 C.R1001
  roaming_indicator_table: { note: "CDMA Enhanced Roaming Indicator (ERI) table, keyed by indicator number: {text, icon_mode, alert_id, ...}. No iOS 27 reader found.", type: "dict", confidence: "med" },

  /* ---- bundle Info.plist ---- */
  CFBundleIdentifier: { note: "Bundle identifier (com.apple.<bundle name>).", type: "string" }, // Info.plist standard key
  CFBundleName: { note: "Bundle name, e.g. Claro_pe.", type: "string" }, // Info.plist standard key
  CFBundleShortVersionString: { note: "Bundle version (e.g. 72.0.1), compared when an update is offered.", type: "string" }, // Info.plist standard key
  CFBundleVersion: { note: "Bundle build version.", type: "string" }, // Info.plist standard key

  /* ---- IMS (read by libSystemDetermination; defaults = value returned when absent) ---- */
  VoiceTextMedia: { note: "TTY / RTT support flags.", type: "dict" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getTTYSupported
  SupportsRTT: { note: "Carrier supports RTT calls.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getRTTSupported
  SupportsTTY: { note: "Carrier supports TTY over IMS.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getTTYSupported
  SupportsEmergencyRTT: { note: "RTT allowed on emergency calls.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getEmergencyRTTSupported
  EnableHoldForRTT: { note: "Allow hold on RTT calls.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  RTTSupported: { note: "RTT supported (IMSConfig.Voice spelling).", type: "boolean", confidence: "med" }, // libSystemDetermination.dylib: key string
  BlockCallsOverCS: { note: "Carrier blocks circuit-switched voice (VoLTE-only network).", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::carrierBlocksCallsOverCS
  QoSRevokeEnabled: { note: "End the call when the network revokes the voice QoS bearer.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::isQoSRevokeEnabled
  SuppressDisclosingSuspiciousUndetectedEmergency: { note: "Do not reveal to the user that a dialled number was treated as a suspected undetected emergency.", type: "boolean", default: false, confidence: "med" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::shouldSuppressDisclosingSuspiciousUndetectedEmergency
  T911EMFEnabled: { note: "Enable the T911 emergency-media-fallback path.", type: "boolean", default: false, confidence: "med" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::isT911EMFEnabled
  AlwaysEnableVoNRForEmergency: { note: "Use VoNR for emergency calls even when VoNR is off.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::alwaysEnableVoNRForEmergency
  AllowIMSUnprovisioned: { note: "Allow IMS registration without entitlement provisioning.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::isIMSUnprovisionedAllowed
  AllowWiFiCallingInAirplaneMode: { note: "Wi-Fi Calling stays available in airplane mode.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::isWiFiCallingInApModeAllowed
  ImsStatusUpdateToBasebandBlocked: { note: "Do not report IMS registration status to the modem.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::isImsStatusUpdateToBasebandBlocked
  ReportImsRegistrationStart: { note: "Report the start of IMS registration (not only its result).", type: "boolean", default: false, confidence: "med" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::shouldReportImsRegistrationStart
  AllowCSCallsForInboundDomesticRoaming: { note: "Allow CS calls for inbound domestic roamers.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::operatorAllowsCSCallsForInboundDomesticRoaming
  RequiresCellularFootprintForVoWiFiRegistration: { note: "Register Wi-Fi Calling only after the device has seen the home cellular network.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::carrierRequiresCellularFootprintForVoWiFiRegistration
  UseT3402ForPdpBackoff: { note: "Use the NAS T3402 timer as the IMS PDN back-off.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::shouldUseT3402ForPdpBackoff
  PdpBackOffTimerforRA: { note: "IMS PDN back-off after a router-advertisement failure.", type: "integer", unit: "ms", default: 0 }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getBackOffTimerValueForRA
  T3396PdpBackOffSeconds: { note: "IMS PDN back-off used for T3396 rejects.", type: "integer", unit: "s", default: 0 }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getBackOffTimerValueForT3396
  ActivationBackoffTimerOverIWLANMilliseconds: { note: "IMS PDN activation back-off over Wi-Fi (IWLAN).", type: "integer", unit: "ms", default: 0 }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getBackOffTimerValueForiWlan
  TIMSEstablishmentTimeoutSeconds: { note: "Time allowed for IMS to come up before giving up.", type: "integer", unit: "s", default: 0 }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getImsEstablishmentTimeoutValue
  TPLMNBarringTimeoutSeconds: { note: "How long a PLMN stays barred for IMS.", type: "integer", unit: "s", default: 0 }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getPlmnBarringTimeoutValue
  RegistrationStatusReportingTimeout: { note: "Timeout for reporting IMS registration status.", type: "integer", default: 0, confidence: "med" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getImsRegStatusReportingTimeoutValue
  WifiAccessInfo: { note: "P-Access-Network-Info value sent on Wi-Fi (a MAC-like placeholder).", type: "string", default: "ffffffffffff" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getWifiAccessInfo
  ConnectivityType: { note: "Connection helper for this IMS overlay (Wifi).", type: "string" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getCBConnHelperType
  InitialSetupOverrides: { note: "IMSConfig values used only during initial setup.", type: "dict" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::CopyIMSConfigInitialValue
  VoiceOnAP: { note: "Run voice media on the application processor instead of the modem (EnableAPOnlyMode, EnableANBR, EnableRateAdaptation).", type: "dict" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::isAPOnlyMode
  DCN: { note: "Dedicated-core-network SMS policy: Policy, destinationNumber, hysteresisTimeout.", type: "dict" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getDCNPolicyName
  hysteresisTimeout: { note: "DCN hysteresis timeout.", type: "integer", default: 0, confidence: "med" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getDCNHysteresisTimeoutVal
  supportInNonVoLTEModeWhenRoaming: { note: "SMS over IMS in non-VoLTE mode also while roaming.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::isSmsOverImsInNonVoLTEModeSupportedInRoaming
  SupportedDomains: { note: "Radio technologies (LTE, NR, UMTS, GSM, EHRPD) on which SMS over IMS is used, one boolean each.", type: "dict", confidence: "med" }, // bundle values
  impiFormat: { note: "IMPI template, e.g. imsi@carrierDomain.", type: "string" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getImpiFormatFromBundle
  impuFormat: { note: "IMPU templates, in preference order.", type: "array" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getImpuFormatArrayFromBundle
  CarrierDomain: { note: "IMS home domain override.", type: "string" }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getImsDomainFromBundle
  IgnoreISIM: { note: "Ignore the ISIM application and derive IMS identities from the USIM.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::shouldIgnoreISIM
  USIMFallbackSupport: { note: "Fall back to USIM-derived identities when the ISIM fails.", type: "boolean", default: false }, // libSystemDetermination.dylib: sd::IMSSubscriberConfig::isUSIMFallbackSupported
  VendorID: { note: "RCS vendor.", type: "integer", default: 0, confidence: "med" }, // libSystemDetermination.dylib: sd::IMSSubscriberModel::determineRcsVendor_sync
  CallTransfer: { note: "Call pull / transfer settings (IMS registry section CallTransfer).", type: "dict" }, // libIPTelephony.dylib: ImsDefaultPrefs::addDefaultPrefs
  UseShortThrottlingOnHOIPConflict: { note: "Use a short throttle when a handover hits an IP-address conflict.", type: "boolean" }, // libCommCenterBase.dylib: DataUtils::networkStackFailureThrottleType

  /* ---- IMS (CommCenter-only keys) ---- */
  LocalShortCodeNumbers: { note: "Local short codes that get special routing.", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  EmergencyNumbersOverWifiOnly: { note: "Emergency numbers dialled only over Wi-Fi.", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  EnableBrandedCallingByDefault: { note: "Branded calling (caller logo/name) on by default.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ShowBrandedCallingSwitch: { note: "Show the branded-calling switch.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  BrandedCallingImageFetchingTimeoutMilliseconds: { note: "Timeout for fetching a branded-call logo.", type: "integer", unit: "ms", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  BrandedCallingAssetServersAllowList: { note: "Hosts allowed to serve branded-call logos ({Server} entries).", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  EnableThumperByDefault: { note: "Calls on other devices (Wi-Fi Calling via iCloud) on by default.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  OutgoingCallPrefix: { note: "Prefix rewriting for outgoing IMS calls (Local, International).", type: "dict", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  IgnoresIntlDataRoaming: { note: "IMS keeps working when the Data Roaming switch is off.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  endNonEmergencyCalls: { note: "End other calls when an emergency call is placed.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  CellularE911SearchTimeout: { note: "Seconds to search cellular for an emergency call before trying another domain.", type: "integer", unit: "s", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  TestEmergencyPSAPSupported: { note: "A test PSAP number is supported.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  PreAlertingDTMFSupported: { note: "DTMF may be sent before the call is answered.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  IgnoreCallerIDBlockingForEmergency: { note: "Send caller ID on emergency calls even when CLIR is on.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  E911OverCSIfRoaming: { note: "Place emergency calls over CS while roaming.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  EnableHeldCallHandoff: { note: "Allow handover of held calls.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  PreferSameDomainAsNormalCall: { note: "Place emergency calls in the same domain as normal calls.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  RestrictedDomainMode: { note: "Restrict emergency domain selection.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  MaxSearchRounds: { note: "Network search rounds for an emergency call.", type: "integer", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  CallTransferOnlyIfIMSRegistered: { note: "Offer call transfer only while IMS is registered.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  PullsOnlyWithDialogEvent: { note: "Allow call pull only when a dialog-event notification was received.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ConferenceSupport: { note: "Conference calls supported.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  IgnoreCellularDataSwitch: { note: "XCAP keeps working when cellular data is off.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  IgnoreInternationalDataRoamingSwitch: { note: "XCAP keeps working when international data roaming is off.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  RingbackTone: { note: "Local ringback tone standard (ANSI, CEPT, UK, JAPAN, ...).", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  TTYRelayNumber: { note: "TTY relay service number (711 in the US).", type: "string", confidence: "med" }, // bundle values

  /* ---- IMS call end reasons (entries of CallEndReasons / IncomingCallEndReasons) ---- */
  TerminationEvent: { note: "End event reported for this incoming end reason (ims::DisconnectReason::ReasonCode name).", type: "string", format: "enum", values: TERMINATION_EVENT_VALUES }, // libIPTelephony.dylib: ImsCallTerminationReasonsBase::setReasonsFromPref, ImsCallSessionTerminationBaseEvent::nameForReason
  StatusCode: { note: "SIP response code this incoming end reason matches.", type: "integer" }, // libIPTelephony.dylib: ImsCallTerminationReasonsBase::setReasonsFromPref
  DisableCSFB: { note: "Do not fall back to CS for this end reason.", type: "boolean" }, // libIPTelephony.dylib: ImsCallTerminationReasonsBase::setReasonsFromPref
  DropsRegistration: { note: "This end reason also drops the IMS registration.", type: "boolean" }, // libIPTelephony.dylib: ImsCallTerminationReasonsBase::setReasonsFromPref
  ReasonHeaderProtocol: { note: "Protocol token of the SIP Reason header (SIP, Q.850, RELEASE_CAUSE, USER, ...).", type: "string" }, // libIPTelephony.dylib: ImsCallTerminationReasonsBase::setReasonsFromPref
  ReasonHeaderCause: { note: "Cause value of the SIP Reason header (a SIP code or a Q.850 cause).", type: "integer" }, // libIPTelephony.dylib: ImsCallTerminationReasonsBase::setReasonsFromPref
  ReasonHeaderText: { note: "Text of the SIP Reason header.", type: "string" }, // libIPTelephony.dylib: ImsCallTerminationReasonsBase::setReasonsFromPref
  ExtraHeaders: { note: "Extra SIP headers sent with this end reason.", type: "dict" }, // libIPTelephony.dylib: ImsCallTerminationReasonsBase::setReasonsFromPref

  /* ---- IMS codec fmtp (AudioCodecs.<payload type>) ---- */
  "mode-set": { note: "AMR / AMR-WB fmtp mode-set.", type: "string" }, // libIPTelephony.dylib: addModeset
  "octet-align": { note: "AMR fmtp octet-align (1 = octet-aligned, 0 = bandwidth-efficient).", type: "string" }, // libIPTelephony.dylib: SDPParser
  "max-red": { note: "fmtp max-red: maximum redundancy.", type: "string", unit: "ms" }, // libIPTelephony.dylib: SDPMediaFormatEVSParams::formatParameters
  "ch-aw-recv": { note: "EVS fmtp ch-aw-recv: channel-aware mode offset (-1 off, 0, 2, 3, 5, 7).", type: "string" }, // libIPTelephony.dylib: SDPMediaFormatEVSParams::formatParameters
  "hf-only": { note: "EVS fmtp hf-only (header-full payload only).", type: "string" }, // libIPTelephony.dylib: SDPMediaFormatEVSParams::formatParameters
  maxptime: { note: "fmtp maxptime.", type: "string", unit: "ms", confidence: "med" }, // bundle values; RFC 4566

  /* ---- Wi-Fi Calling / ePDG (TechSettings) ---- */
  TechSettingsSecondaryOverlay: { note: "TechSettings overlay for the secondary (cross-SIM / over-cellular) tunnel. No iOS 27 reader found.", type: "dict", confidence: "med" }, // bundle data
  IMSConfigSecondaryOverlay: { note: "IMSConfig overlay for the secondary (cross-SIM / over-cellular) registration. No iOS 27 reader found.", type: "dict", confidence: "med" }, // bundle data
  AuthenticationMethod: { note: "IKE authentication: None (EAP only), Certificate, ECDSA384, ...", type: "string", default: "None" }, // NetworkExtension: NEIPSecIKEValidateIKEDictionary; Support/default_tech.plist
  ValidateRemoteCertificate: { note: "Validate the ePDG certificate.", type: "boolean", default: false }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary; Support/default_tech.plist
  RemoteCertificateHostname: { note: "Host name expected in the ePDG certificate.", type: "string" }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary
  RemoteCertificateAuthorityName: { note: "CA trusted for the ePDG certificate.", type: "string" }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary
  RemoteIdentifier: { note: "IKE remote identity (IDr).", type: "string", default: "$apn" }, // NetworkExtension: -[NEConfiguration initWithAlwaysOnVPNPayload:configurationName:grade:]; Support/default_tech.plist
  RemoteIdentifierType: { note: "Type of the IKE remote identity (IDFQDN, KeyID).", type: "string", default: "IDFQDN" }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary; Support/default_tech.plist
  LocalIdentifierType: { note: "Type of the IKE local identity.", type: "string", default: "IDUserFQDN" }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary; Support/default_tech.plist
  NATTKeepAliveInterval: { note: "Seconds between NAT-T keepalives.", type: "integer", unit: "s" }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary
  NonceSize: { note: "IKE nonce size.", type: "integer", unit: "bytes", default: 16 }, // NetworkExtension: NEIPSecIKEValidateIKEDictionary; Support/default_tech.plist
  IKEVersion: { note: "IKE version.", type: "integer", default: 2 }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary; Support/default_tech.plist
  DisableSwitchToNATTPort: { note: "Stay on port 500 when NAT is detected instead of moving to 4500.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ConfigurationRequest: { note: "IKE configuration-payload request (AssignedIPv4Address, AssignedIPv4DNS, ...).", type: "dict", confidence: "med" }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary
  AssignedIPv4Address: { note: "Request an inner IPv4 address in the IKE configuration payload.", type: "string" }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary
  AssignedIPv4DNS: { note: "Request an IPv4 DNS server in the IKE configuration payload.", type: "string" }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary
  AssignedIPv4NetMask: { note: "Request the IPv4 netmask in the IKE configuration payload.", type: "string" }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary
  AssignedIPv4DHCP: { note: "Request IPv4 DHCP in the IKE configuration payload.", type: "string" }, // NetworkExtension: NEIPSecIKEValidateSessionDictionary
  FirstChild: { note: "The child SA: proposals, traffic selectors, mode, InstallPolicies.", type: "dict", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only; bundle data
  InstallPolicies: { note: "Install IPsec policies for the child SA.", type: "boolean", default: true }, // Support/default_tech.plist
  ChildProtocol: { note: "Child SA protocol.", type: "string", default: "ESP" }, // NetworkExtension: NEIPSecIKEValidateIKEChildDictionary; Support/default_tech.plist
  TrafficSelectorsLocal: { note: "Child SA local traffic selectors.", type: "array" }, // NetworkExtension: NEIPSecIKESetDispatchQueue
  TrafficSelectorsRemote: { note: "Child SA remote traffic selectors.", type: "array" }, // NetworkExtension: NEIPSecIKESetDispatchQueue
  TSType: { note: "Traffic selector address family.", type: "string", default: "IPv4" }, // NetworkExtension: NEIPSecIKESetDispatchQueue; Support/default_tech.plist
  TSStartAddress: { note: "Traffic selector start address.", type: "string", default: "0.0.0.0" }, // NetworkExtension: NEIPSecIKESetDispatchQueue; Support/default_tech.plist
  TSEndAddress: { note: "Traffic selector end address.", type: "string", default: "255.255.255.255" }, // NetworkExtension: NEIPSecIKESetDispatchQueue; Support/default_tech.plist
  TSStartPort: { note: "Traffic selector start port.", type: "integer", default: 0 }, // NetworkExtension: NEIPSecIKESetDispatchQueue; Support/default_tech.plist
  TSEndPort: { note: "Traffic selector end port.", type: "integer", default: 65535 }, // NetworkExtension: NEIPSecIKESetDispatchQueue; Support/default_tech.plist
  TSProtocol: { note: "Traffic selector IP protocol (0 = any).", type: "integer", default: 0 }, // NetworkExtension: NEIPSecIKESetDispatchQueue; Support/default_tech.plist
  FatalActivationErrors: { note: "ePDG / IKE error codes that stop activation retries.", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ActivationBackoffErrors: { note: "ePDG error code(s) that trigger an activation back-off (e.g. 10500).", type: "integer", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  PdnErrorsToBlockHandover: { note: "PDN error codes that block handover.", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  AllowHandOverFromDataModeList: { note: "Data modes (e.g. LTE) from which a call may hand over to Wi-Fi.", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  AllowRoamingHandover: { note: "Allow Wi-Fi/cellular handover while roaming.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SuppressSAInOverCellHandover: { note: "Suppress 5G SA during an over-cellular handover.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SupportOverCell: { note: "Run the ePDG tunnel over the other SIM's cellular data (cross-SIM calling).", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  EmergencyRemoteIdRequired: { note: "The emergency ePDG needs a remote identity.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SupportIMEIRequest: { note: "Answer the ePDG's DEVICE_IDENTITY (IMEI) request.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SupportIpsecDscpCopy: { note: "Copy DSCP into the IPsec outer header.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  UseVirtualPlmnForLocalBreakout: { note: "Use a virtual PLMN for local breakout.", type: "boolean", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  IWLANImsBackoffTimerOnCellularStart: { note: "IMS back-off on Wi-Fi when cellular comes up.", type: "integer", unit: "s", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only

  /* ---- data / APNs ---- */
  configuration: { note: "Alternate configurations for this APN (per technology or roaming state).", type: "array", confidence: "med" }, // libCommCenterMCommandDrivers.dylib: QMIDataContextIP::stopNetworkIface
  auth_type: { note: "APN authentication type pushed to the modem (CHAP, PAP).", type: "string", confidence: "med" }, // libCommCenterMCommandDrivers.dylib: Mav20QMIAttachApnCommandDriver::performPushSettingsToBB_sync
  AlwaysOnPDU: { note: "5G PDU session is always-on.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  DontSuspend: { note: "Do not suspend this PDN.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SuppressPdnTearDown: { note: "Keep the PDN up where it would normally be torn down.", type: "boolean", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  RecoversOnAirplaneMode: { note: "Toggling airplane mode clears the throttle.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  "fallback-apns": { note: "Fallback APNs tried when the primary APN is rejected ({OrigApn, APNSwitchCauseCodes, ...}).", type: "array", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  OrigApn: { note: "APN this fallback entry replaces.", type: "string", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  APNSwitchCauseCodes: { note: "Reject causes that switch to the fallback APN.", type: "array", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  SupportsSIMAPN: { note: "Use the APN provisioned on the SIM.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SupportsEHRPD: { note: "Carrier supports eHRPD data profiles.", type: "boolean", confidence: "med" }, // libCommCenterMCommandDrivers.dylib: QMIDataContextIPAggregator::configureProfileIfNeeded
  SupportsIMSSignalingIndication: { note: "Flag the IMS PDN profile as carrying IMS signalling.", type: "boolean", confidence: "med" }, // libCommCenterMCommandDrivers.dylib: QMIDataContextIPAggregator::set3GPPParameters
  PreferPrimaryDNS: { note: "Prefer the network's primary DNS server.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ContainerIds: { note: "PCO container IDs to request.", type: "array" }, // libCommCenterMCommandDrivers.dylib: QMIDataContextIPAggregator::set3GPPParameters
  PcoMcc: { note: "MCC of the operator-specific PCO container.", type: "integer" }, // libCommCenterMCommandDrivers.dylib: QMIDataContextIPAggregator::set3GPPParameters
  PcoMnc: { note: "MNC of the operator-specific PCO container.", type: "integer" }, // libCommCenterMCommandDrivers.dylib: QMIDataContextIPAggregator::set3GPPParameters
  IgnoresIntlDataRoamingServiceList: { note: "Services exempt from the international Data Roaming switch.", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  AllowedDataModesForServices: { note: "Per-service radio restrictions: {ServiceName, SupportedDataModes} entries.", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SupportedDataModes: { note: "Data modes (e.g. LTE) the service may use.", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  QualityOfServiceAudio: { note: "Audio QoS flow requested from the modem (ProfileID, FlowPriority).", type: "dict", confidence: "med" }, // libCommCenterMCommandDrivers.dylib: QMIQOSClientIP::requestQos
  ProfileID: { note: "QoS profile ID of the audio flow.", type: "integer", confidence: "med" }, // libCommCenterMCommandDrivers.dylib: QMIQOSClientIP::requestQos
  FlowPriority: { note: "QoS flow priority of the audio flow.", type: "integer", confidence: "med" }, // libCommCenterMCommandDrivers.dylib: QMIQOSClientIP::requestQos
  CoreOSNetworkingStack: { note: "Networking-stack feature switches (ECN).", type: "dict", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ECN: { note: "Explicit Congestion Notification settings.", type: "dict", confidence: "med" }, // Network: key string
  AllowSAOnWiFiAssociation: { note: "Keep 5G SA while associated to Wi-Fi.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  EnableWiFiN1ModeOnlyWhenSAEnabled: { note: "Enable N1 (5GS NAS) mode over Wi-Fi only when 5G SA is on.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SuppressUIIndicatorWhenInternetDown: { note: "Hide the cellular data indicator when the internet is unreachable.", type: "boolean", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  CellularDataPlanSettings: { note: "Data plan properties (DataOnlySubscription).", type: "dict", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  DataOnlySubscription: { note: "The plan is data-only (no voice).", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only

  /* ---- 5G slicing ---- */
  NRSlicing: { note: "5G network slicing (URSP): OsId, AppCategories, low-latency hotspot and managed-app switches.", type: "dict", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  OsId: { note: "URSP OS identifiers (Apple OS UUIDs).", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  AppCategories: { note: "App categories mapped to slices ({ID, TechnologyMask, ...}).", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SupportsLLPHS: { note: "Low-latency Personal Hotspot slice supported.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  IgnoreEntitledLLPHS: { note: "Offer the low-latency hotspot slice without its entitlement.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ManagedSliceApps: { note: "Slices are assigned to managed apps.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  EntitlementsGenres: { note: "Slice eligibility follows app genre.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ForceEnableL4S: { note: "Force L4S (low-latency) marking.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  DefaultInternetSNSSAI: { note: "Default S-NSSAI of the internet slice (SliceServiceType, SliceDifferentiator).", type: "dict", confidence: "med" }, // libCommCenterBase.dylib: kNRSlicingDefaultInternetSNSSAIKey export
  SliceDifferentiator: { note: "5G slice differentiator (SD).", type: "integer", confidence: "med" }, // libCommCenterBase.dylib: kNRSlicingSliceDifferentiatorKey export

  /* ---- entitlements / provisioning ---- */
  Authentication: { note: "Entitlement-server authentication: Type, Username (EAP-AKA identity), IncludeGID.", type: "dict", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  Username: { note: "EAP-AKA identity template ($IMSI, $MCC, $MNC substituted).", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only; bundle values
  IncludeGID: { note: "Include the SIM GID in entitlement authentication.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  UserAgent: { note: "HTTP User-Agent template for entitlement requests ($version, $device, $iOSVersion).", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ExtraEndPoints: { note: "Additional entitlement servers, each with its own push topics and connectivity limits.", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  AllowedConnectivityOnly: { note: "Restrict this endpoint to one connectivity type (Internet).", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  PushSettingsOverlay: { note: "Push topics that override PushSettings for this endpoint.", type: "dict", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  BindingInterface: { note: "Network interface this endpoint binds to (en0).", type: "string", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  TLSTrustedCACertificates: { note: "CA certificates trusted for this endpoint.", type: "array", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  TempFailureBackoffDelay: { note: "Back-off after a temporary entitlement failure.", type: "integer", unit: "s", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  FailureDelay: { note: "Retry delay after an entitlement failure.", type: "integer", unit: "s", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  PseudonymUpdatePeriod: { note: "EAP-AKA pseudonym refresh period.", type: "integer", unit: "hours", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  AllowedIMSIPrefixes: { note: "IMSI prefixes allowed to query the entitlement server.", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ProcessPNRAvailabilityStatus: { note: "Act on the phone-number-registration availability status from the server.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SendAliasIMEIInAuthentication: { note: "Send an alias IMEI in entitlement authentication.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SupportSecureIntent: { note: "Support the secure-intent (transfer consent) flow.", type: "boolean", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  SupportedActions: { note: "Entitlement actions the server supports.", type: "array", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  EnableDeviceAccountIdentifier: { note: "Send a device account identifier.", type: "boolean", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  AllowCurrentLocation: { note: "The entitlement server may receive the current location (emergency address flow).", type: "boolean", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  InvalidateSimForUnknownSubscriber: { note: "Invalidate the SIM when the server reports an unknown subscriber.", type: "boolean", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  SendSelfRegistrationUpdate: { note: "Send self-registration updates to the entitlement server.", type: "boolean", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  OnDeviceActivation: { note: "Carrier setup flow type used for on-device activation.", type: "string", confidence: "med" }, // libCommCenterBase.dylib: asString(CarrierSetupFlowType)
  OneTimeCodeForTransfer: { note: "Line transfer needs an SMS one-time code.", type: "boolean" }, // SIMSetupSupport: -[TSPRXSIMTransferringViewController _maybeEnableOneTimeCodeCheck]
  OneTimeCodeSenders: { note: "Sender IDs of the transfer one-time-code SMS.", type: "array" }, // CoreTelephony: -[CoreTelephonyClient(PlanTransfer) carrierOneTimeCodeSendersWithCompletion:]
  WaitForPhoneNumberDuringActivation: { note: "Wait for the phone number (MSISDN) before finishing eSIM activation.", type: "boolean", confidence: "med" }, // SIMSetupSupport: key string
  UserCanReinitiateActivation: { note: "The user may restart activation.", type: "boolean", confidence: "med" }, // SystemStatusServer: -[STTelephonyStateProvider carrierBundleChange:]
  MandatoryVerify: { note: "SIMs that must be verified (SIMs array).", type: "dict", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  NoDafPopupTemporaryErrors: { note: "Temporary error codes that do not show the activation popup.", type: "string", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only

  /* ---- push (APNs topics) ---- */
  PushSettings: { note: "Apple Push topics the carrier's servers use (entitlements, Wi-Fi Calling, eSIM transfer, visual voicemail, ...), plus keepalive tuning.", type: "dict" }, // PersistentConnection: PCCarrierBundleHelper copyValueFromPushBundleForKey
  PCForcedMinimumHBI: { note: "Forced minimum push keepalive interval.", type: "integer", unit: "s" }, // PersistentConnection: -[PCConnectionManager _loadPreferencesGeneratingEvent:]
  PCAllowMinimumIntervalFallback: { note: "Push keepalive may fall back to the minimum interval.", type: "boolean" }, // PersistentConnection: -[PCConnectionManager _loadPreferencesGeneratingEvent:]
  ForceKeepAliveV1: { note: "Force the v1 push keepalive.", type: "boolean", confidence: "low" }, // ApplePushService: key string
  MultiSIMTopic: { note: "Push topic for multi-SIM / number-sharing updates.", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  VoWiFiTopic: { note: "Push topic for Wi-Fi Calling entitlement updates.", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SAWatchTopic: { note: "Push topic for standalone Watch plan updates.", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  CellularPlanTransferTopic: { note: "Push topic for eSIM transfer.", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  VVMTopic: { note: "Push topic for visual voicemail.", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  PreferredNetworksTopic: { note: "Push topic for preferred-network updates.", type: "string", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  CarrierSpaceTopic: { note: "Push topic for CarrierSpace updates.", type: "string", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only
  "msisdn-event": { note: "Push topic for phone-number changes.", type: "string", confidence: "low" }, // CommCenter (macOS 26.6 build): key string only

  /* ---- CarrierSpace ---- */
  TeamIDList: { note: "Team IDs of carrier apps allowed to use CarrierSpace.", type: "array" }, // libCommCenterBase.dylib: carrier_space::kCBTeamIDListKey export
  SupportsPlans: { note: "CarrierSpace serves plan information.", type: "boolean" }, // libCommCenterBase.dylib: carrier_space::kCBSupportsPlansKey export
  SupportsUsage: { note: "CarrierSpace serves usage information.", type: "boolean" }, // libCommCenterBase.dylib: carrier_space::kCBSupportsUsageKey export
  SupportsApps: { note: "CarrierSpace serves carrier app information.", type: "boolean" }, // libCommCenterBase.dylib: carrier_space::kCBSupportsAppsKey export
  AutoRefreshMinimumIntervalMins: { note: "Minimum interval between automatic CarrierSpace refreshes.", type: "integer", unit: "min" }, // libCommCenterBase.dylib: carrier_space::kCBAutoRefreshMinimumIntervalMinsKey export
  ManualRefreshMinimumIntervalMins: { note: "Minimum interval between manual CarrierSpace refreshes.", type: "integer", unit: "min" }, // libCommCenterBase.dylib: carrier_space::kCBManualRefreshMinimumIntervalMinsKey export
  AuthorizationURL: { note: "CarrierSpace OAuth authorization URL.", type: "string" }, // libCommCenterBase.dylib: carrier_space::kCBAuthorizationUrlKey export
  TokenURL: { note: "CarrierSpace OAuth token URL.", type: "string" }, // libCommCenterBase.dylib: carrier_space::kCBTokenUrlKey export
  AuthClientID: { note: "CarrierSpace OAuth client ID.", type: "string" }, // libCommCenterBase.dylib: carrier_space::kCBAuthClientIdKey export
  AuthorizationRequestRequiresICCID: { note: "The CarrierSpace authorization request includes the ICCID.", type: "boolean" }, // libCommCenterBase.dylib: carrier_space::kCBAuthorizationRequestRequiresICCIDKey export
  DataOptimizationAllowed: { note: "Carrier data optimisation is allowed.", type: "boolean" }, // libCommCenterBase.dylib: carrier_space::kCBDataOptimizationAllowedKey export
  PlanProvisioningPollInterval: { note: "Poll interval while a new plan is being provisioned.", type: "integer" }, // libCommCenterBase.dylib: carrier_space::kCBPlanProvisioningPollIntervalKey export
  PlanProvisioningMaxPollRequests: { note: "Maximum polls while a new plan is being provisioned.", type: "integer" }, // libCommCenterBase.dylib: carrier_space::kCBPlanProvisioningMaxPollRequestsKey export
  AllowedWhenRoaming: { note: "CarrierSpace may be used while roaming.", type: "boolean" }, // libCommCenterBase.dylib: carrier_space::kCBAllowedWhenRoamingKey export
  SupportsUserConsentRefresh: { note: "CarrierSpace supports refreshing user consent.", type: "boolean" }, // libCommCenterBase.dylib: carrier_space::kCBSupportsUserConsentRefreshKey export

  /* ---- messaging ---- */
  SMSSettings: { note: "SMS behaviour: outgoing prefixes, junk reporting, CDMA teleservice and terminal-registration settings.", type: "dict", confidence: "med" }, // libCommCenterMCommandDrivers.dylib: QMISMSCommandDriver::sendAck
  OutgoingSMSPrefix: { note: "Prefix rewriting for outgoing SMS (Local, International). No iOS 27 reader found.", type: "dict", confidence: "med" }, // bundle values; child keys in CommCenter (macOS 26.6 build)
  SendNackOnSMSStorageFull: { note: "NACK incoming SMS when message storage is full.", type: "boolean" }, // libCommCenterMCommandDrivers.dylib: QMISMSCommandDriver::sendAck
  IgnoreWAPPushBits: { note: "CDMA WAP-push bits to ignore when decoding.", type: "integer" }, // libCellularDecoders.dylib: C2KSmsPduDecoder::decodeSubparamUserData
  CustomTeleserviceIDs: { note: "CDMA teleservice ID overrides.", type: "dict" }, // libCellularDecoders.dylib: C2KSmsPduDecoder::checkTeleserviceIDOverride
  TerminalRegistration: { note: "CDMA terminal-registration SMS: TeleserviceID, DestinationAddress, Registration template.", type: "dict" }, // libCellularDecoders.dylib: getTermCarrierSettings
  TeleserviceID: { note: "CDMA teleservice ID of the registration SMS.", type: "integer" }, // libCellularDecoders.dylib: isTermID
  SMSNoRetryCauseCode: { note: "SMS failure cause codes that are not retried.", type: "array" }, // libCommCenterBase.dylib: shouldRetrySMS
  ShowClass0SMSFromField: { note: "Show the sender of a Class 0 (flash) SMS.", type: "boolean" }, // SIMToolkitUI: -[STKCarrierSubscriptionMonitor carrierBundleChange:]
  ShowClass0SMSOverInCallAlerts: { note: "Show Class 0 SMS during a call.", type: "boolean", confidence: "med" }, // SIMToolkitUI: key string
  AllowSTKAlertInLockScreen: { note: "SIM Toolkit alerts may appear on the lock screen.", type: "boolean", confidence: "med" }, // SIMToolkitUI: key string
  SendTextMMSToShortCodeAsSMS: { note: "Send text-only MMS to short codes as SMS.", type: "boolean" }, // CoreTelephony: -[CTMessageCenter sendMMS:]
  ASCIIFileNameRequired: { note: "MMS attachment file names must be ASCII.", type: "boolean" }, // CoreTelephony: +[CTMMSEncoder encodeMessage:]
  MimeEncodingHint: { note: "Text encoding hint for MMS parts (UTF8).", type: "string" }, // CoreTelephony: +[CTMMSEncoder encodeMessage:]
  OnWhileRoaming: { note: "MMS keeps working while data roaming is off.", type: "boolean" }, // SettingsCellularUI: -[PSUICoreTelephonyCarrierBundleCache isMMSOnWhileRoamingForActiveDataPlan:]
  GroupModeAllowUserOverride: { note: "The user may change the group-messaging mode.", type: "boolean", confidence: "med" }, // IMSharedUtilities: key string
  MMSCarrierReportJunkAddress: { note: "Short code that reported junk MMS are forwarded to.", type: "string", confidence: "med" }, // IMDaemonCore: IMDCreateIMMessageItemFromIMDMessageRecordRef
  MaxImageDimension: { note: "Largest image dimension when transcoding for MMS.", type: "integer", unit: "px", confidence: "med" }, // IMFoundation: key string
  MaxVideoBitrate: { note: "Video bitrate cap when transcoding for MMS.", type: "integer", confidence: "med" }, // IMFoundation: key string
  MaxSMILDuration: { note: "Longest SMIL presentation.", type: "integer", unit: "s", confidence: "med" }, // IMFoundation: key string
  MaxSlidesPerMessage: { note: "Most slides in one MMS.", type: "integer", confidence: "med" }, // IMFoundation: key string
  SupportsH264Video: { note: "H.264 video may be sent by MMS.", type: "boolean", confidence: "med" }, // IMFoundation: key string
  ShowMMSEmailAddress: { note: "Show the MMS email address field.", type: "boolean", confidence: "med" }, // IMFoundation: key string
  AllowEmptySubject: { note: "Allow MMS with an empty subject.", type: "boolean", confidence: "med" }, // CoreTelephony: key string
  ShortCodeNumberLength: { note: "Length that marks an MMS recipient as a short code.", type: "integer", confidence: "low" }, // CoreTelephony: key string
  ShowBusinessMessagingSwitch: { note: "Show the Business Messaging (RCS business chat) switch.", type: "boolean", confidence: "med" }, // IMSharedUtilities: key string
  EnableBusinessMessagingByDefault: { note: "Business Messaging on by default.", type: "boolean", confidence: "med" }, // IMSharedUtilities: key string
  ProvisioningData: { note: "RCS auto-configuration data (ServerURL, ...).", type: "dict", confidence: "med" }, // bundle values
  ShowRCSWarningForUncertifiedCarrier: { note: "Warn that the carrier's RCS is not certified.", type: "boolean", confidence: "low" }, // CommunicationsSetupUI: key string

  /* ---- phone / voice services ---- */
  PhoneSettings: { note: "Phone app settings: spam-call reporting, ECT button, business caller ID switch.", type: "dict", confidence: "med" }, // TelephonyUtilities: key string
  CarrierVoiceCallSpamReportAddress: { note: "Short code that reported spam calls are sent to.", type: "string", confidence: "med" }, // TelephonyUtilities: key string
  ShowExplicitCallTransferButton: { note: "Show the explicit call transfer button.", type: "boolean", confidence: "med" }, // CallsDialer: key string
  ShowBCIDSwitch: { note: "Show the business caller ID switch.", type: "boolean", confidence: "med" }, // TelephonyUtilities: key string
  CallWaitingDialingCodes: { note: "MMI codes used to turn call waiting on and off.", type: "dict" }, // libCommCenterBase.dylib: kCWCarrierBundleDictName export
  EnableCallWaiting: { note: "MMI code that turns call waiting on.", type: "string" }, // libCommCenterBase.dylib: kEnableCallWaitingKey export
  DisableCallWaiting: { note: "MMI code that turns call waiting off.", type: "string" }, // libCommCenterBase.dylib: kDisableCallWaitingKey export
  CallWaitingEnabledByDefault: { note: "Call waiting on by default.", type: "boolean" }, // libCommCenterBase.dylib: kCallWaitingDefaultValueKey export
  CallForwardingCustomLabels: { note: "Custom labels for call-forwarding conditions (Unreachable, ...).", type: "dict" }, // TelephonyPreferences: -[TPSCallForwardingController carrierBundleLocalizedStringKeys]
  Unreachable: { note: "Label of the 'forward when unreachable' condition.", type: "string" }, // TelephonyPreferences: -[TPSCallForwardingController localizedConditionalUnreachableTitle]
  QuickSwitch: { note: "Moving a number between devices: SMS forking, supplementary services on the secondary device.", type: "dict" }, // libCommCenterBase.dylib: FeatureConfiguration::isQuickSwitchFlagEnabled
  SMSForkingMechanism: { note: "How incoming SMS fan out across the devices sharing a number.", type: "integer", format: "enum", values: SMS_FORKING_MECHANISM, confidence: "med" }, // libCommCenterBase.dylib: asString(SMSForkingMechanism); key string not in the dyld cache
  AllowSupplementaryServicesOnSecondaryDevice: { note: "Supplementary services (call forwarding, ...) may be changed from the secondary device.", type: "boolean", confidence: "med" }, // TelephonyPreferences: -[TPSCallForwardingListController callForwardingController]
  ShowVoiceRoamingSwitch: { note: "Show the Voice Roaming switch.", type: "boolean" }, // SettingsCellularUI: -[PSUICoreTelephonyCarrierBundleCache shouldShowVoiceRoamingSwitchForDefaultVoicePlan:]
  ShowVoNRWarningUnsupportedCarrier: { note: "Warn that the carrier does not support VoNR.", type: "boolean" }, // SettingsCellularUI: -[PSUICoreTelephonyCarrierBundleCache showVoNRWarningUnsupportedCarrier:]
  ShowServiceCodes: { note: "Show the carrier service codes list in Settings.", type: "boolean" }, // SettingsCellularUI: -[PSUICoreTelephonyCarrierBundleCache showServiceCodes:]
  ShowCallBarring: { note: "Show Call Barring in Phone settings.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ShowIMEIsInLockScreen: { note: "*#06# shows the IMEI without unlocking.", type: "boolean" }, // CallsDialer: +[PHInCallUIUtilities shouldRequestPasscodeUnlockForMMICode:]
  ShouldHideAllVoicemailUI: { note: "Hide all voicemail UI and voicemail sound settings.", type: "boolean" }, // SoundsAndHapticsSettings: -[SHSSoundsPrefController refreshShouldHideAllVoicemailUI]
  OverrideVMPilotNumberWhenOutsideHome: { note: "Use RoamingVoicemailPilotNumber outside the home network.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  VoLTECustomerCareWebsite: { note: "VoLTE help page linked from Settings.", type: "string" }, // SettingsCellularUI: -[PSUICoreTelephonyCarrierBundleCache volteCustomerCareWebsite:]
  VoWiFiCustomerCareWebsite: { note: "Wi-Fi Calling help page shown on errors.", type: "string" }, // TelephonyPreferences: -[TPSCloudCallingURLController genericErrorAlertController]
  CustomerServicePhoneNumber: { note: "Customer-care number.", type: "string", confidence: "med" }, // SystemStatusServer: -[STTelephonyStateProvider carrierBundleChange:]
  WatchCustomerServicePhoneNumber: { note: "Customer-care number shown in Watch cellular setup.", type: "string" }, // CellularBridgeUI: -[NPHCellularBridgeUIManager carrierPhoneNumberForSubscription:]
  TetheringURL: { note: "Carrier page for adding Personal Hotspot to the plan.", type: "string" }, // SettingsCellularUI: -[PSUICellularController setupCellularFaceTime:]
  MyAccountURLInWebViewer: { note: "Account page opened in an in-app web view ($imei/$iccid substituted).", type: "string" }, // SettingsCellularUI: -[PSUICoreTelephonyCarrierBundleCache carrierServicesWebViewAccountUrl:]
  CarrierBookmarks: { note: "Safari bookmarks added for this carrier ({Title, URL} entries).", type: "array" }, // MobileSafariUI: -[BookmarkImporter _appendBookmarksFromSource:toParent:]
  CarrierSpecificCLIRPrefixCodes: { note: "Carrier-specific caller-ID restriction prefix codes (#31# variants).", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  NumbersExcludedFromCallHistory: { note: "Numbers not added to Recents.", type: "dict", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  MaxMultiPartyCalls: { note: "Most participants in a conference call.", type: "integer", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ForceWPSCallsOverCS: { note: "Place Wireless Priority Service (*272) calls over CS.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  DisplayNormalizedPhoneNumber: { note: "Show the phone number in normalised form.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SupportsFlashInfoCallTimer: { note: "CDMA: call timer driven by flash-with-info messages.", type: "boolean", confidence: "med" }, // libCommCenterCommandDrivers.dylib: CallCommandDriver::carrierSupportsCallingTimewithFWIM
  AllowsVoIP: { note: "VoIP apps may run over cellular.", type: "boolean", confidence: "med" }, // CoreTelephony: kCTCarrierBundleAllowsVoIPKey export
  AllowsHighQualityVideoOver3G: { note: "High-quality video over 3G.", type: "boolean", confidence: "low" }, // CoreTelephony: kCTCarrierBundleAllowsHQVideoOver3G export
  GlobalMVNO: { note: "Global / travel MVNO.", type: "boolean", confidence: "med" }, // CoreTelephony: -[CTPlanTravelDetails initWithCoder:]

  /* ---- CDMA / activation ---- */
  NumberToDialForOTAProvisioning: { note: "CDMA OTASP dial string (*228).", type: "string" }, // libCommCenterMCommandDrivers.dylib: EurOTASPService::startOTASP
  OTANumber: { note: "Dial strings treated as over-the-air activation numbers.", type: "string" }, // libCommCenterBase.dylib: isOTANumber
  KeypadProvisioningNumber: { note: "Keypad code that starts CDMA provisioning (##76255).", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ResetSIMProvisoning: { note: "MMI code that resets SIM provisioning (key misspelled in bundles).", type: "string", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  AllowAKEYEditing: { note: "Allow editing the CDMA A-key.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only

  /* ---- emergency ---- */
  EmergencyNumberExceptions: { note: "Numbers never treated as emergency numbers.", type: "array", confidence: "med" }, // libCommCenterBase.dylib: kEmergencyNumberExceptions export
  NonPreferredEmergencyNetworks: { note: "Networks avoided for emergency calls.", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  IgnoreEENLSubServiceFields: { note: "Ignore the sub-service fields of the network's extended emergency number list.", type: "array", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  FallbackToEmergencySetupOnLimitedNoService: { note: "Use emergency call setup when in limited or no service.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  WaitForWiFiRegistration: { note: "Wait for Wi-Fi IMS registration before placing an emergency call.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  PrioritizeNetworkNumbers: { note: "Network-provided emergency numbers take priority.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  CheckVoiceHistoryOnSubForEmergencyCall: { note: "Dual SIM: pick the emergency SIM by recent voice use.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ChooseSubForNormalEmergencyCallIfNotMatched: { note: "Dual SIM: rule for choosing the SIM of a normal-setup emergency call.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ChooseDialingSubWhenBothSubsAreNotPreferred: { note: "Dual SIM: use the dialling SIM when neither SIM is preferred.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ChooseDataSubWhenBothSubsArePreferred: { note: "Dual SIM: use the data SIM when both SIMs are preferred.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SwitchEmergencySubAfterFailures: { note: "Dual SIM: switch SIM after failed emergency attempts.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  EnableSOSVoiceLoopControl: { note: "SOS voice-loop control.", type: "boolean", confidence: "low" }, // libCommCenterCommandDrivers.dylib: CallAudioDriver::supportCSDownlinkDtmf
  HangUpCallsWhenPlacingEmergencyCall: { note: "Hang up active calls when an emergency call is dialled.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ExitEmergencyModeWhenPlacingFirstRegularCall: { note: "Leave emergency callback mode on the first normal call.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  ShowAlertAfterEmergencyCallTimer: { note: "Window after an emergency call during which an alert is shown.", type: "integer", unit: "s", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  PreventWiFiHandoverInEmergency: { note: "Block Wi-Fi handover during an emergency call.", type: "boolean", confidence: "med" }, // CommCenter (macOS 26.6 build): key string only
  SuppressSOSOnlyWithLimitedService: { note: "Do not show 'SOS only' in limited service.", type: "boolean" }, // SystemStatusServer: -[STTelephonyStateProvider _backgroundQueryQueue_shouldSuppressSOSOnlyWithLimitedService]

  /* ---- cell broadcast ---- */
  Sound: { note: "Alert sound file (e.g. cbs_alert_us.caf), Text or Default.", type: "string" }, // EmergencyAlerts: -[UNMutableNotificationContent(EmergencyAlerts) ea_setPropertiesForCellBroadcastMessage:withActivePhoneCall:]
  Vibration: { note: "Vibration pattern plist (e.g. cbs_vibe_us.plist) or Default.", type: "string" }, // EmergencyAlerts: -[UNMutableNotificationContent(EmergencyAlerts) ea_setPropertiesForCellBroadcastMessage:withActivePhoneCall:]
  SystemSound: { note: "System sound used for the alert.", type: "string" }, // EmergencyAlerts: -[UNMutableNotificationContent(EmergencyAlerts) ea_setPropertiesForCellBroadcastMessage:withActivePhoneCall:]
  PlaySoundUntilAcknowledged: { note: "Repeat the sound until the alert is dismissed.", type: "boolean" }, // EmergencyAlerts: -[UNMutableNotificationContent(EmergencyAlerts) ea_setPropertiesForCellBroadcastMessage:withActivePhoneCall:]
  OverrideAccessibilityVibrationSetting: { note: "Vibrate even when vibration is off in Accessibility.", type: "boolean" }, // EmergencyAlerts: -[UNMutableNotificationContent(EmergencyAlerts) ea_setPropertiesForCellBroadcastMessage:withActivePhoneCall:]
  SoundIsMutableInRelayMode: { note: "The alert sound may be muted when relayed to a paired Watch.", type: "boolean" }, // EmergencyAlerts: -[UNMutableNotificationContent(EmergencyAlerts) ea_setPropertiesForCellBroadcastMessage:withActivePhoneCall:]
  TranslationParameters: { note: "Localised alert keywords (Translations) used to translate broadcasts. No iOS 27 reader found.", type: "dict", confidence: "low" }, // bundle values

  /* ---- other system services ---- */
  SatelliteAccessInfo: { note: "Satellite data access: plan Tier and AppCategories. No iOS 27 reader found.", type: "dict", confidence: "low" }, // bundle values
  CaptiveSettingsBySSID: { note: "Carrier Wi-Fi hotspots with captive-portal settings, keyed by SSID.", type: "dict" }, // CaptiveNetworkSupport: CaptiveCopyCarrierSettings
  Bypass: { note: "Skip captive-portal detection on this carrier SSID.", type: "boolean" }, // CaptiveNetworkSupport: CaptiveBypass
  WISPrAccounts: { note: "Carrier Wi-Fi (WISPr) hotspot accounts, keyed by account name.", type: "dict" }, // CaptiveNetworkSupport: CNAccountsGet
  AuthenticationRealm: { note: "Realm of the WISPr account.", type: "string" }, // CaptiveNetworkSupport: CNAccountsATTQueryDo
  SharedSecret: { note: "Shared secret of the WISPr account.", type: "string" }, // CaptiveNetworkSupport: CNAccountsATTQueryDo
  MatchingSSIDs: { note: "SSIDs the WISPr account applies to.", type: "dict" }, // CaptiveNetworkSupport: CNAccountsAddInternal
  PasswordType: { note: "How the WISPr password is obtained (AT&T).", type: "string" }, // CaptiveNetworkSupport: CNAccountsLookupPasswordType
  AllowDownloadOverCellular: { note: "iOS updates may download over cellular.", type: "boolean" }, // SoftwareUpdateServices: -[SUCarrierDownloadPolicyProperties _keys]
  AllowAutomaticDownloadOverCellular: { note: "iOS updates may auto-download over cellular.", type: "boolean" }, // SoftwareUpdateServices: -[SUCarrierDownloadPolicyProperties _keys]
  DaysToWaitForCellularDownload: { note: "Days after release before an update may download over cellular.", type: "integer", unit: "days" }, // SoftwareUpdateServices: -[SUCarrierDownloadPolicyProperties _keys]
  MaxBytesOverCellular: { note: "Largest update download over cellular (-1 = unlimited).", type: "integer", unit: "bytes" }, // SoftwareUpdateServices: -[SUCarrierDownloadPolicyProperties _keys]
  InterCarrierRoamingDisplayNames: { note: "Composite operator names ('home | visited') shown when roaming, keyed by serving PLMN.", type: "dict" }, // libCommCenterBase.dylib: NetworkListOperator::getLocalizedCompositeName
  StockSymboli: { note: "Default Stocks app symbols for this carrier ({symbol, name} entries).", type: "array", confidence: "med" }, // Stocks: key string
  symbol: { note: "Stock ticker symbol.", type: "string", confidence: "med" }, // Stocks: key string
  SMTPServers: { note: "Carrier SMTP relay servers for Mail.", type: "array", confidence: "low" }, // Message: key string
  AuthenticationScheme: { note: "Visual voicemail IMAP authentication scheme (DIGEST-MD5, PLAIN).", type: "string", confidence: "med" }, // IMAP: -[MFAccount preferredAuthScheme]
  EnableBackupOnCellular: { note: "iCloud Backup may run over cellular.", type: "boolean", confidence: "low" }, // MobileBackup: key string
  CarrierAppDiscoverability: { note: "Carrier app discoverability options, keyed by App Store ID. No iOS 27 reader found.", type: "dict", confidence: "low" }, // bundle values
  MappingTable: { note: "OtherKnown lookup: PLMN -> Configuration_<PLMN> section of gsma_1.plist (region_lookup_1.plist), or MCC ranges -> region file (mccRangeLookUp.plist).", type: "dict", confidence: "med" }, // bundle data
  SupportedSIMOverrides: { note: "Per-SIM-variant overrides (e.g. SupportedDevices), keyed by <PLMN>_GID<n>-<value>.", type: "dict", confidence: "med" }, // bundle data
  SupportedDevices: { note: "Device models this override applies to.", type: "array", confidence: "low" }, // SoftwareUpdateServices: +[SUAssetSupport setAssetQueryFilters:]
  TimeWindows: { note: "Off-peak windows keyed by weekday (Sunday-Saturday): {StartTime, EndTime, WindowType} entries. No iOS 27 reader found.", type: "dict", confidence: "low" }, // bundle values
  .../* @__PURE__ */ bodyThreshold(),

  /* ---- keys kept from older builds; not in the iOS 27 corpus ---- */
  SupportedServicesMask: unnamedMask("Supported-services bitmask. Not in the iOS 27 bundles."),
};

/** Keys whose meaning depends on an ancestor key. The nearest matching ancestor wins. */
export const CONTEXT_FIELDS: Readonly<Record<string, ReadonlyArray<{ under: string; doc: FieldDoc }>>> = {
  Type: [
    {
      under: "AttachAPN",
      // libCommCenterBase.dylib: asString(AttachAPNType); key placement not seen in bundles
      doc: { note: "Attach APN context type.", type: "integer", format: "enum", values: ATTACH_APN_TYPE, confidence: "med" },
    },
    {
      under: "NoCellularReconnectCauseCodes",
      doc: { note: "Which network's cause codes this rule matches.", type: "string", format: "enum", values: { "3GPP": "3GPP (GSM/UMTS/LTE/NR)", "3GPP2": "3GPP2 (CDMA)", Non3GPP: "Non-3GPP (Wi-Fi / ePDG)" }, confidence: "med" },
    },
    {
      under: "ExtraConfigurationAttributeRequestv4",
      doc: { note: "Value format of the requested IKEv2 configuration attribute.", type: "string", confidence: "med" },
    },
    {
      under: "ExtraConfigurationAttributeRequestv6",
      doc: { note: "Value format of the requested IKEv2 configuration attribute.", type: "string", confidence: "med" },
    },
    {
      under: "Authentication",
      doc: { note: "Entitlement-server authentication scheme (1 in almost every bundle).", type: "integer", confidence: "low" },
    },
  ],
  Identifier: [
    { under: "ExtraConfigurationAttributeRequestv4", doc: { note: "IKEv2 configuration attribute type to request.", type: "integer", format: "enum", values: IKE_CONFIG_ATTRIBUTE } }, // RFC 7296, RFC 7651
    { under: "ExtraConfigurationAttributeRequestv6", doc: { note: "IKEv2 configuration attribute type to request.", type: "integer", format: "enum", values: IKE_CONFIG_ATTRIBUTE } }, // RFC 7296, RFC 7651
  ],
  Category: [
    { under: "MessageIDParameters3GPP2", doc: { note: "CDMA broadcast service category.", type: "integer", format: "enum", values: CDMA_CMAS_CATEGORY } }, // 3GPP2 C.R1001
    { under: "EmergencyNumbers", doc: { note: "Emergency service category of this number (0 = unspecified).", type: "integer", format: "bitmask", bits: EMERGENCY_CATEGORY_BITS, confidence: "med" } }, // 3GPP TS 24.008 10.5.4.33
  ],
  Name: [
    // NetworkExtension: -[NEConfiguration initWithCoder:]
    { under: "ExtraConfigurationAttributeRequestv4", doc: { note: "IKEv2 configuration attribute to request (AssignedPCSCFIPv4).", type: "string", confidence: "med" } },
    { under: "ExtraConfigurationAttributeRequestv6", doc: { note: "IKEv2 configuration attribute to request (AssignedPCSCFIPv6).", type: "string", confidence: "med" } },
  ],
  Number: [{ under: "EmergencyNumbers", doc: { note: "Emergency dial string.", type: "string", confidence: "med" } }], // bundle values
  Title: [
    { under: "EmergencyNumbers", doc: { note: "Localisation key of the disambiguation label (e.g. EMERGENCY_DISAMBIGUATION_POLICE).", type: "string", confidence: "med" } }, // bundle values
    { under: "CarrierBookmarks", doc: { note: "Bookmark title.", type: "string" } }, // MobileSafariUI: -[BookmarkImporter _appendBookmarksFromSource:toParent:]
  ],
  URL: [
    { under: "CarrierBookmarks", doc: { note: "Bookmark URL.", type: "string" } }, // MobileSafariUI: -[BookmarkImporter _appendBookmarksFromSource:toParent:]
    { under: "HTTPS", doc: { note: "AML HTTPS endpoint.", type: "string", confidence: "med" } }, // bundle values
  ],
  Topic: [{ under: "PushSettings", doc: { note: "Main push topic of the carrier's servers.", type: "string", confidence: "med" } }], // CommCenter (macOS 26.6 build): key string only
  Destination: [{ under: "AML", doc: { note: "Short code the AML location SMS is sent to (e.g. 112, 999).", type: "string", confidence: "med" } }], // bundle values
  HTTPS: [{ under: "AML", doc: { note: "AML delivery over HTTPS.", type: "dict", confidence: "med" } }], // bundle values
  Binary: [{ under: "AML", doc: { note: "AML delivery as binary SMS.", type: "dict", confidence: "low" } }], // bundle values
  Certificate: [{ under: "EncryptedIdentity", doc: { note: "Carrier public key / certificate (base64) used to encrypt the IMSI.", type: "string", confidence: "med" } }], // bundle values
  KeyIdentifier: [{ under: "EncryptedIdentity", doc: { note: "Key identifier sent with the encrypted IMSI (CertificateSerialNumber=...).", type: "string", confidence: "med" } }], // bundle values
  Protocol: [
    { under: "IncomingCallEndReasons", doc: { note: "Reason header protocol (Q.850).", type: "string", confidence: "med" } }, // bundle values
    { under: "CallEndReasons", doc: { note: "Reason header protocol (Q.850).", type: "string", confidence: "med" } }, // bundle values
  ],
  Policy: [{ under: "DCN", doc: { note: "DCN SMS policy name (Legacy).", type: "string" } }], // libSystemDetermination.dylib: sd::IMSSubscriberConfig::getDCNPolicyName
  Version: [{ under: "MMS", doc: { note: "MMS encapsulation version (1.2, 1.3).", type: "string", confidence: "med" } }], // CommCenter (macOS 26.6 build): key string only
  text: [{ under: "roaming_indicator_table", doc: { note: "ERI roaming banner text.", type: "string", confidence: "med" } }], // bundle values; 3GPP2 C.R1001
  alert_id: [{ under: "roaming_indicator_table", doc: { note: "ERI alert tone ID.", type: "integer", confidence: "med" } }], // bundle values; 3GPP2 C.R1001
  Local: [
    { under: "OutgoingSMSPrefix", doc: { note: "Replacement for a local-number prefix.", type: "string", confidence: "med" } }, // CommCenter (macOS 26.6 build): key string only
    { under: "OutgoingCallPrefix", doc: { note: "Replacement for a local-number prefix.", type: "string", confidence: "med" } }, // CommCenter (macOS 26.6 build): key string only
  ],
  International: [
    { under: "OutgoingSMSPrefix", doc: { note: "International prefix that replaces a leading '+'.", type: "string", confidence: "med" } }, // CommCenter (macOS 26.6 build): key string only
    { under: "OutgoingCallPrefix", doc: { note: "International prefix that replaces a leading '+'.", type: "string", confidence: "med" } }, // CommCenter (macOS 26.6 build): key string only
  ],
  Timeout: [{ under: "NoCellularReconnectCauseCodes", doc: { note: "How long the APN stays throttled.", type: "integer", unit: "s", confidence: "med" } }], // CommCenter (macOS 26.6 build): key string only
  Mode: [{ under: "FirstChild", doc: { note: "Child SA mode.", type: "string", default: "Tunnel" } }], // NetworkExtension: NEIPSecDBFilloutBasicSAInfo; Support/default_tech.plist
  TechnologyMask: [{ under: "AppCategories", doc: { note: "Radio technologies the slice rule applies to.", type: "integer", format: "bitmask", bits: RAT_BITS, confidence: "low" } }], // CommCenter (macOS 26.6 build): key string only; values 24/25
  Tier: [{ under: "SatelliteAccessInfo", doc: { note: "Satellite data plan tier.", type: "integer", format: "enum", values: SATELLITE_TIER, confidence: "low" } }], // libCommCenterBase.dylib: asString(SatelliteDataPlanTier); key reader not found
  ServerURL: [
    { under: "RemoteCardProvisioningSettings", doc: { note: "eSIM provisioning (SM-DP+) server.", type: "string", confidence: "med" } }, // bundle values
    { under: "ProvisioningData", doc: { note: "RCS auto-configuration server.", type: "string", confidence: "med" } }, // bundle values
  ],
  default: [{ under: "EmergencyURNs", doc: { note: "URN used for emergency numbers not listed (urn:service:sos).", type: "string", confidence: "med" } }], // bundle values
  Language: [{ under: "MessageIDParameters3GPP2", doc: { note: "CDMA broadcast language code (1 = English).", type: "integer", confidence: "med" } }], // 3GPP2 C.R1001
  FQDN: [{ under: "AllowedIMAPServers", doc: { note: "Allowed visual voicemail IMAP host names.", type: "array", confidence: "low" } }], // bundle values
  IPv4: [{ under: "AllowedIMAPServers", doc: { note: "Allowed visual voicemail IMAP addresses.", type: "array", confidence: "low" } }], // bundle values
  StartTime: [{ under: "TimeWindows", doc: { note: "Window start (HH:MM:SS).", type: "string", confidence: "low" } }], // bundle values
  EndTime: [{ under: "TimeWindows", doc: { note: "Window end (HH:MM:SS).", type: "string", confidence: "low" } }], // bundle values
  WindowType: [{ under: "TimeWindows", doc: { note: "Window type (OffPeak).", type: "string", confidence: "low" } }], // bundle values
  ExpirationDate: [{ under: "ManagedHours", doc: { note: "Date the schedule expires.", type: "string", confidence: "low" } }], // bundle values
  Emergency: [{ under: "IMSConfig", doc: { note: "IMS emergency options: domain choice, T911EMFEnabled, AlwaysEnableVoNRForEmergency.", type: "dict", confidence: "med" } }], // libSystemDetermination.dylib: sd::IMSSubscriberConfig::isT911EMFEnabled
  SIM: [{ under: "IMSConfig", doc: { note: "IMS identities from the SIM: impiFormat, impuFormat, CarrierDomain, IgnoreISIM, USIMFallbackSupport.", type: "dict" } }], // libSystemDetermination.dylib: sd::IMSSubscriberConfig::CopyIMSConfigSIMValue
  Satellite: [{ under: "IMSConfig", doc: { note: "IMS over satellite (IMSServiceMask).", type: "dict" } }], // SettingsCellularUI: -[PSUISatelliteSubgroup setUpSatelliteSpecifierIfRequired]
  Cert: [{ under: "IMSConfig", doc: { note: "IMS behaviour tweaks for certification tests (IMS registry section Cert).", type: "dict", confidence: "med" } }], // libIPTelephony.dylib: ImsDefaultPrefs::addDefaultPrefs
  IPTelephony: [{ under: "IMSConfig", doc: { note: "IMS registry section IPTelephony (static pcscf override).", type: "dict" } }], // libIPTelephony.dylib: ImsDefaultPrefs::addDefaultPrefs; libSystemDetermination.dylib: sd::IMSSubscriberConfig::getpCSCFSettingAddr
  Internal: [{ under: "IMSConfig", doc: { note: "IMS registry section Internal.", type: "dict" } }], // libIPTelephony.dylib: ImsDefaultPrefs::addDefaultPrefs
  Lazuli: [{ under: "IMSConfig", doc: { note: "IMS registry section Lazuli (IMS messaging: message size, conference factory, vendor).", type: "dict", confidence: "med" } }], // libIPTelephony.dylib: ImsDefaultPrefs::addDefaultPrefs
  TimeLimit: [{ under: "MessageValidityPeriod", doc: { note: "Minutes a received alert stays valid for duplicate detection (1440 = 24 h).", type: "integer", unit: "min", confidence: "med" } }], // bundle values
  AirplaneMode: [{ under: "MessageValidityPeriod", doc: { note: "Whether airplane mode resets the validity window.", type: "boolean", confidence: "low" } }], // bundle values
  FeatureEnabled: [{ under: "GeofencingConfiguration", doc: { note: "Device-side geofencing on.", type: "boolean", confidence: "med" } }], // bundle values
  Registration: [{ under: "TerminalRegistration", doc: { note: "Registration SMS body template ($MODEL, $MEID substituted).", type: "string", confidence: "med" } }], // CoreTelephony: CTLogRegistration
  DestinationAddress: [{ under: "TerminalRegistration", doc: { note: "Number the registration SMS is sent to.", type: "string", confidence: "med" } }], // bundle values
  Server: [{ under: "BrandedCallingAssetServersAllowList", doc: { note: "Host allowed to serve branded-call logos.", type: "string", confidence: "med" } }], // bundle values
  InactivityTimeout: [{ under: "3GPP2", doc: { note: "CDMA attach APN inactivity timeout.", type: "integer", confidence: "low" } }], // bundle values
  "3GPP": [{ under: "AttachAPN", doc: { note: "Initial-attach (default bearer) APN for 3GPP radios.", type: "dict" } }], // libCommCenterBase.dylib: getDefaultAttachApn, k3GPP export
  "3GPP2": [{ under: "AttachAPN", doc: { note: "Attach APN for CDMA / eHRPD.", type: "dict", confidence: "med" } }], // libCommCenterBase.dylib: k3GPP2 export
  WiFiCalling3GPP: [{ under: "AttachAPN", doc: { note: "Attach APN used for Wi-Fi Calling.", type: "dict", confidence: "med" } }], // libCommCenterBase.dylib: kWiFiCallingProfile export
  Proxy: [{ under: "MMS", doc: { note: "WAP/HTTP proxy (host[:port]) for the MMSC.", type: "string", confidence: "med" } }], // libCommCenterBase.dylib: key string
  signature: [{ under: "OTAActivationAPN", doc: { note: "Signature over the OTA activation APN.", type: "data", confidence: "med" } }], // CarrierBundleUtilities: ComputeHashForCarrierBundle
  SIMs: [{ under: "MandatoryVerify", doc: { note: "SIM identifiers that need mandatory verification.", type: "array", confidence: "low" } }], // CommCenter (macOS 26.6 build): key string only
  LTE: [{ under: "SupportedDomains", doc: { note: "SMS over IMS on LTE.", type: "boolean", confidence: "med" } }], // bundle values
  NR: [{ under: "SupportedDomains", doc: { note: "SMS over IMS on 5G NR.", type: "boolean", confidence: "med" } }], // bundle values
  UMTS: [{ under: "SupportedDomains", doc: { note: "SMS over IMS on UMTS.", type: "boolean", confidence: "med" } }], // bundle values
  GSM: [{ under: "SupportedDomains", doc: { note: "SMS over IMS on GSM.", type: "boolean", confidence: "med" } }], // bundle values
  EHRPD: [{ under: "SupportedDomains", doc: { note: "SMS over IMS on eHRPD.", type: "boolean", confidence: "med" } }], // bundle values
  supported: [{ under: "XCAP", doc: { note: "XCAP / Ut supplementary services enabled.", type: "boolean", default: false } }], // libSystemDetermination.dylib: sd::IMSSubscriberConfig::isXCAPSupported
};

/* ------------------------------------------------------------------------ */
/* Lookups                                                                  */
/* ------------------------------------------------------------------------ */

/** Overlay dicts that share their base dict's schema. */
const OVERLAY_OF: Readonly<Record<string, string>> = {
  IMSConfigSecondaryOverlay: "IMSConfig",
  InitialSetupOverrides: "IMSConfig",
  TechSettingsSecondaryOverlay: "TechSettings",
};

/** Split "AttachAPN.3GPP", "apns[0]/configuration" or an array into key names, dropping
 *  indices and mapping overlay dicts onto the dict they overlay. */
function pathSegments(path: string | readonly string[]): string[] {
  const parts = typeof path === "string" ? path.split(/[/.]|\[\d*\]/) : path.map((p) => p.replace(/\[\d*\]$/, ""));
  return parts.filter((p) => p !== "" && !/^\d+$/.test(p)).map((p) => OVERLAY_OF[p] ?? p);
}

const IMS_TYPE: Readonly<Record<ImsSetting["type"], FieldType>> = { b: "boolean", i: "integer", s: "string", x: "string", e: "string", d: "dict", a: "array" };

/** FieldDoc for an IMS registry entry; `base` supplies a hand-written note when the registry has none. */
function imsDoc(s: ImsSetting, base?: FieldDoc): FieldDoc {
  const doc: FieldDoc = {
    note: (s.renamedFrom ? `Legacy name of ${s.key}. ` : "") + (s.note ?? base?.note ?? `IMS ${s.section} setting.`),
    type: IMS_TYPE[s.type],
  };
  if (s.default !== undefined && s.default !== "") doc.default = s.default;
  if (s.values) {
    doc.format = "enum";
    doc.values = Object.fromEntries(s.values.map((v) => [v, (v === "" ? "empty (off)" : v) + (v === s.default ? " (default)" : "")]));
  }
  const unit = /Milliseconds$/.test(s.key) || s.section.endsWith("SipTimers") ? "ms" : /Seconds$/.test(s.key) ? "s" : base?.unit;
  if (unit) doc.unit = unit;
  return doc;
}

/** An entry of IMSConfig.Signaling.CallEndReasons / IncomingCallEndReasons, with its built-in default. */
function endReasonDoc(name: string, incoming: boolean): FieldDoc {
  const d = defaultEndReason(name, incoming);
  if (!d) return { note: `Carrier-defined ${incoming ? "incoming " : ""}end reason.`, type: "dict", confidence: "med" };
  const [, status, code, text] = d;
  const what = incoming ? `matches SIP ${status}` : status ? `sends SIP ${status}` : "sends no SIP response";
  return {
    note: `Overrides a built-in end reason (default: ${what}, event ${TERMINATION_EVENTS[code] ?? code}${text ? `, Reason "${text}"` : ""}).`,
    type: "dict",
  };
}

const IMS_ROOT = "IMSConfig";

/** Documentation for `key`, using the ancestor path for keys whose meaning depends on it.
 *  `parentPath` may include the key itself (as the viewer's key paths do). Keys under
 *  IMSConfig also resolve against the IMS preference registry (see ims.ts). */
export function describeField(key: string, parentPath?: string | readonly string[]): FieldDoc | undefined {
  if (parentPath !== undefined) {
    const segs = pathSegments(parentPath);
    if (segs[segs.length - 1] === key) segs.pop();
    const ctx = CONTEXT_FIELDS[key];
    if (ctx) {
      for (let i = segs.length - 1; i >= 0; i--) {
        const hit = ctx.find((c) => c.under === segs[i]);
        if (hit) return hit.doc;
      }
    }
    const parent = segs[segs.length - 1];
    if (segs.includes(IMS_ROOT)) {
      if (parent === "CallEndReasons" || parent === "IncomingCallEndReasons") return endReasonDoc(key, parent === "IncomingCallEndReasons");
      // The stack reads each key from its own section only (IMSConfig.<Section>[.<Sub>]).
      const s = describeImsSetting(key, parent);
      if (s && (s.section === parent || s.section.endsWith(`/${parent}`))) return imsDoc(s, FIELDS[key]);
    }
    return FIELDS[key];
  }
  const doc = FIELDS[key];
  if (doc) return doc;
  const s = describeImsSetting(key);
  return s && !s.section.endsWith("/SipTimers") ? imsDoc(s) : undefined;
}

/** One label of a decoded value. */
export interface ValueLabel {
  /** The name, or "bit N" for a set bit the table does not name. */
  label: string;
  named: boolean;
  /** Bit index, for bitmasks. */
  bit?: number;
}

/** Labels for a value: one per set bit for bitmasks, the enum label for enums, the
 *  alert label for CBS message IDs. `[]` for an enum value with no known label;
 *  undefined when the key has no decodable format. */
export function describeValue(key: string, value: unknown, parentPath?: string | readonly string[]): ValueLabel[] | undefined {
  const doc = describeField(key, parentPath);
  if (!doc) return undefined;
  if (doc.format === "bitmask" || (doc.bits && !doc.format)) {
    if (typeof value !== "number" && typeof value !== "bigint") return undefined;
    return maskBits(value).map((bit) => {
      const name = doc.bits?.[bit];
      return { label: name ?? `bit ${bit}`, named: name !== undefined, bit };
    });
  }
  if (doc.format === "cbs-message-id") {
    if (typeof value !== "number") return undefined;
    const label = describeMessageId(value);
    return label ? [{ label, named: true }] : [];
  }
  if (doc.values) {
    if (typeof value !== "number" && typeof value !== "string" && typeof value !== "bigint") return undefined;
    const label = doc.values[String(value)];
    return label ? [{ label, named: true }] : [];
  }
  return undefined;
}
