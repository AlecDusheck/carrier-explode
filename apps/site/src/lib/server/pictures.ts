/** Every carrier source is pictured through its carrier, so an Android source shows its carrier's logo too. */

import type { ListedSource } from "@carrier-explode/db";
import { countryName } from "@carrier-explode/schema";
import { brandLogo, isLogoSlug, type LogoSlug } from "#lib/carrierlogos.ts";
import type { SourceRef } from "@carrier-explode/schema/types";
import type { Picture } from "#lib/types.ts";

/** What a source's picture is read from: its carrier's shown name and logo label, and its own country. */
export type Pictured = Pick<ListedSource, "carrierName" | "carrierLogo" | "cc">;

function labelledLogo(logo: string): LogoSlug {
	if (!isLogoSlug(logo)) throw new Error(`carrier logo label ${logo} names no file in static/carriers`);
	return logo;
}

/** A country bundle by its country's flag; a source the link step has given no carrier yet by its own name. */
export function pictureOf(ref: SourceRef, s: Pictured): Picture {
	if (ref.kind === "country") return { kind: "flag", cc: s.cc ?? undefined };
	if (s.carrierName === null) return { kind: "initials", brand: ref.name };
	const slug = s.carrierLogo === null ? brandLogo(s.carrierName) : labelledLogo(s.carrierLogo);
	return slug === undefined ? { kind: "initials", brand: s.carrierName } : { kind: "logo", slug };
}

/** What people call a source: its carrier's name, a country bundle's country, else its own name. */
export const brandOf = (ref: SourceRef, carrierName: string | null, cc: string | null): string =>
	carrierName ?? (ref.kind === "country" && cc !== null ? countryName(cc) : undefined) ?? ref.name;
