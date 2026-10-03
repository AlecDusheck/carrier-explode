/** v1 URLs, answered with a 301 to their v2 pages from the index's redirect table (index/legacy.json). */

import type { LegacyRoute } from "#lib/schema/types.ts";

/** v1 pages that became other pages, not other sources. */
const MOVED: readonly LegacyRoute[] = [
  { from: "/watch", to: "/carriers/watchos" },
  { from: "/releases", to: "/builds" },
  { from: "/baseband", to: "/builds" },
  { from: "/plmn", to: "/sim" },
  { from: "/cell-broadcast", to: "/countries" },
];

const PLATFORM_SEGMENT = /^(ios|ipados|watchos|android)$/;
/** v1 version segments: an image (`ios-27.2-beta-3`) or an OTA file (`ota-58.1`, `ota-58.1-iPad`, `ota-legacy`). */
const V1_VERSION = /^(ios|ota)-./;

/** Whether a path has a v1 shape: a kind followed by a bundle name where v2 has a platform, or a moved page. */
export function isLegacy(pathname: string): boolean {
  const [first, second] = pathname.replace(/^\/raw(?=\/)/, "").split("/").slice(1);
  if (first === "carriers" || first === "countries") return second !== undefined && second !== "" && !PLATFORM_SEGMENT.test(second);
  return MOVED.some((m) => pathname === m.from || pathname.startsWith(m.from + "/"));
}

export type Answer =
  | { readonly status: 301; readonly location: string }
  | { readonly status: 404; readonly message: string; readonly page: string };

/**
 * The longest route whose `from` is a whole-segment prefix of the path wins,
 * and the rest of the path (a tab, a file) follows its `to`. A rest starting
 * with a v1 version the table does not know is a 404 pointing at the source's
 * page: a nearby version is not the one asked for.
 */
export function answer(routes: readonly LegacyRoute[], pathname: string, search: string): Answer | null {
  const raw = pathname.startsWith("/raw/");
  const path = raw ? pathname.slice("/raw".length) : pathname;
  const best = [...routes, ...MOVED]
    .filter((r) => path === r.from || path.startsWith(r.from + "/"))
    .reduce<LegacyRoute | null>((a, r) => (!a || r.from.length > a.from.length ? r : a), null);
  if (!best) return null;
  const rest = path.slice(best.from.length);
  const next = rest.split("/")[1];
  const to = (raw ? "/raw" : "") + best.to;
  if (next !== undefined && V1_VERSION.test(next)) return { status: 404, message: `No version ${next} of this bundle.`, page: best.to };
  return { status: 301, location: to + rest + search };
}
