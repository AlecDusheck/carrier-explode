/** What a platform's own settings say about a feature beyond its state. */

import type { FeatureSlug } from "./concepts.ts";
import { appleFeatureWhere } from "./ios/features.ts";
import { decoderFamily, type DecoderFamily, type Platform } from "./types.ts";

/** Apple names the Settings path of a feature's switch; Android's and Samsung's settings name none. */
const WHERE = {
	apple: appleFeatureWhere,
	android: () => undefined,
	samsung: () => undefined,
} as const satisfies Record<DecoderFamily, (slug: FeatureSlug) => string | undefined>;

/** Where a phone of `platform` has its switch for the feature, when its settings say. */
export const featureWhere = (platform: Platform, slug: FeatureSlug): string | undefined =>
	WHERE[decoderFamily(platform)](slug);
