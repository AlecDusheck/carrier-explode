/** Links into the configurations a Pixel or Galaxy modem firmware carries. */

import type { DeviceReleasePlatform } from "@carrier-explode/schema/types";
import { modemHref } from "#lib/format.ts";

/** A firmware's page at one of its configurations, by sha. */
export const configHref = (
	platform: DeviceReleasePlatform,
	build: string,
	modem: string,
	sha: string,
): string => `${modemHref(platform, build, modem)}?config=${encodeURIComponent(sha)}`;

/** A firmware's page at the base layers one of its configurations is built on. */
export const baseHref = (
	platform: DeviceReleasePlatform,
	build: string,
	modem: string,
	sha: string,
): string => `${configHref(platform, build, modem, sha)}&base`;
