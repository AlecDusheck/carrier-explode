/**
 * Cache policy for whole responses. lib/server/cache.ts holds the pieces a page
 * is built from; this decides how long the built page itself may sit in front of
 * the worker.
 *
 * Workers Cache ("cache" in wrangler.jsonc) is the only thing that caches what a
 * worker returns — zone settings do not reach it — and the Cache-Control header
 * is its entire configuration surface. A hit is answered without running this
 * worker at all, so it costs no CPU, no R2 and no round trip to Apple. Anything
 * that leaves here without a header gets RFC 9111 heuristic freshness instead of
 * a decision, which is how an error page ends up cached, so everything gets one.
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

// s-maxage is what the shared cache holds; max-age=0 keeps browsers asking, so a
// new bundle or a purge reaches people as soon as the shared copy turns over.
const PINNED = "public, max-age=0, s-maxage=86400, stale-while-revalidate=2592000";
const LATEST = "public, max-age=0, s-maxage=600, stale-while-revalidate=86400";
const MISSING = "public, max-age=0, s-maxage=60";
const PRIVATE = "private, no-store";

/** Split out from the hook so it can be tested without a worker. */
export function cacheControl(
  event: Pick<RequestEvent, "request" | "isRemoteRequest" | "params" | "locals">,
  status: number,
): string {
  if (event.request.method !== "GET" || event.isRemoteRequest) return PRIVATE;
  // Something on the page looked at who was asking — the carrier guess on /carriers.
  if (event.locals.perVisitor) return PRIVATE;
  // A missing bundle is usually a typo or a crawler, and the answer can change
  // when Apple ships; long enough to absorb a hammering, short enough to heal.
  if (status === 404) return MISSING;
  if (status >= 400) return PRIVATE;
  // A pinned version is a fixed bundle. Without one the page tracks "newest",
  // which moves whenever the manifest does.
  return event.params.version ? PINNED : LATEST;
}

export const handle: Handle = async ({ event, resolve }) => {
  const limited = await overBudget(event);
  if (limited) return limited;

  const response = await resolve(event);
  // /raw sets its own, and remote calls are no-store already.
  if (!response.headers.has("cache-control")) {
    response.headers.set("cache-control", cacheControl(event, response.status));
  }
  return response;
};
