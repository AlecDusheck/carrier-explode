/** carrier.plist split into the groups a reader looks for, and a phone's override merged in. */

import { isJsonDict, mergeSettings } from "@carrier-explode/decode-ios";

const SETTING_GROUPS: Array<[string, string[]]> = [
	[
		"Identity",
		[
			"CarrierName",
			"HomeBundleIdentifier",
			"CountryName",
			"ISOAlpha2CountryCode",
			"SupportedSIMs",
			"SupportedPLMNs",
			"SupportedCarrierIds",
			"SupportedCountryIds",
			"MVNOOverrides",
		],
	],
	// The keys behind the Cellular switches in Settings, and what they default to; from the keys bundles actually set.
	[
		"Cellular: 5G, LTE, calling and roaming",
		[
			"Show5GSwitch",
			"Enable5GAutoByDefault",
			"Enable5GAutoAfterUpgrade",
			"Show5GWarningUnsupportedCarrier",
			"Supports5GStandalone",
			"Show5GStandaloneSwitch",
			"Show5GStandaloneSwitchOnlyWhenEntitled",
			"Enable5GStandaloneByDefault",
			"Enable5GStandaloneAfterUpgrade",
			"SupportsVoNR",
			"ShowVoNRSwitch",
			"EnableVoNRByDefault",
			"ShowVoNRWarningUnsupportedCarrier",
			"ShowHighDataModeSwitch",
			"SupportsNRNSAInboundRoaming",
			"NRSlicing",
			"DataIndicatorOverrideForNRMmwave",
			"EnableMmWaveSisOutrank",
			"IgnoreDSDForUI5G",
			"ShowVolteSwitch",
			"ShowVolteWarningUnsupportedCarrier",
			"SupportsVolteCapability",
			"MultiSimVoLteOnly",
			"Show4GSwitch",
			"Show4GSwitchWith5G",
			"Enable4GByDefault",
			"EnableLTEAfterUpgrade",
			"ShowLTEWarningUnsupportedCarrier",
			"DataIndicatorOverrideForLTE",
			"UseLTEAlternateBarMapping",
			"Show3GSwitch",
			"Show3GSwitchWith4G",
			"Show3GSwitchWith5G",
			"Show3GSwitchWithVolte",
			"AllowsHighQualityVideoOver3G",
			"ShowWiFiCallingWarningUnsupportedCarrier",
			"ShowWiFiCallingRoamingSwitch",
			"ShowVoiceRoamingSwitch",
			"IntlDataRoamingSwitch",
			"IntlDataRoamingAllowed",
			"IntlDataRoamingExceptions",
			"IgnoresIntlDataRoamingServiceList",
			"AllowCSCallsForInboundDomesticRoaming",
			"CDMAInternationalRoaming",
			"SupportsRoamingOnCDMA",
		],
	],
	[
		"Data",
		["apns", "AttachAPN", "MTU", "MMS", "PcoOptions", "APNEditabilityTypemask", "APNEditabilityTypemaskNew"],
	],
	[
		"Entitlements and eSIM",
		[
			"CarrierEntitlements",
			"RemoteCardProvisioningSettings",
			"PhoneAccountTransfer",
			"CellularPlanProvisioningSettings",
			"OTAActivation",
			"EncryptedIdentity",
			"QuickSwitch",
		],
	],
	[
		"Voice and IMS",
		[
			"IMSConfig",
			"TechSettings",
			"RCS",
			"VoicemailPilotNumber",
			"PhoneNumberRegistrationGatewayAddress",
			"SMSSettings",
			"PushSettings",
			"VisualVoicemailServiceName",
		],
	],
	[
		"Emergency and alerts",
		[
			"CellBroadcast",
			"EmergencyCalling",
			"EmergencyNumbers",
			"e_only_whitelist",
			"TestEmergencyNumber",
			"Location",
			"SUPL",
			"DisallowedDialingPrefixes",
		],
	],
	[
		"Presentation and policy",
		[
			"StatusBarImages",
			"Services",
			"CarrierBookmarks",
			"MyAccountURL",
			"CarrierSpace",
			"ManagedHours",
			"OTASoftwareUpdate",
			"NetworkEncryptionCiphers",
			"AllowedServicesTypeMaskOnInternet",
			"IgnoresDeactivateOnNetworkScanServiceMask",
		],
	],
];
const GROUPED = new Set(SETTING_GROUPS.flatMap(([, keys]) => keys));

/** A dict's top-level keys in reading groups; whatever no group names goes last. */
export function groupSettings(d: Record<string, unknown>): Array<[string, Record<string, unknown>]> {
	const out: Array<[string, Record<string, unknown>]> = [];
	for (const [title, keys] of SETTING_GROUPS) {
		const picked = Object.fromEntries(keys.filter((k) => k in d).map((k) => [k, d[k]]));
		if (Object.keys(picked).length) out.push([title, picked]);
	}
	const rest = Object.fromEntries(Object.entries(d).filter(([k]) => !GROUPED.has(k)));
	if (Object.keys(rest).length) out.push(["Other", rest]);
	return out;
}

export const asDict = (v: unknown): Record<string, unknown> | undefined => (isJsonDict(v) ? v : undefined);

/** carrier.plist with a phone's override plist merged in; dictionaries merge key by key, as a per-phone IMSConfig sets only a few keys. */
export function effective(
	carrier: Record<string, unknown>,
	phone?: Record<string, unknown>,
): { readonly merged: Record<string, unknown>; readonly fromPhone: ReadonlySet<string> } {
	return {
		merged: phone ? mergeSettings(carrier, phone) : carrier,
		fromPhone: new Set(Object.keys(phone ?? {})),
	};
}
