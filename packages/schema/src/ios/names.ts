/** How Apple's bundle names read as words: `ATT_FirstNet_US` is ATT FirstNet in the US; `AntiguaAndBarbuda` is a country. */

import { countryName, isoForCountryName, isoForMcc } from "../countries.ts";
import type { SourceRef } from "../types.ts";

/** Radio and SIM flavours: in the bundle name, not in the brand. */
const TECH: ReadonlySet<string> = new Set(["LTE", "NR", "only", "ISIM", "CSIM", "USIM", "SIM", "Core"]);

/** Splits `AlaskaWireless` but not `StarHub`: only before a generic word. */
const GENERIC =
	/(?<=[a-z])(?=(?:Wireless|Telecom|Telekom|Mobile|Mobility|Network|Cellular|Valley|South|West)(?:[A-Z]|$))/g;

/** A carrier bundle name's words and country: an ISO suffix (`_US`), Apple's `_UK`, or a country word that stays in the name (`O2_Germany`). */
function carrierWords(name: string): { readonly words: readonly string[]; readonly iso: string | undefined } {
	const parts = name.split("_").filter((w) => w !== "");
	const last = parts.length > 1 ? parts.at(-1)?.toLowerCase() : undefined;
	if (last === undefined) return { words: parts, iso: undefined };
	if (last.length === 2 && countryName(last) !== undefined) return { words: parts.slice(0, -1), iso: last };
	if (last === "uk") return { words: parts.slice(0, -1), iso: "gb" };
	return { words: parts, iso: isoForCountryName(last) };
}

/** `ATT_FirstNet_US` -> ATT FirstNet: the name's words, without its country and radio flavours. A carrier's brand comes from its bundle's status-bar name, or a label. */
function words(name: string): string {
	return (
		carrierWords(name)
			.words.filter((w) => !TECH.has(w))
			.map((w) => w.replace(GENERIC, " "))
			.join(" ") || name.replaceAll("_", " ")
	);
}

/** `AntiguaAndBarbuda` -> Antigua and Barbuda. */
const countryDisplay = (name: string): string =>
	name
		.replace(/(?<=[a-z])(?=[A-Z])/g, " ")
		.replace(/(?<=.) (And|Of|The|Da)\b/g, (_, w: string) => ` ${w.toLowerCase()}`);

export const appleDisplay = (source: SourceRef): string =>
	source.kind === "country" ? countryDisplay(source.name) : words(source.name);

/** Country bundle names that are not a spelling of the ISO name. */
const COUNTRY_BUNDLES: ReadonlyMap<string, string> = new Map([
	["CzechRepublic", "cz"],
	["SaintPierreAndMiquelon", "pm"],
]);

const isoForCountryBundle = (name: string): string | undefined =>
	COUNTRY_BUNDLES.get(name) ?? isoForCountryName(name);

/** The country a bundle's name gives, if any. */
export const appleNameIso = (source: SourceRef): string | undefined =>
	source.kind === "country" ? isoForCountryBundle(source.name) : carrierWords(source.name).iso;

/** A country id as bundles write it: an MCC (`310`), a country bundle name, or its id (`com.apple.UnitedStates`). */
export const isoForCountryId = (id: string): string | undefined =>
	/^\d{3}$/.test(id) ? isoForMcc(id) : isoForCountryBundle(id.replace(/^com\.apple\./, ""));
