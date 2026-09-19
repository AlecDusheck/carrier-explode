/**
 * Cache policy for whole responses. lib/server/cache.ts holds the pieces a page
 * is built from; this decides how long the built page itself may sit in front of
 * the worker.
 *
 * Two caches sit there, not one. Workers Cache ("cache" in wrangler.jsonc) is
 * keyed by worker version and can be purged by tag. The Cloudflare adapter also
 * wraps the worker in its own Cache API layer, and that one is keyed by URL
 * alone: it outlives deploys, ignores ctx.cache.purge(), and once it has a page
 * it will serve that page's markup long after the scripts it references have
 * been replaced. It stores anything whose Cache-Control lacks private, no-cache
 * or no-store, so everything shareable here is addressed to the edge through
 * cloudflare-cdn-cache-control — highest precedence, consumed by Cloudflare,
 * stripped before the client — while Cache-Control speaks only to browsers and
 * keeps that second cache out of the way.
 *
 * The edge TTL uses max-age rather than s-maxage on purpose: s-maxage disables
 * stale-while-revalidate, which would make every expiry block on a fresh render.
 */

import type { Handle, RequestEvent } from "@sveltejs/kit";

/**
 * Per-IP budgets, sized to the work a request can start rather than to the
 * request itself. Counters live in the Cloudflare location that served the
 * request and are eventually consistent, so these are ceilings on hammering
 * from one source, not an accounting system. A cache hit never reaches the
 * worker, so only the misses — the expensive ones — are counted.
 */
const BUDGET = {
  // One scan opens up to 120 bundles, and its cache key is built from
  // client-supplied strings, so a miss costs nothing to manufacture. The dialog
  // fires once when it opens and once per scope or limit change; ten a minute
  // is a fidgety human and a tenth of what a script would want.
  scan: "RL_SCAN",
  // Two opens per call and nothing cached at the data layer, but one call per
  // file the visitor picks.
  diff: "RL_DIFF",
  // Everything that can pull and unzip an .ipcc: /raw, the bundle queries, and
  // a page pinned to a version. The assets gallery fires one /raw per image, so
  // this has to hold a page view plus its burst.
  bundle: "RL_BUNDLE",
  // Pages and the memoised tables. Cheap, but /carriers is no-store and so runs
  // the worker every time.
  base: "RL_BASE",
} as const;

/** Split out from the hook so it can be tested without a worker. */
export function rateClass(
  event: Pick<RequestEvent, "request" | "route" | "params" | "isRemoteRequest">,
): keyof typeof BUDGET {
  if (event.isRemoteRequest) {
    // For a remote call `event.url` is the page it came from, so the function
    // name has to come off the request: /_app/remote/<hash>/<name>.
    const name = new URL(event.request.url).pathname.split("/remote/")[1]?.split("/")[1];
    if (name === "scanKey") return "scan";
    if (name === "getDiff") return "diff";
    return name === "getBundle" || name === "getFile" || name === "getChanges" ? "bundle" : "base";
  }
  // /compare renders a diff, and every other bundle page is pinned to a version.
  if (event.route.id?.startsWith("/raw/") || event.route.id === "/compare") return "bundle";
  return event.params.version ? "bundle" : "base";
}

/** A 429, or null to let the request through. Missing binding or IP fails open. */
async function overBudget(event: RequestEvent): Promise<Response | null> {
  const ip = event.request.headers.get("cf-connecting-ip");
  const limiter = ip ? event.platform?.env[BUDGET[rateClass(event)]] : undefined;
  if (!limiter || (await limiter.limit({ key: ip! })).success) return null;

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

const PINNED_EDGE = "max-age=86400, stale-while-revalidate=2592000";
// Six hours matches the manifest memo in lib/server/data.ts: a shorter page TTL
// buys freshness the data behind it does not have, and a longer one outlives it.
// An ingest purges "latest" when it lands, which is what actually cuts it short.
const LATEST_EDGE = "max-age=21600, stale-while-revalidate=86400";
// A missing bundle is usually a typo or a crawler, and the answer can change when
// Apple ships; long enough to absorb a hammering, short enough to heal.
const MISSING_EDGE = "max-age=60";
// Bundle members never change under a URL, but a browser holding one for a month
// outlives any mistake, so it keeps a day and the edge keeps the month.
const RAW_EDGE = "max-age=2592000";

// What browsers are told. "no-cache" is revalidate-before-use, not don't-store:
// a purge reaches people at once, and the adapter's Cache API layer skips it.
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
  if (event.params.name) tags.push(`b-${event.params.name}`);

  if (status === 404) return { browser: REVALIDATE, edge: MISSING_EDGE, tags };
  if (event.route.id?.startsWith("/raw/")) return { browser: RAW_BROWSER, edge: RAW_EDGE, tags };
  // A pinned version is a fixed bundle. Without one the page tracks "newest",
  // which moves whenever the manifest does.
  return { browser: REVALIDATE, edge: event.params.version ? PINNED_EDGE : LATEST_EDGE, tags };
}

/**
 * Remote responses are private, no-store by the framework, which is right for
 * everything that reads the visitor. These two read nothing: they are the same
 * bytes for everybody and the client asks for them on most navigations.
 */
const SHARED_QUERIES = new Set(["getIndex", "getStats"]);

function sharedQuery(event: Pick<RequestEvent, "request" | "isRemoteRequest" | "locals">, status: number): boolean {
  if (!event.isRemoteRequest || event.request.method !== "GET" || status !== 200) return false;
  if (event.locals.perVisitor) return false;
  const name = new URL(event.request.url).pathname.split("/remote/")[1]?.split("/")[1];
  return !!name && SHARED_QUERIES.has(name);
}

export const handle: Handle = async ({ event, resolve }) => {
  const limited = await overBudget(event);
  if (limited) return limited;

  const response = await resolve(event);
  const policy = sharedQuery(event, response.status)
    ? { browser: REVALIDATE, edge: LATEST_EDGE, tags: ["latest"] }
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
