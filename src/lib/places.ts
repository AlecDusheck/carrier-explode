/**
 * How a source is spelled in a page URL. Under /carriers/<slug>/<platform>/ a
 * source is its native name (`ATT_US`, `tmobile_us`); under /countries/<iso>/ios/
 * it is the country bundle's (`UnitedStates`). Anything else a source key
 * carries rides along as a marker: a kind other than the group's own
 * (`default~others`) and the Watch family (`Verizon_LTE_US~watch`). So a URL
 * names its source without reading the index, and a source key names its URL.
 */

import { PLATFORMS, type Platform, type SourceKind, type SourceRef } from "#lib/schema/types.ts";
import { GROUPS, type Group } from "#lib/types.ts";

/** The kind of source a group's pages are about. */
const NATURAL: Readonly<Record<Group, SourceKind>> = { carriers: "carrier", countries: "country" };
const KINDS: readonly SourceKind[] = ["carrier", "country", "default"];
const WATCH = "~watch";

export function segmentOf(group: Group, ref: SourceRef): string {
  const kind = ref.kind === NATURAL[group] ? "" : `${ref.kind}~`;
  return kind + ref.name + (ref.family === "Watch" ? WATCH : "");
}

export function refOf(group: Group, platform: Platform, segment: string): SourceRef {
  const marked = /^(\w+)~(.+)$/.exec(segment);
  const kind = KINDS.find((k) => k === marked?.[1]);
  const rest = kind && marked?.[2] ? marked[2] : segment;
  const watch = rest.endsWith(WATCH);
  return {
    platform,
    kind: kind ?? NATURAL[group],
    name: watch ? rest.slice(0, -WATCH.length) : rest,
    ...(watch ? { family: "Watch" as const } : {}),
  };
}

export const isGroup = (s: string): s is Group => GROUPS.some((g) => g === s);
export const isPlatform = (s: string): s is Platform => PLATFORMS.some((p) => p === s);

/** How each platform is named on a page. */
export const PLATFORM_NAMES = { ios: "iOS", android: "Android" } as const satisfies Record<Platform, string>;
