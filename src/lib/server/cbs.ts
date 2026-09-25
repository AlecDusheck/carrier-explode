/**
 * Cross-country cell-broadcast comparison.
 *
 * Message IDs a country's bundle does not map are ignored by the handset, so
 * whether a country maps 4382 (the operator-defined CMAS ID) and whether the
 * user can switch it off is the interesting difference between bundles.
 */

import { openIpcc, decodeFile, decodedPlist, isRecord } from "$lib/decode";
import type { CbsAlertType, CbsMapping, CbsRow } from "$lib/types";
import { compareVersions, type CountrySummary } from "./manifest";

type Rec = Record<string, unknown>;

const rec = (v: unknown): Rec => (isRecord(v) ? v : {});
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export type Fetcher = (url: string) => Promise<Uint8Array>;

const emptyRow = (row: Pick<CbsRow, "country" | "key" | "version" | "url" | "source"> & Partial<CbsRow>): CbsRow => ({
  iso: [], countryIds: [], languages: [], mappings: [], alertTypes: [], alertConfigurations: [],
  appleSafetyAlertRanges: [], maps4382: false, emergencyNumbers: [], cbMessageLocales: [], hasCellBroadcast: false,
  ...row,
});

/** A country's row from its OTA bundle. A bundle that fails to fetch or decode gives a row with `error` set. */
export async function buildCbsRow(c: CountrySummary, fetchUpstream: Fetcher): Promise<CbsRow> {
  const row = emptyRow({ country: c.id, key: c.key, version: c.version, minOS: c.minOS, url: c.url, countryIds: c.countryIds, source: "cdn" });
  try {
    const bundle = openIpcc(await fetchUpstream(c.url));
    row.cbMessageLocales = bundle.info.files
      .filter((f) => f.path.endsWith("CBMessage.strings"))
      .map((f) => f.locale ?? "")
      .filter(Boolean)
      .sort();
    if (!bundle.info.files.some((f) => f.path === "carrier.plist")) return { ...row, error: "no carrier.plist" };
    const p = decodedPlist(decodeFile(bundle, "carrier.plist"));
    if (!isRecord(p)) return { ...row, error: "carrier.plist did not decode" };
    fillRow(row, p);
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e);
  }
  return row;
}

/** A 3GPP message ID range; a single ID has no ToServiceID. */
function range(m: Rec): { from: number; to: number } | undefined {
  const from = num(m.FromServiceID), to = num(m.ToServiceID) ?? from;
  return from === undefined || to === undefined ? undefined : { from, to };
}

/** Fill a row from a decoded country carrier.plist. */
function fillRow(row: CbsRow, p: Rec): void {
  row.countryName = str(p.CountryName);
  row.iso = strs(p.ISOAlpha2CountryCode);

  const cb = p.CellBroadcast;
  row.hasCellBroadcast = isRecord(cb);
  if (isRecord(cb)) {
    const dup = rec(cb.DuplicateDetectionParameters);
    row.switchGroupTitle = str(cb.SwitchGroupTitle);
    row.languages = strs(cb.PrimaryBroadcastLanguages);
    row.minimumDeviceCategory = num(cb.MinimumDeviceCategorySupported);
    row.geofencing = bool(rec(cb.GeofencingConfiguration).FeatureEnabled);
    row.duplicateWindowMinutes = num(dup.DuplicationWindowInMinutes);
    row.interSimDuplicateDetection = bool(dup.PerformInterSimDuplicateDetection);
    row.intraSimDuplicateDetection = bool(dup.PerformIntraSimDuplicateDetection);

    row.mappings = recs(cb.MessageIDParameters3GPP)
      .flatMap((m): CbsMapping[] => {
        const r = range(m);
        return r ? [{ ...r, alertType: str(m.AlertType), configuration: str(m.AlertConfiguration) }] : [];
      })
      .sort((a, b) => a.from - b.from);
    row.appleSafetyAlertRanges = recs(rec(cb.AppleSafetyAlert).MessageIDParameters3GPP).flatMap((m) => range(m) ?? []);
    row.alertTypes = Object.entries(rec(cb.AlertTypes))
      .map(([name, v]): CbsAlertType => {
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
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    row.alertConfigurations = Object.entries(rec(cb.AlertConfigurations)).map(([name, v]) => {
      const c = rec(v);
      return { name, sound: str(c.Sound), vibration: str(c.Vibration) };
    });

    const hit = row.mappings.find((m) => 4382 >= m.from && 4382 <= m.to);
    row.maps4382 = !!hit;
    row.alertType4382 = hit?.alertType;
    if (hit?.alertType) row.configurable4382 = row.alertTypes.find((a) => a.name === hit.alertType)?.userConfigurable ?? null;
  }

  row.emergencyNumbers = recs(rec(p.EmergencyCalling).EmergencyNumbers).map((e) => str(e.Number)).filter((n): n is string => !!n);
  row.amlDestination = str(rec(rec(rec(rec(rec(p.Location).EmergencyLocation).AugmentedEmergencyAction).AML).SMS).Destination);
}

export interface ImageCountries {
  version: string;
  build: string;
  /** Bundle name -> bundle build, from the image index. */
  builds: Record<string, string>;
  /** Bundle name -> decoded carrier.plist. */
  plists: Record<string, Rec>;
}

/**
 * One row per country. The OS image is the base; a CDN bundle replaces the
 * image's only when its build is newer, which is what the phone itself does.
 */
export async function buildMergedCbsMatrix(image: ImageCountries | null, cdn: CountrySummary[], fetchUpstream: Fetcher) {
  const rows = new Map<string, CbsRow>();
  if (image) {
    for (const [name, plist] of Object.entries(image.plists)) {
      const row = emptyRow({ country: name, key: name, version: image.builds[name] ?? "", url: "", source: "image" });
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
    family: "iPhone" as const,
    generatedAt: new Date().toISOString(),
    image: image ? { version: image.version, build: image.build } : null,
    messageIds: [...ids].sort((a, b) => a - b),
    rows: out,
  };
}

/** Latest bundle per country of one family. */
export function latestPerCountry(countries: CountrySummary[], family: CountrySummary["family"]): CountrySummary[] {
  const best = new Map<string, CountrySummary>();
  for (const c of countries) {
    if (c.family !== family) continue;
    const prev = best.get(c.id);
    if (!prev || compareVersions(c.version, prev.version) > 0) best.set(c.id, c);
  }
  return [...best.values()].sort((a, b) => a.id.localeCompare(b.id));
}
