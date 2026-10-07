/** Phone drawings, by file name in ./drawings: a Pixel's codename (`tokay`), an iPhone's model (`iphone-17-pro`). Which exist is the directory's to say. */

import type { DecoderFamily } from "@carrier-explode/schema/types";
import { appleDrawingName } from "#lib/apple/drawing.ts";

const DRAWINGS = import.meta.glob<string>("./drawings/*.svg", {
	eager: true,
	query: "?url&no-inline",
	import: "default",
});

/** The drawing named `name`; undefined when there is none, for the platform's outline to stand in. */
export const drawing = (name: string): string | undefined => DRAWINGS[`./drawings/${name}.svg`];

/** A phone as a family names its drawing: Apple's by the model's name, a Pixel by its codename. */
interface Drawn {
	readonly id?: string | undefined;
	readonly name?: string | undefined;
}

export const DRAWING_NAMES = {
	apple: ({ name }: Drawn) => (name === undefined ? undefined : appleDrawingName(name)),
	android: ({ id }: Drawn) => id,
	samsung: () => undefined,
} as const satisfies Record<DecoderFamily, (phone: Drawn) => string | undefined>;
