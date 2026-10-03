/**
 * The settings view shared by a bundle's Overview and Settings tabs: carrier.plist
 * split into the groups a reader looks for, which SIMs pick a bundle, and the
 * badges that say where a value came from or how rare it is.
 */

import { isJsonDict, mergeSettings, type MccMncTable } from "#lib/decode/index.ts";
import type { KeyBadge } from "#lib/components/Tree.svelte";
import type { RareSetting } from "#lib/storage/scan.ts";

export const SETTING_GROUPS: Array<[string, string[]]> = [
  ["Identity", ["CarrierName", "HomeBundleIdentifier", "CountryName", "ISOAlpha2CountryCode", "SupportedSIMs", "SupportedPLMNs", "SupportedCarrierIds", "SupportedCountryIds", "MVNOOverrides"]],
  // The keys behind the Cellular switches in Settings, and what they default to; from the keys bundles actually set.
  ["Cellular: 5G, LTE, calling and roaming", [
    "Show5GSwitch", "Enable5GAutoByDefault", "Enable5GAutoAfterUpgrade", "Show5GWarningUnsupportedCarrier",
    "Supports5GStandalone", "Show5GStandaloneSwitch", "Show5GStandaloneSwitchOnlyWhenEntitled", "Enable5GStandaloneByDefault", "Enable5GStandaloneAfterUpgrade",
    "SupportsVoNR", "ShowVoNRSwitch", "EnableVoNRByDefault", "ShowVoNRWarningUnsupportedCarrier",
    "ShowHighDataModeSwitch", "SupportsNRNSAInboundRoaming", "NRSlicing", "DataIndicatorOverrideForNRMmwave", "EnableMmWaveSisOutrank", "IgnoreDSDForUI5G",
    "ShowVolteSwitch", "ShowVolteWarningUnsupportedCarrier", "SupportsVolteCapability", "MultiSimVoLteOnly",
    "Show4GSwitch", "Show4GSwitchWith5G", "Enable4GByDefault", "EnableLTEAfterUpgrade", "ShowLTEWarningUnsupportedCarrier", "DataIndicatorOverrideForLTE", "UseLTEAlternateBarMapping",
    "Show3GSwitch", "Show3GSwitchWith4G", "Show3GSwitchWith5G", "Show3GSwitchWithVolte", "AllowsHighQualityVideoOver3G",
    "ShowWiFiCallingWarningUnsupportedCarrier", "ShowWiFiCallingRoamingSwitch",
    "ShowVoiceRoamingSwitch", "IntlDataRoamingSwitch", "IntlDataRoamingAllowed", "IntlDataRoamingExceptions", "IgnoresIntlDataRoamingServiceList",
    "AllowCSCallsForInboundDomesticRoaming", "CDMAInternationalRoaming", "SupportsRoamingOnCDMA",
  ]],
  ["Data", ["apns", "AttachAPN", "MTU", "MMS", "PcoOptions", "APNEditabilityTypemask", "APNEditabilityTypemaskNew"]],
  ["Entitlements and eSIM", ["CarrierEntitlements", "RemoteCardProvisioningSettings", "PhoneAccountTransfer", "CellularPlanProvisioningSettings", "OTAActivation", "EncryptedIdentity", "QuickSwitch"]],
  ["Voice and IMS", ["IMSConfig", "TechSettings", "RCS", "VoicemailPilotNumber", "PhoneNumberRegistrationGatewayAddress", "SMSSettings", "PushSettings", "VisualVoicemailServiceName"]],
  ["Emergency and alerts", ["CellBroadcast", "EmergencyCalling", "EmergencyNumbers", "e_only_whitelist", "TestEmergencyNumber", "Location", "SUPL", "DisallowedDialingPrefixes"]],
  ["Presentation and policy", ["StatusBarImages", "Services", "CarrierBookmarks", "MyAccountURL", "CarrierSpace", "ManagedHours", "OTASoftwareUpdate", "NetworkEncryptionCiphers", "AllowedServicesTypeMaskOnInternet", "IgnoresDeactivateOnNetworkScanServiceMask"]],
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

export const asDict = (v: unknown) => (isJsonDict(v) ? v : undefined);

/**
 * carrier.plist with a phone's override plist merged in: a dictionary in the override is combined
 * key by key with the same dictionary in carrier.plist, and anything else replaces carrier.plist's
 * value. The files only make sense that way: AT&T's per-phone IMSConfig sets three keys, so
 * replacing the whole dictionary would leave those phones without the rest of their IMS settings.
 */
export function effective(carrier: Record<string, unknown>, phone?: Record<string, unknown>) {
  return { merged: phone ? mergeSettings(carrier, phone) : carrier, fromPhone: new Set(Object.keys(phone ?? {})) };
}


/** How a SIM gets this bundle: by MCC-MNC alone, an MCC-MNC plus GID or ICCID, an ICCID prefix, or a carrier ID. */
export interface SelectionRule { via: string; key: string; match?: string }

export function selectionRules(t: MccMncTable, bundle: string): SelectionRule[] {
  const out: SelectionRule[] = [];
  for (const e of t.entries) {
    if (e.bundle === bundle) out.push({ via: "MCC-MNC", key: e.plmn, match: e.mvnos.length ? "any SIM no MVNO rule claims" : "any SIM" });
    for (const m of e.mvnos) {
      if (m.bundle !== bundle) continue;
      const match = [m.gid1 && `GID1 ${m.gid1}`, m.gid2 && `GID2 ${m.gid2}`, m.iccid && `ICCID ${m.iccid}…`].filter(Boolean).join(", ");
      out.push({ via: "MCC-MNC", key: e.plmn, match });
    }
  }
  for (const [prefix, b] of t.iccids) if (b === bundle) out.push({ via: "ICCID", key: prefix + "…" });
  for (const [id, b] of t.carrierIds) if (b === bundle) out.push({ via: "Carrier ID", key: id, match: "CDMA carrier ID" });
  return out;
}

/** "1 of 663" when only this bundle has it; "3 of 663" with the others named in the title. */
export const rareLabel = (r: RareSetting) => `${r.holders} of ${r.of}`;

/** One badge per top-level key: the rarest thing under it. */
export function rareBadges(rows: readonly RareSetting[]): Record<string, KeyBadge[]> {
  const out: Record<string, KeyBadge[]> = {};
  for (const r of rows) {
    const top = r.path.split(/[.[]/, 1)[0] ?? r.path;
    if (out[top]) continue;
    const what = r.value === undefined ? `${r.path} is set` : `${r.path} = ${r.value}`;
    const also = r.with.length ? ` (also ${r.with.join(", ")})` : " (no other source)";
    out[top] = [{ text: rareLabel(r), tone: "rare", title: `${what} in ${r.holders} of ${r.of} sources${also}` }];
  }
  return out;
}

/**
 * What people call a feature, and words its keys use: a filter for "VoNR" or "Wi-Fi Calling"
 * should find the settings even when no key spells it that way.
 */
const TERMS: Array<[RegExp, string[]]> = [
  [/^(vonr|voiceovernr|voice over 5g|vo5g)$/, ["vonr"]],
  [/^(sa|5gsa|standalone|5g standalone)$/, ["standalone"]],
  [/^(wifi ?calling|wi-fi calling|vowifi|wfc)$/, ["wificalling", "vowifi", "epdg", "iwlan"]],
  [/^(volte|voice over lte|4g calling|hd voice)$/, ["volte", "ims"]],
  [/^(hotspot|tethering|personal hotspot)$/, ["tethering", "wirelessmodem", "hotspot"]],
  [/^(5g|nr)$/, ["5g", "nr"]],
];

/** The filter text itself, plus the key words its feature uses; all lowercase, matched as substrings. */
export function searchTerms(filter: string): string[] {
  const q = filter.trim().toLowerCase();
  if (!q) return [];
  const extra = TERMS.find(([re]) => re.test(q))?.[1] ?? [];
  return [q, ...extra];
}
