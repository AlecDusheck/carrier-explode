/** A source's carrier's other sources, as its Overview lists them and Compare suggests them. */

import { sourceOf, type Platform, type SourceKey } from "@carrier-explode/schema/types";
import { PLATFORM_ORDER } from "#lib/platforms.ts";

type Keyed = { readonly key: SourceKey };

export interface PlatformMembers<T extends Keyed> {
	readonly platform: Platform;
	readonly members: readonly T[];
}

/** The carrier's members other than `self`, by platform in the site's order: the other platforms first, then `self`'s own. */
export function counterparts<T extends Keyed>(self: SourceKey, members: readonly T[]): PlatformMembers<T>[] {
	const own = sourceOf(self).platform;
	const byPlatform = Map.groupBy(
		members.filter((m) => m.key !== self),
		(m) => sourceOf(m.key).platform,
	);
	return [...PLATFORM_ORDER.filter((p) => p !== own), own].flatMap((platform) => {
		const found = byPlatform.get(platform);
		return found === undefined ? [] : [{ platform, members: found }];
	});
}

/** What Compare offers opposite `self`: the carrier on other platforms, one source a platform, at most two. */
export const suggestions = (self: SourceKey, members: readonly Keyed[]): SourceKey[] =>
	counterparts(self, members)
		.filter((g) => g.platform !== sourceOf(self).platform)
		.flatMap((g) => g.members.slice(0, 1).map((m) => m.key))
		.slice(0, 2);

/** A picker's items with the suggested ones first, in the suggestions' order. */
export const suggestedFirst = <T extends Keyed>(
	items: readonly T[],
	suggested: readonly SourceKey[],
): T[] => [
	...suggested.flatMap((k) => items.filter((i) => i.key === k)),
	...items.filter((i) => !suggested.includes(i.key)),
];
