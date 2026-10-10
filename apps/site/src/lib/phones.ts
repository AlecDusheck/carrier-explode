/** A phone as the phone pickers offer it: its variants each the code of a page of their own. */

import type { PhoneModel, PhoneVariant } from "@carrier-explode/schema";
import type { Platform } from "@carrier-explode/schema/types";

export type ModelChoice = PhoneModel & { readonly platform: Platform; readonly label: string };

/** The variant a phone opens on: the one made for the visitor's country, sold in the fewest that include it, else its first. */
export const openingVariant = (p: ModelChoice, country: string | null): PhoneVariant | undefined =>
	p.variants
		.filter((v) => country !== null && v.countries.includes(country))
		.toSorted((a, b) => a.countries.length - b.countries.length)[0] ?? p.variants[0];

/** Whether some phone's variants are sold in different countries, so the visitor's country picks one. */
export const differsByCountry = (phones: readonly ModelChoice[]): boolean =>
	phones.some((p) => new Set(p.variants.map((v) => v.countries.join())).size > 1);
