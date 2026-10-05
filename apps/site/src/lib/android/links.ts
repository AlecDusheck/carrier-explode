/** Links into a Pixel modem firmware's own configurations. */

import { modemHref } from "#lib/format.ts";

/** A firmware's page at one of its own configurations, by sha. */
export const configHref = (build: string, modem: string, sha: string): string => `${modemHref("android", build, modem)}?config=${encodeURIComponent(sha)}`;
