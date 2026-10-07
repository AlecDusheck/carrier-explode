/** Band-combination lists, keyed by their content; a config names its lists. */

import { sha256Hex } from "@carrier-explode/binary";

import type { BandCombination, ComboSet } from "../types.ts";

/** One source's combinations: a uecap file, a band_combos_per_plmn.xml section, a set of confseq items. */
export type ComboSource = readonly [source: string, combos: readonly BandCombination[]];

export interface KeyedCombos {
	readonly sets: readonly ComboSet[];
	readonly lists: ReadonlyMap<string, readonly BandCombination[]>;
}

/** Mappers build each component with the same key order, so the text is canonical. */
export const combosText = (combos: readonly BandCombination[]): string => JSON.stringify(combos);

/** The sources' lists keyed by sha256, identical lists one set naming every source; empty lists are left out. */
export async function keyCombos(sources: readonly ComboSource[]): Promise<KeyedCombos> {
	const sets = new Map<string, { sources: string[]; list: readonly BandCombination[] }>();
	for (const [source, list] of sources) {
		if (!list.length) continue;
		const key = await sha256Hex(new TextEncoder().encode(combosText(list)));
		const set = sets.get(key);
		if (set) set.sources.push(source);
		else sets.set(key, { sources: [source], list });
	}
	return {
		sets: [...sets].map(([key, s]): ComboSet => ({ key, sources: s.sources, count: s.list.length })),
		lists: new Map([...sets].map(([key, s]) => [key, s.list])),
	};
}
