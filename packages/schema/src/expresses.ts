/** Which platform families can express a concept: those with a reader for it. */

import { ANDROID_CONCEPT_IDS } from "./android/readers.ts";
import { IOS_CONCEPT_IDS } from "./ios/readers.ts";
import { SAMSUNG_CONCEPT_IDS } from "./samsung/readers.ts";
import type { DecoderFamily } from "./types.ts";

const BY_FAMILY = {
	apple: IOS_CONCEPT_IDS,
	android: ANDROID_CONCEPT_IDS,
	samsung: SAMSUNG_CONCEPT_IDS,
} as const satisfies Record<DecoderFamily, ReadonlySet<string>>;

export const expresses = (family: DecoderFamily, conceptId: string): boolean =>
	BY_FAMILY[family].has(conceptId);
