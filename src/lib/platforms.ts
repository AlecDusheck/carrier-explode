/** How each platform is named on a page. */

import type { Platform } from "#lib/schema/types.ts";

export const PLATFORM_NAMES = { ios: "iOS", ipados: "iPadOS", watchos: "watchOS", android: "Android" } as const satisfies Record<Platform, string>;
