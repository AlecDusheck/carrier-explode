/** What a Pixel reads for the features its carrier's file leaves unset: its build's default.pb, then AOSP's defaults. */

import { layerStates, type LayeredStates } from "../layers.ts";
import type { NativeRef, Profile } from "../types.ts";
import { aospConfig, CONFIG_PREFIX, fileConfig, layered } from "./config.ts";
import { androidConcepts } from "./readers.ts";

type Layered = Pick<Profile, "concepts" | "apns" | "raw">;

export function pixelDefaults(carrier: Layered, base: Layered | null): LayeredStates {
	const own = fileConfig(carrier.raw);
	const withBase = base === null ? own : layered(own, fileConfig(base.raw));
	const read = (config: typeof own) => androidConcepts({ config, apns: carrier.apns });
	// default.pb's keys are named as the carrier's are: a key is the carrier's when its own file sets it.
	const carrierSets = (ref: NativeRef): boolean =>
		ref.path.startsWith(CONFIG_PREFIX) && own(ref.path.slice(CONFIG_PREFIX.length)) !== undefined;
	return layerStates(
		carrier.concepts,
		[
			["default.pb", read(withBase)],
			["aosp", read(layered(withBase, aospConfig))],
		],
		carrierSets,
	);
}
