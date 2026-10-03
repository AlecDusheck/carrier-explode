/**
 * A country bundle's cell-broadcast settings, read off its carrier.plist.
 *
 * Message IDs a country's bundle does not map are ignored by the handset, so
 * whether a country maps 4382 (the operator-defined CMAS ID) and whether the
 * user can switch it off is the interesting difference between bundles.
 */

import { isRecord } from "#lib/decode/index.ts";
import type { CbsAlertType, CbsMapping, CbsRow } from "#lib/types.ts";

type Rec = Record<string, unknown>;

const rec = (v: unknown): Rec => (isRecord(v) ? v : {});
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** A 3GPP message ID range; a single ID has no ToServiceID. */
function range(m: Rec): { from: number; to: number } | undefined {
  const from = num(m.FromServiceID);
  const to = num(m.ToServiceID) ?? from;
  return from === undefined || to === undefined ? undefined : { from, to };
}

function alertType(name: string, v: unknown): CbsAlertType {
  const a = rec(v);
  return {
    name,
    enabledByDefault: bool(a.EnabledByDefault),
    userConfigurable: bool(a.UserConfigurable),
    switchName: str(a.SwitchName),
    notificationTitle: str(a.NotificationTitle),
    soundAlertDeviceInMute: bool(a.SoundAlertDeviceInMute),
    soundIsMutableInDND: bool(a.SoundIsMutableInDND),
    customPreferences: Array.isArray(a.CustomPreferences) ? a.CustomPreferences.length : undefined,
  };
}

/** `locales`: the bundle's CBMessage.strings localisations, which say what alert text it carries. */
export function cbsRow(plist: Rec, locales: readonly string[]): CbsRow {
  const cb = rec(plist.CellBroadcast);
  const dup = rec(cb.DuplicateDetectionParameters);
  const mappings = recs(cb.MessageIDParameters3GPP)
    .flatMap((m): CbsMapping[] => {
      const r = range(m);
      return r ? [{ ...r, alertType: str(m.AlertType), configuration: str(m.AlertConfiguration) }] : [];
    })
    .sort((a, b) => a.from - b.from);
  const alertTypes = Object.entries(rec(cb.AlertTypes)).map(([name, v]) => alertType(name, v)).sort((a, b) => a.name.localeCompare(b.name));
  const hit = mappings.find((m) => 4382 >= m.from && 4382 <= m.to);
  return {
    countryName: str(plist.CountryName),
    iso: strs(plist.ISOAlpha2CountryCode),
    hasCellBroadcast: isRecord(plist.CellBroadcast),
    switchGroupTitle: str(cb.SwitchGroupTitle),
    languages: strs(cb.PrimaryBroadcastLanguages),
    minimumDeviceCategory: num(cb.MinimumDeviceCategorySupported),
    geofencing: bool(rec(cb.GeofencingConfiguration).FeatureEnabled),
    duplicateWindowMinutes: num(dup.DuplicationWindowInMinutes),
    interSimDuplicateDetection: bool(dup.PerformInterSimDuplicateDetection),
    intraSimDuplicateDetection: bool(dup.PerformIntraSimDuplicateDetection),
    mappings,
    appleSafetyAlertRanges: recs(rec(cb.AppleSafetyAlert).MessageIDParameters3GPP).flatMap((m) => range(m) ?? []),
    alertTypes,
    alertConfigurations: Object.entries(rec(cb.AlertConfigurations)).map(([name, v]) => {
      const c = rec(v);
      return { name, sound: str(c.Sound), vibration: str(c.Vibration) };
    }),
    maps4382: hit !== undefined,
    alertType4382: hit?.alertType,
    configurable4382: hit?.alertType ? (alertTypes.find((a) => a.name === hit.alertType)?.userConfigurable ?? null) : undefined,
    emergencyNumbers: recs(rec(plist.EmergencyCalling).EmergencyNumbers).flatMap((e) => str(e.Number) ?? []),
    amlDestination: str(rec(rec(rec(rec(rec(plist.Location).EmergencyLocation).AugmentedEmergencyAction).AML).SMS).Destination),
    cbMessageLocales: [...locales].sort(),
  };
}
