/**
 * Cache policy for whole responses. lib/server/cache.ts holds the pieces a page
 * is built from; this decides how long the built page itself may sit in front of
 * the worker.
 *
 * That cache is Workers Cache ("cache" in wrangler.jsonc): keyed by worker
 * version and purgeable by tag. It is addressed through
 * cloudflare-cdn-cache-control — highest precedence, consumed by Cloudflare,
 * stripped before the client — so Cache-Control speaks only to browsers, and
 * no shared cache we cannot purge ever holds a page.
 *
 * The edge TTL uses max-age rather than s-maxage on purpose: s-maxage disables
 * stale-while-revalidate, which would make every expiry block on a fresh render.
 */

import { env } from "cloudflare:workers";
import type { RequestEvent } from "@sveltejs/kit";
import { keys } from "#lib/storage/keys.ts";
import type { LegacyRoute } from "#lib/schema/types.ts";
import { cached } from "#lib/server/cache.ts";
import { answer, isLegacy } from "#lib/server/legacy.ts";
import * as records from "#lib/server/records.ts";
import { etagOf, readJson } from "#lib/server/store.ts";
import type { Handle } from "@sveltejs/kit/hooks";
import type { RouteId } from "$app/types";
import { QUERIES, isQueryName, type QueryPolicy, type RateClass } from "#lib/api/policy.ts";

/**
 * Per-IP budgets, sized to the work a request can start rather than to the
 * request itself. Counters live in the Cloudflare location that served the
 * request and are eventually consistent, so these are ceilings on hammering
 * from one source, not an accounting system. A cache hit never reaches the
 * worker, so only the misses — the expensive ones — are counted.
 */
const BUDGET: Record<RateClass, "RL_SCAN" | "RL_DIFF" | "RL_BUNDLE" | "RL_BASE"> = {
  // A scan is one shard read from the precomputed index. Its cache key is
  // built from client-supplied strings, so a miss costs nothing to manufacture;
  // ten a minute is a fidgety human and a tenth of what a script would want.
  scan: "RL_SCAN",
  // Two opens and a full-bundle diff per miss; results are cached per pair.
  diff: "RL_DIFF",
  // Everything that can pull and unzip an .ipcc or decode a CarrierSettings: /raw,
  // the version queries, and a page pinned to a version. The assets gallery fires
  // one /raw per image, so this has to hold a page view plus its burst.
  bundle: "RL_BUNDLE",
  // Pages and the cached tables. Cheap, but a list with a guess is no-store and
  // so runs the worker every time.
  base: "RL_BASE",
};

const SOURCE = "/[kind=kind]/[platform=platform]/[name]";
const VERSION = `${SOURCE}/[[line=line]]/[version=version]`;
const RAW: RouteId = `/raw${VERSION}/[...path]`;

/** Pages that open an artifact whether or not they name a version: a member as-is, and a diff. */
const BUNDLE_ROUTES: ReadonlySet<RouteId> = new Set<RouteId>([RAW, "/compare"]);

/**
 * Pages rendered from modem package summaries or a release's modems, which the
 * ios.modems job can rewrite (it purges the "baseband" tag), and pages listing
 * phones by modem: an Apple version's Settings, Modem and Changes tabs, and the Features pages.
 */
const BASEBAND_ROUTES: ReadonlySet<RouteId> = new Set<RouteId>([
  "/builds", "/builds/[build]", "/builds/[build]/[family]", "/builds/[build]/[family]/carriers",
  "/builds/[build]/[family]/policy", "/builds/[build]/[family]/policy/[i]", "/builds/[build]/[family]/networks",
  "/builds/[build]/[family]/configs", "/builds/[build]/[family]/changes", "/sitemap.xml",
  SOURCE, VERSION, `${VERSION}/[tab=tab]/[...path]`, "/features", "/features/[feature=feature]",
]);

const routeIn = (routes: ReadonlySet<RouteId>, id: RouteId | null) => id !== null && routes.has(id);

/**
 * The policy of the remote query a request calls, or null for a page. For a
 * remote call `event.url` is the page it came from, so the function name has
 * to come off the request: /_app/remote/<hash>/<name>.
 */
export function remoteQuery(event: Pick<RequestEvent, "request" | "isRemoteRequest">): QueryPolicy | null {
  if (!event.isRemoteRequest) return null;
  const name = new URL(event.request.url).pathname.split("/remote/")[1]?.split("/")[1] ?? "";
  return isQueryName(name) ? QUERIES[name] : { rate: "base" };
}

/** Split out from the hook so it can be tested without a worker. */
export function rateClass(event: Pick<RequestEvent, "route" | "params">, query: QueryPolicy | null): RateClass {
  if (query) return query.rate;
  // Every other bundle page is pinned to a version.
  return routeIn(BUNDLE_ROUTES, event.route.id) || event.params.version ? "bundle" : "base";
}

/** A 429, or null to let the request through. A request without an IP fails open. */
async function overBudget(event: RequestEvent, rate: RateClass): Promise<Response | null> {
  const ip = event.request.headers.get("cf-connecting-ip");
  if (!ip || (await env[BUDGET[rate]].limit({ key: ip })).success) return null;

  const message = "Too many requests from your address. Give it a minute.";
  // The remote client parses this shape off a failed response and throws it
  // into the pane's boundary; anything else there surfaces as a parse error.
  const body = event.isRemoteRequest
    ? JSON.stringify({ type: "error", status: 429, error: { message } })
    : message + "\n";
  return new Response(body, {
    status: 429,
    headers: {
      "content-type": event.isRemoteRequest ? "application/json" : "text/plain; charset=utf-8",
      "retry-after": "60",
      "cache-control": "private, no-store",
    },
  });
}

// A pinned version's files never change, but its page lists every version of the
// bundle, so a new OTA has to show up on it too.
const PINNED_EDGE = "max-age=21600, stale-while-revalidate=86400";
// New OTA bundles appear within the hour. An ingest purges "latest" when it lands.
const LATEST_EDGE = "max-age=3600, stale-while-revalidate=86400";
// A missing bundle is usually a typo or a crawler, and the answer can change when
// Apple ships; long enough to absorb a hammering, short enough to heal.
const MISSING_EDGE = "max-age=60";
// Bundle members never change under a URL, but a browser holding one for a month
// outlives any mistake, so it keeps a day and the edge keeps the month.
const RAW_EDGE = "max-age=2592000";

// What browsers are told. "no-cache" is revalidate-before-use, not don't-store:
// a purge reaches people at once.
const REVALIDATE = "no-cache";
// Same intent for a file: hold it, but never let a shared cache we cannot purge
// keep a copy.
const RAW_BROWSER = "private, max-age=86400";
const PRIVATE = "private, no-store";

/** Responses that are the same for everyone, and what each cache should do. */
export type Policy = { browser: string; edge?: string; tags?: string[] };

/** Split out from the hook so it can be tested without a worker. */
export function cachePolicy(
  event: Pick<RequestEvent, "request" | "isRemoteRequest" | "params" | "locals" | "route">,
  status: number,
): Policy {
  const nothing = { browser: PRIVATE };
  if (event.request.method !== "GET" || event.isRemoteRequest) return nothing;
  // Something on the page looked at who was asking — the guesses on the lists.
  if (event.locals.perVisitor) return nothing;
  if (status >= 400 && status !== 404) return nothing;

  const tags = [event.params.version ? "pinned" : "latest"];
  if (event.params.name && event.params.platform) tags.push(`s-${event.params.platform}-${event.params.name}`);
  if (routeIn(BASEBAND_ROUTES, event.route.id)) tags.push("baseband");

  if (status === 404) return { browser: REVALIDATE, edge: MISSING_EDGE, tags };
  if (event.route.id === RAW) return { browser: RAW_BROWSER, edge: RAW_EDGE, tags };
  // A pinned version is a fixed bundle. Without one the page tracks "newest",
  // which moves whenever the manifest does.
  return { browser: REVALIDATE, edge: event.params.version ? PINNED_EDGE : LATEST_EDGE, tags };
}

/**
 * Remote responses are private, no-store by the framework, which is right for
 * everything that reads the visitor. A shared query reads nothing: it is the
 * same bytes for everybody and the client asks for it on most navigations.
 */
const SHARED: Policy = { browser: REVALIDATE, edge: LATEST_EDGE, tags: ["latest"] };

const shareable = (event: Pick<RequestEvent, "request" | "locals">, query: QueryPolicy | null, status: number) =>
  !!query?.shared && event.request.method === "GET" && status === 200 && !event.locals.perVisitor;

/** The index's redirect table, kept as long as its etag. */
async function legacyRoutes(): Promise<readonly LegacyRoute[]> {
  const tag = await etagOf(keys.legacy());
  return tag === null ? [] : cached(`legacy:${tag}`, 30 * 86400, async () => (await readJson(keys.legacy(), records.legacyRoutes)) ?? []);
}

/** v1 URLs answer before routing, so no route knows their shapes. Split out so it can be tested with a table. */
export async function legacyStep(url: URL, routes: () => Promise<readonly LegacyRoute[]>): Promise<Response | null> {
  if (!isLegacy(url.pathname)) return null;
  const a = answer(await routes(), url.pathname, url.search);
  if (!a) return null;
  if (a.status === 301) return new Response(null, { status: 301, headers: { location: a.location, "cache-control": REVALIDATE } });
  const html = (t: string): string => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const body = `<!doctype html><meta charset="utf-8"><title>Not found</title><p>${html(a.message)} <a href="${html(a.page)}">Its versions are here.</a></p>`;
  return new Response(body, { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": REVALIDATE } });
}

export const handle: Handle = async ({ event, resolve }) => {
  if (event.request.method === "GET") {
    const moved = await legacyStep(event.url, legacyRoutes);
    if (moved) return moved;
  }
  const query = remoteQuery(event);
  const limited = await overBudget(event, rateClass(event, query));
  if (limited) return limited;

  const response = await resolve(event);
  const policy = shareable(event, query, response.status)
    ? SHARED
    : response.headers.has("cache-control")
      ? null // already decided: a remote call that reads the visitor, or an error
      : cachePolicy(event, response.status);

  if (policy) {
    response.headers.set("cache-control", policy.browser);
    if (policy.edge) response.headers.set("cloudflare-cdn-cache-control", policy.edge);
    // What a purge can name later. A page pinned to a version holds a fixed
    // bundle; everything else tracks the newest one and goes stale on ingest.
    if (policy.tags?.length) response.headers.set("cache-tag", policy.tags.join(","));
  }
  return response;
};
