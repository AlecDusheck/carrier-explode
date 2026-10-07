/** How a version and a release read on each platform, looked up by platform. */

import type { ListedRelease } from "@carrier-explode/db";
import type { Platform, ReleasePlatform } from "@carrier-explode/schema/types";
import { androidNaming, androidRelease } from "#lib/android/naming.ts";
import { appleNaming, iosRelease } from "#lib/apple/naming.ts";
import { samsungRelease } from "#lib/samsung/naming.ts";

/** What a version is named from: the OS versions of the images carrying it (oldest first), the OS keys an OTA copy is published under, and its own version. */
interface Carried {
	readonly images: readonly string[];
	readonly ota: readonly string[];
	readonly version: string;
}

/** How a version reads in the strip: its label, and the OS version its mark shows. */
export interface EntryNaming {
	readonly label: (e: Carried) => string;
	readonly icon: (e: Carried) => string | undefined;
}

export const NAMING = {
	ios: appleNaming("iOS"),
	ipados: appleNaming("iPadOS"),
	watchos: appleNaming("watchOS"),
	android: androidNaming,
	// A Galaxy line reads as a Pixel line does: the newest release carrying the version, and its own version.
	samsung: androidNaming,
} as const satisfies Record<Platform, EntryNaming>;

export type ReleaseOf<P extends ReleasePlatform> = Extract<ListedRelease, { readonly platform: P }>;

/** How a release reads: the OS version its images' copies show, and the build as people name it. */
export interface ReleaseNaming<P extends ReleasePlatform> {
	readonly label: (r: ReleaseOf<P>) => string;
}

const RELEASE_NAMING: { readonly [P in ReleasePlatform]: ReleaseNaming<P> } = {
	ios: iosRelease,
	android: androidRelease,
	samsung: samsungRelease,
};

/** `iOS 27.2 beta 2`, `Android 16 (2026-09)`. */
export const releaseLabel = <P extends ReleasePlatform>(r: ReleaseOf<P> & { readonly platform: P }): string =>
	RELEASE_NAMING[r.platform].label(r);
