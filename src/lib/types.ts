/**
 * Shapes the server hands to pages, kept out of #lib/server so components can
 * name them.
 */

import type { FileDiff } from "#lib/decode/index.ts";
import type { SourceRef, TimelineEntry } from "#lib/schema/types.ts";

/** The two kinds of page a source lives under: its carrier, or (iOS country bundles) its country. */
export const GROUPS = ["carriers", "countries"] as const;
export type Group = (typeof GROUPS)[number];

/** A carrier (by slug) or a country (by ISO code). */
export interface Place {
  readonly group: Group;
  readonly id: string;
}

/**
 * A timeline entry as pages show it: `os` is what its `releases` read as, the
 * OS versions of the images that carry it (an image entry's releases are build
 * ids) or the OTA minimum-OS keys it is published under.
 */
export interface Version extends TimelineEntry {
  readonly os: readonly string[];
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

/** One source at one version, where its pages live: what every native view is given. */
export interface NativeAt {
  readonly place: Place;
  readonly ref: SourceRef;
  /** The source key. */
  readonly source: string;
  /** The timeline slug. */
  readonly version: string;
}

/** What a native view's tab body receives: the version, and the file a tab that takes one is on ("" for none). */
export interface TabProps {
  readonly at: NativeAt;
  readonly path: string;
}
