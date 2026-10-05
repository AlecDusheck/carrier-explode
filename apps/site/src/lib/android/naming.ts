/** How an Android version and a Pixel build read. */

import type { EntryNaming, ReleaseNaming } from "#lib/naming.ts";

/** The newest release carrying it and the file's own version; the mark is that release's. */
export const androidNaming: EntryNaming = {
  label: (e) => `Android ${e.images.at(-1) ?? ""} · version ${e.version}`,
  icon: (e) => e.images.at(-1) ?? e.ota[0],
};

/** A Pixel build reads as its Android version, and is named with its security patch: `Android 16 (2026-09)`. */
export const androidRelease: ReleaseNaming<"android"> = { os: (r) => r.version, label: (r) => `Android ${r.version} (${r.patch})` };
