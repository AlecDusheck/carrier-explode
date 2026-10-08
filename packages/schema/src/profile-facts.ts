/**
 * A normalized object's identity as the index holds it, once per sha; what a source's head holds, once per source; and how
 * rare settings are judged over heads.
 */

import { canonical } from "@carrier-explode/values";
import { boardRadios, type BoardRadios } from "./ios/radio.ts";
import { configRadio, type ConfigRadio } from "./modem/index.ts";
import { layeredRadio } from "./radio.ts";
import {
	decoderFamily,
	matcherKey,
	MODEM_SCHEMA,
	PROFILE_SCHEMA,
	type ConceptValue,
	type DecoderFamily,
	type Json,
	type ModemConfig,
	type ModemItem,
	type Platform,
	type Profile,
} from "./types.ts";

/** One normalized object's identity, the SIM rules that select it, and what it says of a phone's radio. */
export type ProfileFacts = {
	readonly sha: string;
	readonly display: string | null;
	readonly iso: readonly string[];
	/** matcherKeys. */
	readonly sims: readonly string[];
} & (
	| { readonly kind: "settings"; readonly schema: Profile["schema"]; readonly radio: BoardRadios }
	| { readonly kind: "modem"; readonly schema: ModemConfig["schema"]; readonly radio: ConfigRadio }
);

/** The schema each kind's rows must be read under: rows from an older one are written again. */
export const FACTS_SCHEMA = { settings: PROFILE_SCHEMA, modem: MODEM_SCHEMA } as const satisfies {
	readonly [K in ProfileFacts["kind"]]: Extract<ProfileFacts, { readonly kind: K }>["schema"];
};

/** A profile's raw leaves and concept values, kept for a source's head only: scans and rarity compare heads. */
export interface HeadRows {
	/** `key` as the file states it (`apns[0].apn`), `path` with array indexes as `[*]`, `value` canonical JSON. */
	readonly settings: ReadonlyArray<{
		readonly file: string;
		readonly key: string;
		readonly path: string;
		readonly value: string;
	}>;
	/** `value` canonical JSON: a state, a value, or null when the file leaves it unset. */
	readonly concepts: ReadonlyArray<{ readonly concept: string; readonly value: string }>;
}

/** `carrier.plist:apns[0].apn` → [`carrier.plist`, `apns[0].apn`]; Android's `apns[0].apn` names no file. */
function splitRawKey(key: string): readonly [file: string, path: string] {
	const colon = key.indexOf(":");
	const bracket = key.indexOf("[");
	if (colon < 0 || (bracket >= 0 && bracket < colon)) return ["", key];
	return [key.slice(0, colon), key.slice(colon + 1)];
}

/** Apple signature hash lists and localisations are never worth comparing across sources. */
const comparable = (file: string): boolean => !file.startsWith("signatures/") && !file.includes(".lproj/");

const conceptLeaf = (c: ConceptValue): Json =>
	c.kind === "state" ? c.state : c.kind === "value" ? c.value : null;

export const profileFacts = (
	p: Pick<Profile, "sha" | "schema" | "identity"> & { readonly raw: Readonly<Record<string, unknown>> },
): ProfileFacts => ({
	sha: p.sha,
	schema: p.schema,
	kind: "settings",
	display: p.identity.display ?? null,
	iso: p.identity.iso,
	sims: [...new Set(p.identity.sims.map(matcherKey))],
	radio: boardRadios(
		Object.keys(p.raw).map((raw) => {
			const [file, key] = splitRawKey(raw);
			return { file, key };
		}),
	),
});

export function headRows(p: Profile): HeadRows {
	return {
		settings: Object.entries(p.raw).flatMap(([raw, value]) => {
			const [file, key] = splitRawKey(raw);
			return comparable(file)
				? [{ file, key, path: key.replaceAll(/\[\d+\]/g, "[*]"), value: canonical(value) }]
				: [];
		}),
		concepts: Object.entries(p.concepts).map(([concept, c]) => ({
			concept,
			value: canonical(conceptLeaf(c)),
		})),
	};
}

/** A modem configuration is selected by SIM rules, names nothing a carrier list shows, and configures the radio with its base's layers. */
export const modemFacts = (
	c: Pick<ModemConfig, "sha" | "schema" | "selection" | "family" | "base"> & {
		readonly items: ReadonlyArray<Pick<ModemItem, "id" | "name">>;
	},
	base: ConfigRadio | null,
): ProfileFacts => ({
	sha: c.sha,
	schema: c.schema,
	kind: "modem",
	display: null,
	iso: [],
	sims: [...new Set(c.selection.map(matcherKey))],
	radio: layeredRadio(configRadio(c), base),
});

/** The file rarity is judged in, and its top-level keys that only identify the source (customer.xml's GeneralInfo: sales code, country, networks). */
export interface RarityFile {
	readonly file: string;
	readonly identity: readonly string[];
}

const RARITY_FILES = {
	apple: { file: "carrier.plist", identity: [] },
	android: { file: "config", identity: [] },
	samsung: { file: "customer.xml", identity: ["GeneralInfo"] },
} as const satisfies Record<DecoderFamily, RarityFile>;

export const rarityFile = (platform: Platform): RarityFile => RARITY_FILES[decoderFamily(platform)];

export const mainFile = (platform: Platform): string => rarityFile(platform).file;

/** The thresholds a rare setting is judged by, among the heads of one platform and kind. */
export interface RarityThresholds {
	/** Below this many holders a path's values say too little to call one of them rare. */
	readonly minHolders: number;
	/** A path is a setting, not an identifier, with at most this many distinct values, or one per `holdersPerDistinct` holders. */
	readonly maxDistinctFloor: number;
	readonly holdersPerDistinct: number;
	/** A key is rare only in a group this big; in a small one every key is held by few. */
	readonly minGroupForRareKey: number;
	/** Rare: at most this many sources hold it. */
	readonly maxSharers: number;
	/** Rare values, and rare keys, kept per top-level key: a rare key's leaves all say the same. */
	readonly valuesPerTop: number;
	readonly keysPerTop: number;
	/** Rare settings kept. */
	readonly keep: number;
}

export const RARITY = {
	minHolders: 15,
	maxDistinctFloor: 4,
	holdersPerDistinct: 10,
	minGroupForRareKey: 50,
	maxSharers: 3,
	valuesPerTop: 3,
	keysPerTop: 1,
	keep: 30,
} as const satisfies RarityThresholds;
