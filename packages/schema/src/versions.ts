/** A sort key for bundle versions; their order is values' compareDotted, Apple's OS labels with betas decode-ios's compareVersions. */

import { versionSegments } from "@carrier-explode/values";

/** Wide enough for any OS version a feed states. */
const KEY_SEGMENTS = 4;
const KEY_DIGITS = 6;

/** A version as text that sorts as compareDotted does; each segment shifted by one, so a non-number sorts below 0. */
export function dottedKey(v: string): string {
	const parts = versionSegments(v);
	if (parts.length > KEY_SEGMENTS || parts.some((n) => n + 1 >= 10 ** KEY_DIGITS))
		throw new Error(`version ${v} is too long for a sort key`);
	return Array.from({ length: KEY_SEGMENTS }, (_, i) =>
		String((parts[i] ?? 0) + 1).padStart(KEY_DIGITS, "0"),
	).join(".");
}
