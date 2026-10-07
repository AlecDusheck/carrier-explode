/** What a Galaxy reads for the IMS features its operator's entries leave unset: the IMS service's defaults. */

import { layerStates, type LayeredStates } from "../layers.ts";
import type { Profile } from "../types.ts";
import { isImsDefault, layeredIms } from "./ims.ts";
import { imsConcepts } from "./readers.ts";

export function galaxyDefaults(carrier: Pick<Profile, "concepts" | "raw">): LayeredStates {
	return layerStates(
		carrier.concepts,
		[["imsservice", imsConcepts({ ims: layeredIms(carrier.raw) })]],
		(ref) => !isImsDefault(ref),
	);
}
