/**
 * Shapes the server hands to pages, kept out of $lib/server so components can
 * name them.
 */

import type { FileDiff } from "$lib/decode";

export const KINDS = ["carriers", "countries", "watch"] as const;
export type Kind = (typeof KINDS)[number];

export interface TimelineEntry {
  /** URL segment: ios-27.0, ios-27.2-beta-3, ota-58.1, ota-58.1-iPad, ota-legacy. */
  slug: string;
  source: "image" | "ota";
  /** iOS versions: the images that carry this exact bundle, or the OTA minimum-OS keys. */
  ios: string[];
  build: string;
  productType?: string;
  /** False when the content is identical to the entry below it. */
  changed: boolean;
  /** Only ever shipped in beta images: newest, but not what a phone on a release runs. */
  beta?: boolean;
  /** Where the bytes live: blob:<content id> or an Apple URL. Never sent to the browser as a link target for blobs. */
  src: string;
  /** Image entries: content id, its scheme, and the newest image build carrying it. */
  id?: string;
  scheme?: number;
  image?: string;
  /** OTA entries: the digests Apple publishes for the file. */
  sha1?: string;
  sha384?: string;
}

/** A timeline entry as pages see it: no storage location, and the Apple URL when there is one. */
export type PublicEntry = Omit<TimelineEntry, "src"> & { url: string | null };

/** One part of a modem package diff, under the section it belongs to. */
export interface BasebandDiffPart extends FileDiff { section: string }

/* ---------------------------------------------------------- cell broadcast */

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

/** One country's cell-broadcast settings, from its carrier.plist. */
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
  /** 4382: the operator-defined CMAS identifier. */
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
