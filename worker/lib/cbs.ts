/**
 * Cross-country cell-broadcast comparison.
 *
 * Message IDs a country's bundle does not map are ignored by the handset, so
 * whether a country maps 4382 (the operator-defined CMAS ID) and whether the
 * user can switch it off is the interesting difference between bundles.
 */

import { openIpcc, decodeFile } from "./ipcc.ts";
import type { CountrySummary } from "./manifest.ts";
import { compareVersions } from "./manifest.ts";

export interface CbsMapping {
  from: number;
  to: number;
  alertType?: string;
  configuration?: string;
}

export interface CbsAlertType {
  name: string;
  enabledByDefault?: boolean;
  userConfigurable?: boolean;
  switchName?: string;
  notificationTitle?: string;
  soundAlertDeviceInMute?: boolean;
  soundIsMutableInDND?: boolean;
  customPreferences?: number;
}

export interface CbsRow {
  country: string;
  key: string;
  version: string;
  minOS?: string;
  url: string;
  iso: string[];
  countryName?: string;
  /** CountryId keys that route here: numeric MCCs and reverse-DNS ids alike. */
  countryIds: string[];
  switchGroupTitle?: string;
  languages: string[];
  minimumDeviceCategory?: number;
  geofencing?: boolean;
  duplicateWindowMinutes?: number;
  interSimDuplicateDetection?: boolean;
  intraSimDuplicateDetection?: boolean;
  mappings: CbsMapping[];
  alertTypes: CbsAlertType[];
  alertConfigurations: Array<{ name: string; sound?: string; vibration?: string }>;
  appleSafetyAlertRanges: Array<{ from: number; to: number }>;
  /** 4382 — operator-defined CMAS identifier. */
  maps4382: boolean;
  alertType4382?: string;
  configurable4382?: boolean | null;
  emergencyNumbers: string[];
  amlDestination?: string;
  cbMessageLocales: string[];
  /** false = the bundle carries no CellBroadcast dictionary at all. */
  hasCellBroadcast: boolean;
  /** "image" = from the OS image in R2, "cdn" = Apple's asset server. */
  source: "image" | "cdn";
  error?: string;
}

type Any = Record<string, any>;

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function countPrefs(v: unknown): number | undefined {
  return Array.isArray(v) ? v.length : undefined;
}

export type Fetcher = (url: string) => Promise<Uint8Array>;

export async function buildCbsRow(c: CountrySummary, fetchUpstream: Fetcher): Promise<CbsRow> {
  const row: CbsRow = {
    country: c.id, key: c.key, version: c.version, minOS: c.minOS, url: c.url,
    iso: [], countryIds: c.countryIds, languages: [], mappings: [], alertTypes: [],
    alertConfigurations: [], appleSafetyAlertRanges: [], maps4382: false,
    emergencyNumbers: [], cbMessageLocales: [], hasCellBroadcast: false, source: "cdn",
  };
  try {
    const bytes = await fetchUpstream(c.url);
    const bundle = openIpcc(bytes);
    row.cbMessageLocales = bundle.info.files
      .filter((f) => f.path.endsWith("CBMessage.strings"))
      .map((f) => f.locale ?? "")
      .filter(Boolean)
      .sort();
    const carrierFile = bundle.info.files.find((f) => f.path === "carrier.plist");
    if (!carrierFile) { row.error = "no carrier.plist"; return row; }
    const p = decodeFile(bundle, "carrier.plist").plist as Any | undefined;
    if (!p) { row.error = "carrier.plist did not decode"; return row; }
    fillRow(row, p);
  } catch (e) {
    row.error = (e as Error).message;
  }
  return row;
}

/** Fill a row from an already-decoded country carrier.plist. */
export function fillRow(row: CbsRow, p: Any): void {
  {
    row.countryName = str(p.CountryName);
    row.iso = Array.isArray(p.ISOAlpha2CountryCode) ? p.ISOAlpha2CountryCode.filter((x: unknown) => typeof x === "string") : [];

    const cb = p.CellBroadcast as Any | undefined;
    row.hasCellBroadcast = !!cb;
    if (cb) {
      row.switchGroupTitle = str(cb.SwitchGroupTitle);
      row.languages = Array.isArray(cb.PrimaryBroadcastLanguages) ? cb.PrimaryBroadcastLanguages : [];
      row.minimumDeviceCategory = num(cb.MinimumDeviceCategorySupported);
      row.geofencing = bool(cb.GeofencingConfiguration?.FeatureEnabled);
      row.duplicateWindowMinutes = num(cb.DuplicateDetectionParameters?.DuplicationWindowInMinutes);
      row.interSimDuplicateDetection = bool(cb.DuplicateDetectionParameters?.PerformInterSimDuplicateDetection);
      row.intraSimDuplicateDetection = bool(cb.DuplicateDetectionParameters?.PerformIntraSimDuplicateDetection);

      if (Array.isArray(cb.MessageIDParameters3GPP)) {
        for (const m of cb.MessageIDParameters3GPP as Any[]) {
          const from = num(m.FromServiceID), to = num(m.ToServiceID) ?? num(m.FromServiceID);
          if (from === undefined || to === undefined) continue;
          row.mappings.push({ from, to, alertType: str(m.AlertType), configuration: str(m.AlertConfiguration) });
        }
        row.mappings.sort((a, b) => a.from - b.from);
      }
      if (Array.isArray(cb.AppleSafetyAlert?.MessageIDParameters3GPP)) {
        for (const m of cb.AppleSafetyAlert.MessageIDParameters3GPP as Any[]) {
          const from = num(m.FromServiceID), to = num(m.ToServiceID) ?? num(m.FromServiceID);
          if (from !== undefined && to !== undefined) row.appleSafetyAlertRanges.push({ from, to });
        }
      }
      if (cb.AlertTypes && typeof cb.AlertTypes === "object") {
        for (const [name, v] of Object.entries(cb.AlertTypes as Any)) {
          const a = v as Any;
          row.alertTypes.push({
            name,
            enabledByDefault: bool(a.EnabledByDefault),
            userConfigurable: bool(a.UserConfigurable),
            switchName: str(a.SwitchName),
            notificationTitle: str(a.NotificationTitle),
            soundAlertDeviceInMute: bool(a.SoundAlertDeviceInMute),
            soundIsMutableInDND: bool(a.SoundIsMutableInDND),
            customPreferences: countPrefs(a.CustomPreferences),
          });
        }
        row.alertTypes.sort((a, b) => a.name.localeCompare(b.name));
      }
      if (cb.AlertConfigurations && typeof cb.AlertConfigurations === "object") {
        for (const [name, v] of Object.entries(cb.AlertConfigurations as Any)) {
          row.alertConfigurations.push({ name, sound: str((v as Any).Sound), vibration: str((v as Any).Vibration) });
        }
      }

      const hit = row.mappings.find((m) => 4382 >= m.from && 4382 <= m.to);
      row.maps4382 = !!hit;
      row.alertType4382 = hit?.alertType;
      if (hit?.alertType) {
        const at = row.alertTypes.find((a) => a.name === hit.alertType);
        row.configurable4382 = at?.userConfigurable ?? null;
      }
    }

    const em = p.EmergencyCalling as Any | undefined;
    if (Array.isArray(em?.EmergencyNumbers)) {
      row.emergencyNumbers = (em.EmergencyNumbers as Any[])
        .map((e) => str(e.Number))
        .filter((x): x is string => !!x);
    }
    row.amlDestination = str(p.Location?.EmergencyLocation?.AugmentedEmergencyAction?.AML?.SMS?.Destination);
  }
}

export interface ImageCountries {
  version: string;
  build: string;
  /** Bundle name -> bundle build, from the image index. */
  builds: Record<string, string>;
  /** Bundle name -> decoded carrier.plist. */
  plists: Record<string, Any>;
}

/**
 * One row per country. The OS image is the base; a CDN bundle replaces the
 * image's only when its build is newer, which is what the phone itself does.
 */
export async function buildMergedCbsMatrix(
  image: ImageCountries | null,
  cdn: CountrySummary[],
  fetchUpstream: Fetcher,
) {
  const rows = new Map<string, CbsRow>();
  if (image) {
    for (const [name, plist] of Object.entries(image.plists)) {
      const row: CbsRow = {
        country: name, key: name, version: image.builds[name] ?? "", url: `r2:system/${image.build}/countries/${name}.ipcc`,
        iso: [], countryIds: [], languages: [], mappings: [], alertTypes: [], alertConfigurations: [],
        appleSafetyAlertRanges: [], maps4382: false, emergencyNumbers: [], cbMessageLocales: [],
        hasCellBroadcast: false, source: "image",
      };
      fillRow(row, plist);
      rows.set(name, row);
    }
  }
  const newer = latestPerCountry(cdn, "iPhone").filter((c) => {
    const have = rows.get(c.id);
    return !have || compareVersions(c.version, have.version) > 0;
  });
  for (let i = 0; i < newer.length; i += 8) {
    for (const r of await Promise.all(newer.slice(i, i + 8).map((c) => buildCbsRow(c, fetchUpstream)))) {
      if (!r.error) rows.set(r.country, r);
    }
  }
  const out = [...rows.values()].sort((a, b) => (a.countryName ?? a.country).localeCompare(b.countryName ?? b.country));
  const ids = new Set<number>();
  for (const r of out) for (const m of r.mappings) for (let id = m.from; id <= m.to && id - m.from < 64; id++) ids.add(id);
  return {
    family: "iPhone",
    generatedAt: new Date().toISOString(),
    image: image ? { version: image.version, build: image.build } : null,
    messageIds: [...ids].sort((a, b) => a - b),
    rows: out,
  };
}

/** Latest bundle per country for the given family. */
export function latestPerCountry(countries: CountrySummary[], family: "iPhone" | "Watch"): CountrySummary[] {
  const best = new Map<string, CountrySummary>();
  for (const c of countries) {
    if (c.family !== family) continue;
    const prev = best.get(c.id);
    if (!prev || compareVersions(c.version, prev.version) > 0) best.set(c.id, c);
  }
  return [...best.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function buildCbsMatrix(
  countries: CountrySummary[],
  fetchUpstream: Fetcher,
  family: "iPhone" | "Watch" = "iPhone",
) {
  const targets = latestPerCountry(countries, family);
  const rows: CbsRow[] = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    rows.push(...(await Promise.all(targets.slice(i, i + CONCURRENCY).map((t) => buildCbsRow(t, fetchUpstream)))));
  }
  const ids = new Set<number>();
  for (const r of rows) for (const m of r.mappings) for (let id = m.from; id <= m.to && id - m.from < 64; id++) ids.add(id);
  return {
    family,
    generatedAt: new Date().toISOString(),
    messageIds: [...ids].sort((a, b) => a - b),
    rows,
  };
}
