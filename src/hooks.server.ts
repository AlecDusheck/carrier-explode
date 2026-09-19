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
  const response = await resolve(event);
  // /raw sets its own, and remote calls are no-store already.
  if (!response.headers.has("cache-control")) {
    response.headers.set("cache-control", cacheControl(event, response.status));
  }
  return response;
};
