/** A decoded member's raw body, as tests read it. */

import type { DecodedFile } from "../src/index.ts";

export const textOf = (d: DecodedFile): string | undefined =>
	d.raw !== null && "text" in d.raw ? d.raw.text : undefined;

export const hexOf = (d: DecodedFile): string | undefined =>
	d.raw !== null && "hex" in d.raw ? d.raw.hex : undefined;
