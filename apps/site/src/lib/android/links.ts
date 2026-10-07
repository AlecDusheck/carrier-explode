/** Links into a Pixel or Galaxy modem firmware's own configurations. */

import type { DeviceReleasePlatform } from "@carrier-explode/schema/types";
import { modemHref } from "#lib/format.ts";

/** A firmware's page at one of its own configurations, by sha. */
export const configHref = (
	platform: DeviceReleasePlatform,
	build: string,
	modem: string,
	sha: string,
): string => `${modemHref(platform, build, modem)}?config=${encodeURIComponent(sha)}`;
