/**
 * Shapes the server hands to pages, kept out of #lib/server so components can
 * name them.
 */

import type { FileDiff } from "#lib/decode/index.ts";
import { KIND_SEGMENT, SOURCE_KINDS, type Platform, type SourceKind, type SourceRef, type TimelineEntry } from "#lib/schema/types.ts";

/** The first segment of every page URL, one per kind of source: /carriers, /countries, /defaults. */
export type Kind = (typeof KIND_SEGMENT)[SourceKind];
export const KINDS: readonly Kind[] = SOURCE_KINDS.map((k) => KIND_SEGMENT[k]);

/** The kind of source a URL's first segment names: KIND_SEGMENT the other way. */
export const SOURCE_KIND = { carriers: "carrier", countries: "country", defaults: "default" } as const satisfies Record<Kind, SourceKind>;

/** A source, and a version of it: what every page under /<kind>/<platform>/<name>/<version>/ is about. */
export interface At {
  readonly ref: SourceRef;
  /** The source key. */
  readonly source: string;
  /** The timeline slug. */
  readonly version: string;
}

/**
 * A timeline entry as pages show it, its copies' releases read as OS versions.
 */
export interface Version extends TimelineEntry {
  readonly platform: Platform;
  /** The OS versions of the images carrying it, oldest first. */
  readonly images: readonly string[];
  /** The OS keys Apple's manifest publishes it under. */
  readonly ota: readonly string[];
  /** The names of `devices`, newest first; empty when it is for every device. */
  readonly phones: readonly string[];
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
