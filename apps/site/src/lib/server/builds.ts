/** Builds of every platform with OS images, and the modems one ships, each platform's read through one table. */

import type { ListedRelease } from "@carrier-explode/db";
import { RELEASE_PLATFORMS, type ReleasePlatform } from "@carrier-explode/schema/types";
import type { Named } from "#lib/types.ts";
import * as android from "./android/modems";
import * as apple from "./apple/modems";
import { releasesOf } from "./catalog";

/** One modem a build ships, and the phones running it. */
export interface BuildModem {
	/** What its page is named by: an iOS package's generation (`Mav25`), or the newest Pixel or Galaxy running the firmware (`tokay`, `SM-S948B`). */
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
	android: (build: string) => android.buildModems("android", build),
	samsung: (build: string) => android.buildModems("samsung", build),
} as const satisfies Record<ReleasePlatform, (build: string) => Promise<BuildModem[]>>;

/** The modem pages a build's listing names: an iOS image's package generations; a Pixel or Galaxy firmware's page is named by a device the listing does not hold. */
const LISTED_MODEMS = {
	ios: (r: ListedRelease) => r.modemFamilies.map((f) => f.code),
	android: () => [],
	samsung: () => [],
} as const satisfies Record<ReleasePlatform, (r: ListedRelease) => readonly string[]>;

export const listedModems = (r: ListedRelease): readonly string[] => LISTED_MODEMS[r.platform](r);

/** Every build held, each platform's newest first. */
export const getBuilds = async (): Promise<ListedRelease[]> =>
	(await Promise.all(RELEASE_PLATFORMS.map((p) => releasesOf(p)))).flat();

/** A build's modems, newest phone first. */
export const getBuildModems = (platform: ReleasePlatform, build: string): Promise<BuildModem[]> =>
	BUILD_MODEMS[platform](build);
