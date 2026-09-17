/**
 * Curated notes about carrier.plist / country-bundle keys, plus the list of
 * integer fields that are really bitmasks. Shipped to the browser so the viewer
 * can explain a field without a round trip.
 */

/** Integer fields that encode a bitmask. Bit meanings are mostly undocumented;
 *  we still decode the set-bit list, because "32768" on its own tells you nothing. */
export const BITMASK_KEYS = new Set<string>([
  "SupportedEntitlements",
  "SupportedAuthorizationTokens",
  "type-mask",
  "typemask",
  "tech-type-mask",
  "technology-mask",
  "AllowedServicesTypeMaskOnInternet",
  "IgnoresDeactivateOnNetworkScanServiceMask",
  "APNEditabilityTypemask",
  "APNEditabilityTypemaskNew",
  "IPCUApnTypemask",
  "IPv6SupportedDataModeMask",
  "AllowedProtocolMask",
  "AllowedProtocolMaskInRoamingLTE",
  "AllowedProtocolMaskInRoamingNR",
  "FallbackMethod",
  "TRM RF Mask",
  "enabled-by-default-mask",
  "StaticNATType",
  "SupportedServicesMask",
  "ServiceMask",
  "EntitlementServiceMask",
]);

/** Fields whose value is a raw MCC+MNC (or a list of them). */
export const PLMN_KEYS = new Set<string>([
  "SupportedPLMNs",
  "SupportedSIMs",
  "IntlDataRoamingAllowed",
  "IntlDataRoamingExceptions",
  "BlacklistedSIMs",
  "AllPLMNs",
]);

export const KEY_NOTES: Record<string, string> = {
  /* ---- identity ---- */
  CarrierName: "Operator name shown in the status bar and in Settings.",
  HomeBundleIdentifier: "The country bundle this carrier bundle expects to sit on top of.",
  SupportedSIMs:
    "MCC+MNC values (optionally with _GID1-/_GID2-/_ID- qualifiers) this bundle claims. The handset picks a bundle by matching the SIM against this list.",
  SupportedPLMNs: "Networks treated as the home network for this bundle.",
  SupportedCarrierIds: "US CDMA-style carrier IDs (e.g. 310VZW) this bundle claims.",
  SupportedCountryIds: "Country IDs (MCC or com.apple.<Country>) this bundle applies to.",
  ISOAlpha2CountryCode: "ISO-3166 alpha-2 codes covered by this country bundle.",
  MVNOOverrides: "Per-MVNO deltas applied on top of the host operator's settings.",

  /* ---- entitlements / provisioning ---- */
  CarrierEntitlements:
    "Server that gates carrier features (Wi-Fi Calling, tethering, Watch plans). SupportedEntitlements is a bitmask of which entitlement classes are queried.",
  SupportedEntitlements:
    "Bitmask of entitlement classes the device may request from the entitlement server. Individual bit meanings are not published.",
  RemoteCardProvisioningSettings:
    "eSIM download settings: SM-DP+ hostnames, ICCID prefixes that match this carrier, and whether an Apple ID check is required.",
  MatchingICCIDPrefixes: "ICCID prefixes that route an eSIM download to this carrier.",
  RequireLiveIDCheck: "Requires a signed-in Apple Account before the eSIM can be downloaded.",
  PhoneAccountTransfer:
    "Rules for moving a line between devices — SM-DP+ URL, one-time-code sender short codes, minimum OS.",
  OTAActivation: "Over-the-air activation behaviour, including SIMs excluded from it.",
  CellularPlanProvisioningSettings: "Behaviour of the in-Settings 'Add Cellular Plan' flow.",
  EncryptedIdentity: "Certificate used to encrypt subscriber identity during activation.",

  /* ---- data ---- */
  apns:
    "Access Point Names. Each entry carries a type-mask (which services may use it) and a tech-type-mask (which radio technologies).",
  AttachAPN: "The APN attached at LTE/NR registration, before any user-selected APN.",
  "type-mask": "Bitmask of service classes allowed on this APN (internet, MMS, tethering, IMS, …).",
  "tech-type-mask": "Bitmask of radio technologies this APN entry applies to.",
  MTU: "Per-technology MTU override, keyed by a technology bitmask.",
  MMS: "MMSC URL, WAP proxy, size limits and junk-report routing.",
  DataIndicatorOverrideForLTE:
    "Forces the status-bar label on LTE — this is how a carrier displays '5GE' or '4G' where the radio is LTE.",
  DataIndicatorOverrideForNRMmwave: "Status-bar label override on mmWave 5G.",
  PcoOptions: "Protocol Configuration Options container IDs read from the network during attach.",

  /* ---- voice / IMS ---- */
  IMSConfig:
    "IMS (VoLTE / Wi-Fi Calling) stack configuration: SIP signalling, media/SRTP, registration and headers.",
  TechSettings: "Low-level radio/EPDG behaviour, including IKE and Wi-Fi Calling policy.",
  e_only_whitelist:
    "Numbers that remain dialable when the device has no service other than emergency ('Emergency calls only').",
  EmergencyCalling: "Emergency number list and dialling behaviour for this country/carrier.",
  EmergencyNumbers: "Numbers routed as emergency calls, with their service category.",
  TestEmergencyNumber: "Number used to test the emergency path without reaching a PSAP.",
  DisallowedDialingPrefixes: "Dial strings the handset refuses to send.",
  VoicemailPilotNumber: "Number dialled when the user long-presses 1.",

  /* ---- cell broadcast ---- */
  CellBroadcast:
    "Public-warning (cell broadcast) configuration. Only country bundles carry the full schema; carrier bundles carry at most throttling knobs.",
  MessageIDParameters3GPP:
    "Maps 3GPP cell-broadcast message identifier ranges (TS 23.041) onto named alert types. An identifier that is not mapped is ignored by the handset.",
  AlertTypes:
    "Per-alert-type presentation. UserConfigurable:false means there is no off switch in Settings.",
  UserConfigurable: "false = the user cannot turn this alert off in Settings.",
  EnabledByDefault: "Whether the alert is on for a user who never opens Settings.",
  SoundAlertDeviceInMute: "Plays the alert tone even when the ringer switch is set to silent.",
  SoundIsMutableInDND: "Whether Focus/Do Not Disturb may silence the alert.",
  GeofencingConfiguration:
    "Device-side geofencing (WEA 3.0 style): the handset re-checks the alert area before displaying.",
  DuplicateDetectionParameters:
    "How long, and across which SIMs, a repeated broadcast is suppressed.",
  SwitchGroupTitle: "Section header used for these alerts in Settings > Notifications.",
  PrimaryBroadcastLanguages: "Languages the handset prefers when a broadcast is sent in several.",
  MinimumDeviceCategorySupported: "Minimum device class required to receive these broadcasts.",
  AppleSafetyAlert: "Message-ID ranges that additionally feed Apple's own safety-alert surface.",
  AlertConfigurations: "Named sound + vibration pairs referenced by the message-ID mappings.",
  CustomPreferences: "Extra user-facing switches nested under a parent alert type.",
  EnableAlwaysDeliverByDefault: "Default state of the 'always deliver' switch for this range.",
  MessageValidityPeriod: "How long a received broadcast stays valid, in minutes.",

  /* ---- location ---- */
  Location: "Location policy during emergency calls, including AML.",
  AML: "Advanced Mobile Location — the handset SMSes its position to an emergency short code.",
  SUPL: "Secure User-Plane Location: H-SLP address, TLS policy and root certificate.",

  /* ---- misc ---- */
  StatusBarImages: "Carrier logos drawn in place of the operator name (older iOS only).",
  CarrierSpace: "Team IDs allowed to ship a carrier app with privileged entitlements.",
  ManagedHours: "Time windows in which carrier-managed behaviour applies.",
  OTASoftwareUpdate: "Whether iOS updates over cellular need carrier opt-in.",
  PhoneNumberRegistrationGatewayAddress:
    "Short code the handset SMSes to register its number with Apple services (iMessage/FaceTime).",
  Services: "USSD/short-code shortcuts surfaced in the carrier menu in Settings.",
  NetworkEncryptionCiphers: "Ciphers the modem is permitted to negotiate.",
  PRLFileName: "CDMA Preferred Roaming List shipped inside the bundle.",
  PRIFileName: "Plaintext baseband PRI shipped inside the bundle (see the PRI tab).",
  DerPriFileName: "Binary baseband PRI (.der.pri) this override plist pairs with.",
  EFSFiles: "Qualcomm EFS files written to the modem alongside the PRI.",
};

/** Cross-reference for 3GPP TS 23.041 cell-broadcast message identifiers. */
export const CBS_MESSAGE_IDS: Array<{ from: number; to: number; label: string }> = [
  { from: 4370, to: 4370, label: "Presidential-level alert (CMAS class 1)" },
  { from: 4371, to: 4372, label: "Extreme threat, observed/likely" },
  { from: 4373, to: 4378, label: "Severe threat" },
  { from: 4379, to: 4379, label: "Child abduction (AMBER)" },
  { from: 4380, to: 4380, label: "Required monthly test" },
  { from: 4381, to: 4381, label: "CMAS exercise" },
  { from: 4382, to: 4382, label: "Operator-defined use" },
  { from: 4383, to: 4383, label: "Presidential-level alert (additional language)" },
  { from: 4384, to: 4391, label: "Extreme/severe threat (additional language)" },
  { from: 4392, to: 4392, label: "Child abduction (additional language)" },
  { from: 4393, to: 4393, label: "Required monthly test (additional language)" },
  { from: 4394, to: 4394, label: "CMAS exercise (additional language)" },
  { from: 4395, to: 4395, label: "Operator-defined use (additional language)" },
  { from: 4396, to: 4397, label: "Public safety message" },
  { from: 4398, to: 4399, label: "State/local test" },
  { from: 4400, to: 4400, label: "Geofence trigger message (not user-visible)" },
];

export function describeMessageId(id: number): string | undefined {
  for (const r of CBS_MESSAGE_IDS) if (id >= r.from && id <= r.to) return r.label;
  return undefined;
}

export function decodeBits(n: number): number[] {
  const bits: number[] = [];
  if (!Number.isFinite(n) || n < 0) return bits;
  let v = Math.trunc(n);
  for (let i = 0; v > 0 && i < 53; i++) {
    if (v % 2 === 1) bits.push(i);
    v = Math.floor(v / 2);
  }
  return bits;
}
