/** How a Galaxy firmware reads: its Android version, named with its build day, `Android 16 (2026-08-11)`. */

import type { ReleaseNaming } from "#lib/naming.ts";

export const samsungRelease: ReleaseNaming<"samsung"> = {
	label: (r) => `Android ${r.version} (${r.released ?? r.id})`,
};
