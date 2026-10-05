/** v1 URLs, answered from the index's redirect table before routing. */

import type { RequestEvent } from "@sveltejs/kit";
import { isPlatform, type LegacyRoute } from "@carrier-explode/schema/types";
import { legacyRoutes as routesFor } from "@carrier-explode/db/d1";
import { db } from "./db";

/** The wiki's articles from before it had a section per platform, when every one was about iOS. */
const UNSECTIONED_WIKI = [
  "att", "bundle-selection", "carrier-bundle-manifest", "carrier-bundle", "carrier-plist", "china-self-registration", "default-bundle", "der-gri",
  "der-pri", "ipcc", "jio", "pri", "rakuten-mobile", "t-mobile-us", "verizon", "vodafone-uk",
] as const;

/** Pages that became other pages, not other sources: v1's, and the wiki's before its sections. v1 was iOS's alone. */
const MOVED: readonly LegacyRoute[] = [
  { from: "/watch", to: "/watchos/carriers" },
  { from: "/releases", to: "/ios/builds" },
  { from: "/baseband", to: "/ios/builds" },
  { from: "/cell-broadcast", to: "/ios/countries" },
  ...UNSECTIONED_WIKI.map((slug) => ({ from: `/wiki/${slug}`, to: `/wiki/ios/${slug}` })),
];

/** v1's lists, matched whole: a name after one is the table's to answer, never a guess. */
const LISTS: readonly LegacyRoute[] = [
  { from: "/carriers", to: "/ios/carriers" },
  { from: "/countries", to: "/ios/countries" },
];

/** v1 tabs that v1 itself already redirected: the tab they became, and the query they moved to. */
const TABS: Readonly<Record<string, { readonly tab: string; readonly query?: readonly [from: string, to: string]; readonly hash?: string }>> = {
  assets: { tab: "files" },
  baseband: { tab: "modem" },
  plist: { tab: "settings" },
  strings: { tab: "settings", query: ["file", "strings"], hash: "#text" },
};

/** v1 version segments: an image (`ios-27.2-beta-3`) or an OTA file (`ota-58.1`, `ota-58.1-iPad`, `ota-legacy`). */
const V1_VERSION = /^(ios|ota)-./;

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed escape names no v1 page; matched as written, it matches none.
    return segment;
  }
}

/** Compared decoded, so `iPhone17%2C1` and `iPhone17,1` are one segment. */
const segments = (path: string): string[] => path.split("/").slice(1).map(decoded);

const startsWith = (path: readonly string[], prefix: readonly string[]): boolean => prefix.every((s, i) => path[i] === s);

/** v1's kind pages: the list, or a bundle by name where the old v2 put a platform. */
function legacyPath(path: readonly string[]): boolean {
  const [first, second] = path;
  if (first === "carriers" || first === "countries") return second === undefined || second === "" || !isPlatform(second);
  return MOVED.some((m) => startsWith(path, segments(m.from)));
}

function split(url: URL): { readonly raw: boolean; readonly sent: readonly string[]; readonly path: readonly string[] } {
  const written = url.pathname.split("/").slice(1);
  const raw = written[0] === "raw";
  const sent = raw ? written.slice(1) : written;
  return { raw, sent, path: sent.map(decoded) };
}

/** A v1 shape, decided without the table: a kind alone or followed by a bundle name, or a moved page. */
export const isLegacyShape = (url: URL): boolean => legacyPath(split(url).path);

export type Answer =
  | { readonly status: 301; readonly location: string }
  | { readonly status: 404; readonly message: string; readonly elsewhere: string };

/** The longest whole-segment `from` wins and the rest of the path follows its `to`; a v1 version the table lacks is a 404, never a guess. */
export function answer(routes: readonly LegacyRoute[], url: URL): Answer | null {
  const { raw, sent, path } = split(url);
  if (!legacyPath(path)) return null;
  const lists = LISTS.filter((r) => segments(r.from).length === path.length);
  const best = [...routes, ...MOVED, ...lists]
    .map((r) => ({ r, from: segments(r.from) }))
    .filter(({ from }) => startsWith(path, from))
    .reduce<{ readonly r: LegacyRoute; readonly from: readonly string[] } | null>((a, b) => (a === null || b.from.length > a.from.length ? b : a), null);
  if (best === null) return null;
  const [next, ...more] = sent.slice(best.from.length);
  if (next !== undefined && V1_VERSION.test(decoded(next))) {
    return { status: 404, message: `No version ${decoded(next)} of this bundle.`, elsewhere: best.r.to };
  }
  const alias = next === undefined ? undefined : TABS[next];
  const rest = [...(next === undefined ? [] : [alias?.tab ?? next]), ...more];
  return { status: 301, location: [(raw ? "/raw" : "") + best.r.to, ...rest].join("/") + moveQuery(url.search, alias?.query) + (alias?.hash ?? "") };
}

function moveQuery(search: string, move: readonly [from: string, to: string] | undefined): string {
  if (move === undefined) return search;
  const q = new URLSearchParams(search);
  const value = q.get(move[0]);
  q.delete(move[0]);
  if (value !== null) q.set(move[1], value);
  return q.size ? `?${q}` : "";
}

/** The redirects whose `from` is one of these paths (`/carriers/ATT_US`, …). */
export const legacyRoutes = async (prefixes: readonly string[]): Promise<readonly LegacyRoute[]> => routesFor(await db(), prefixes);

/** Every whole-segment prefix of a decoded path, as the table spells its `from`. */
const prefixesOf = (path: readonly string[]): string[] => path.map((_, i) => `/${path.slice(0, i + 1).join("/")}`);

/** v1 URLs answer before routing; one the table lacks falls through to the router's 404, which names where to look instead. */
export async function legacyStep(
  event: Pick<RequestEvent, "url" | "locals">, routes: (prefixes: readonly string[]) => Promise<readonly LegacyRoute[]>,
): Promise<Response | null> {
  if (!isLegacyShape(event.url)) return null;
  const a = answer(await routes(prefixesOf(split(event.url).path)), event.url);
  if (a?.status === 301) return new Response(null, { status: 301, headers: { location: a.location } });
  if (a?.status === 404) event.locals.moved = { message: a.message, elsewhere: a.elsewhere };
  return null;
}
