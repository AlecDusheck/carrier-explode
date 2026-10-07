/** A source's carrier's other sources, as its Overview lists them and Compare suggests them. */

import { sourceOf, type Platform, type SourceKey } from "@carrier-explode/schema/types";
import { PLATFORM_ORDER } from "#lib/platforms.ts";

export interface PlatformMembers {
	readonly platform: Platform;
	readonly keys: readonly SourceKey[];
}

/** The carrier's members other than `self`, by platform in the site's order: the other platforms first, then `self`'s own. */
export function counterparts(self: SourceKey, members: readonly SourceKey[]): PlatformMembers[] {
	const own = sourceOf(self).platform;
	const byPlatform = Map.groupBy(
		members.filter((k) => k !== self),
		(k) => sourceOf(k).platform,
	);
	return [...PLATFORM_ORDER.filter((p) => p !== own), own].flatMap((platform) => {
		const keys = byPlatform.get(platform);
		return keys === undefined ? [] : [{ platform, keys }];
	});
}

/** What Compare offers opposite `self`: the carrier on other platforms, one source a platform, at most two. */
export const suggestions = (self: SourceKey, members: readonly SourceKey[]): SourceKey[] =>
	counterparts(self, members)
		.filter((g) => g.platform !== sourceOf(self).platform)
		.flatMap((g) => g.keys.slice(0, 1))
		.slice(0, 2);

/** A picker's items with the suggested ones first, in the suggestions' order. */
export const suggestedFirst = <T extends { readonly key: SourceKey }>(
	items: readonly T[],
	suggested: readonly SourceKey[],
): T[] => [
	...suggested.flatMap((k) => items.filter((i) => i.key === k)),
	...items.filter((i) => !suggested.includes(i.key)),
];
