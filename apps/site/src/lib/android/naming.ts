/** How an Android version and a Pixel build read. */

import type { EntryNaming, ReleaseNaming } from "#lib/naming.ts";

/** The newest release carrying it, else the OS its OTA file is for, and the file's own version; the mark is that OS's. */
export const androidNaming: EntryNaming = {
	label: (e) => {
		const image = e.images.at(-1);
		return `${image === undefined ? `OTA Android ${e.ota[0] ?? ""}` : `Android ${image}`} · version ${e.version}`;
	},
	icon: (e) => e.images.at(-1) ?? e.ota[0],
};

/** A Pixel OTA file is listed for build trains (`CP3A`); each reads as the Android version of the indexed builds of that train. */
export const trainVersions = (
	releases: ReadonlyArray<{ readonly id: string; readonly version: string }>,
): ReadonlyMap<string, string> => new Map(releases.map((r) => [r.id.split(".")[0] ?? r.id, r.version]));

/** A Pixel build reads as its Android version, and is named with its security patch: `Android 16 (2026-09)`. */
export const androidRelease: ReleaseNaming<"android"> = { label: (r) => `Android ${r.version} (${r.patch})` };

/** What the carrier list calls others.pb's parts that no carrier name stands for. */
export const OTHER_RULES = "Other SIM rules";
