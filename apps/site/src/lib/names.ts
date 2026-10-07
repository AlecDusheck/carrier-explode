/** How a version slug reads to a person, a country's flag, and the folding searches match names by. */

import { countryName } from "@carrier-explode/schema";
import { parseVersionSlug } from "@carrier-explode/schema/types";

/** A version slug as words: `72.0` → "version 72.0", `64.1@23a341` → "version 64.1 (build 23A341)". */
export function versionLabel(slug: string): string {
	const v = parseVersionSlug(slug);
	if (!v) return slug;
	if (!v.firstSeen) return `version ${v.version}`;
	return `version ${v.version} (${v.firstSeen.kind === "ota" ? `OTA ${v.firstSeen.day}` : `build ${v.firstSeen.build.toUpperCase()}`})`;
}

/** A country's flag emoji from its ISO code: the two letters as regional indicator symbols. */
export function flag(cc: string | undefined): string | undefined {
	if (cc === undefined || countryName(cc) === undefined) return undefined;
	return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/**
 * A name reduced for matching: accents folded (Réunion reaches Reunion), then letters and digits
 * only, so "AT&T" finds ATT_US and "Red Pocket" finds ATT_RedPocket_US.
 */
export const fold = (s: string): string =>
	s
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");

/** Whether a file name says no more than the brand: `tmobile_us` and `TMobile_US` for T-Mobile, `a1_at` for A1. */
export const sameName = (brand: string, code: string): boolean =>
	fold(brand) === fold(code) || fold(brand) === fold(code.replace(/_[a-z]{2}$/i, ""));

/** The names more than one row has: rows a list must tell apart by something else. */
export function repeated<R>(rows: readonly R[], name: (row: R) => string): ReadonlySet<string> {
	const seen = new Set<string>();
	const twice = new Set<string>();
	for (const r of rows) (seen.has(name(r)) ? twice : seen).add(name(r));
	return twice;
}
