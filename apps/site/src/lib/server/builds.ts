/** Builds of every platform with OS images, and the modems one ships, each platform's read through one table. */

import type { Named, ReleasePlatform, ReleaseSummary } from "@carrier-explode/schema/types";
import * as android from "./android/modems";
import * as apple from "./apple/modems";
import { releaseList } from "./catalog";

/** One modem a build ships, and the phones running it. */
export interface BuildModem {
  /** What its page is named by: an iOS package's generation (`Mav25`), or the newest Pixel running the firmware (`tokay`). */
  readonly id: string;
  /** `Qualcomm X80 · Mav25`, `Samsung Shannon`. */
  readonly label: string;
  /** The package's or the firmware's own name. */
  readonly firmware: string;
  /** Newest first. */
  readonly devices: readonly Named[];
}

const BUILD_MODEMS = {
  ios: apple.buildModems,
  android: android.buildModems,
} as const satisfies Record<ReleasePlatform, (build: string) => Promise<BuildModem[]>>;

/** The modem pages a build's summary names: an iOS image's package generations; an Android firmware's page is named by a Pixel the summary does not list. */
const SUMMARY_MODEMS = {
  ios: (r: ReleaseSummary) => r.modemFamilies.map((f) => f.code),
  android: () => [],
} as const satisfies Record<ReleasePlatform, (r: ReleaseSummary) => readonly string[]>;

export const summaryModems = (r: ReleaseSummary): readonly string[] => SUMMARY_MODEMS[r.platform](r);

/** Every build held, newest first. */
export const getBuilds = async (): Promise<readonly ReleaseSummary[]> => releaseList();

/** A build's modems, newest phone first. */
export const getBuildModems = (platform: ReleasePlatform, build: string): Promise<BuildModem[]> => BUILD_MODEMS[platform](build);
