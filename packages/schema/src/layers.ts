/** Feature states a carrier leaves unset, read from the layers under it. */

import type { ConceptValue, Defaulted, DefaultLayer, FeatureState, NativeRef, Profile } from "./types.ts";

/** Each state a carrier leaves unset, and what of it which layer decided. */
export type LayeredStates = Readonly<
	Record<string, { readonly state: FeatureState; readonly defaulted: Defaulted }>
>;

/**
 * Each state `own` leaves unset, from the first of `layers` (each the concepts read over the carrier and every layer down
 * to it) that decides it; the layer decides only the rest when one of the settings deciding it is the carrier's.
 */
export function layerStates(
	own: Profile["concepts"],
	layers: ReadonlyArray<readonly [DefaultLayer, Readonly<Record<string, ConceptValue>>]>,
	carrierSets: (ref: NativeRef) => boolean,
): LayeredStates {
	const out: Record<string, LayeredStates[string]> = {};
	for (const [layer, concepts] of layers) {
		for (const [id, reading] of Object.entries(concepts)) {
			if (reading.kind !== "state" || own[id]?.kind === "state" || out[id] !== undefined) continue;
			out[id] = {
				state: reading.state,
				defaulted: { layer, part: reading.because.some(carrierSets) ? "rest" : "all" },
			};
		}
	}
	return out;
}
