/**
 * Shapes the server hands to pages, kept out of #lib/server so components can
 * name them.
 */

import type { FileDiff } from "#lib/decode/index.ts";
import type { Platform, TimelineEntry } from "#lib/schema/types.ts";

/**
 * The three lists, and the first segment of every page URL: /carriers/<name>,
 * /countries/<name>, /watch/<name>. `<name>` is an iOS bundle name, or for a
 * carrier with no iOS bundle its Android name (index/carriers.json's slug).
 */
export const KINDS = ["carriers", "countries", "watch"] as const;
export type Kind = (typeof KINDS)[number];

/** A page, and a version on it (a timeline slug of either platform). */
export interface At {
  readonly kind: Kind;
  readonly name: string;
  readonly version: string;
}

/**
 * A timeline entry as pages show it: `os` is what its `releases` read as, the
 * OS versions of the images that carry it (an image entry's releases are build
 * ids) or the OTA minimum-OS keys it is published under.
 */
export interface Version extends TimelineEntry {
  readonly platform: Platform;
  readonly os: readonly string[];
  /** Android: the marketing names of `devices`, newest first. */
  readonly phones?: readonly string[] | undefined;
}

/** One part of a modem package diff, under the section it belongs to. */
export interface BasebandDiffPart extends FileDiff {
  readonly section: string;
}

/* ---------------------------------------------------------- cell broadcast */

export interface CbsMapping {
  from: number;
  to: number;
  alertType?: string | undefined;
  configuration?: string | undefined;
}

export interface CbsAlertType {
  name: string;
  enabledByDefault?: boolean | undefined;
  userConfigurable?: boolean | undefined;
  switchName?: string | undefined;
  notificationTitle?: string | undefined;
  soundAlertDeviceInMute?: boolean | undefined;
  soundIsMutableInDND?: boolean | undefined;
  customPreferences?: number | undefined;
}

/** One country bundle's cell-broadcast settings, from its carrier.plist. */
export interface CbsRow {
  countryName?: string | undefined;
  iso: string[];
  switchGroupTitle?: string | undefined;
  languages: string[];
  minimumDeviceCategory?: number | undefined;
  geofencing?: boolean | undefined;
  duplicateWindowMinutes?: number | undefined;
  interSimDuplicateDetection?: boolean | undefined;
  intraSimDuplicateDetection?: boolean | undefined;
  mappings: CbsMapping[];
  alertTypes: CbsAlertType[];
  alertConfigurations: Array<{ name: string; sound?: string | undefined; vibration?: string | undefined }>;
  appleSafetyAlertRanges: Array<{ from: number; to: number }>;
  /** 4382: the operator-defined CMAS identifier. */
  maps4382: boolean;
  alertType4382?: string | undefined;
  configurable4382?: boolean | null | undefined;
  emergencyNumbers: string[];
  amlDestination?: string | undefined;
  cbMessageLocales: string[];
  /** false = the bundle carries no CellBroadcast dictionary at all. */
  hasCellBroadcast: boolean;
}

/** What a version's tab body receives: the page and version, and the file a tab that takes one is on ("" for none). */
export interface TabProps {
  readonly at: At;
  readonly path: string;
}
