/** The visitor's best guess, read in the browser after a page has drawn, so no page reads the visitor on the server and the edge can keep every page. */

import type { Platform } from "@carrier-explode/schema/types";
import { getVisitorGuess } from "#lib/api/sources.remote.ts";
import { browserDevice } from "./device";
import { guessPlatform, type VisitorGuess } from "./guess";

let asked: Promise<VisitorGuess> | undefined;

/** Asked once a page load, so every part of the page agrees; a failure is asked again. */
export function visitorGuess(): Promise<VisitorGuess> {
	asked ??= browserDevice()
		.then(getVisitorGuess)
		.catch((e: unknown) => {
			asked = undefined;
			throw e;
		});
	return asked;
}

/** The guess's platform alone, which the browser answers without the server. */
export const visitorPlatform = async (): Promise<Platform> => guessPlatform(await browserDevice());
