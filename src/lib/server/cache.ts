/**
 * Nothing is kept in the isolate: whole pages are cached at the edge
 * (hooks.server.ts). What sits behind them is the colo's Cache API, for derived
 * JSON that is expensive to build, and a request scope, for work several
 * queries of one page share. The Cache API is a no-op on *.workers.dev, which
 * is why the deployment sits on a custom domain. Upstream .ipcc fetches also
 * set cf.cacheTtl so Apple is hit once per file.
 */

import { error } from "@sveltejs/kit";
import { getRequestEvent } from "$app/server";
import { waitUntil } from "cloudflare:workers";
import { HttpError, fetchWithRetry, withSchemeFallback } from "#lib/http/index.ts";

/**
 * JSON built by `fn`, kept in the colo cache for `ttlSeconds` when `keep`
 * allows. By default a null/undefined result is never stored: it usually
 * means "not reachable yet". A hit is read back unvalidated: only this
 * function writes the cache, from a value of the same `T` under the same key.
 */
export async function cached<T>(
  key: string, ttlSeconds: number, fn: () => Promise<T>, keep: (v: T) => boolean = (v) => v !== null && v !== undefined,
): Promise<T> {
  const cache = await caches.open("derived");
  const req = new Request(`https://cache.carrier-explode/${encodeURIComponent(key)}`);
  const hit = await cache.match(req);
  if (hit) return hit.json<T>();
  const value = await fn();
  if (keep(value)) {
    const res = new Response(JSON.stringify(value), {
      headers: { "content-type": "application/json", "cache-control": `public, s-maxage=${ttlSeconds}` },
    });
    // A failed write costs the next request a rebuild and nothing else, so it is not worth failing this one.
    waitUntil(cache.put(req, res).catch(() => undefined));
  }
  return value;
}

/**
 * `fn` at most once per request for each set of arguments: every query a page
 * renders shares the first call's promise. Scopes are keyed by the request's
 * `locals`, which remote calls share with their page, so they live and die
 * with the request.
 */
export function perRequest<A extends string[], T>(fn: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
  const scopes = new WeakMap<App.Locals, Map<string, Promise<T>>>();
  return (...args) => {
    const { locals } = getRequestEvent();
    let scope = scopes.get(locals);
    if (!scope) scopes.set(locals, (scope = new Map()));
    const key = args.join("\0");
    let p = scope.get(key);
    if (!p) scope.set(key, (p = fn(...args)));
    return p;
  };
}

// updates.cdn-apple.com, appldnld.apple.com, and the 2008-era appldnld.apple.com.edgesuite.net
const APPLE = /(^|\.)(cdn-)?apple\.com(\.edgesuite\.net)?$/;

/**
 * An iOS OTA file the extractor has not archived yet, straight from Apple. The
 * host allow-list is the site's: the URL comes from an index entry, but nothing
 * else may make the worker fetch for it. Old entries are http-only and some
 * hosts have dropped http, so both schemes are tried.
 */
export async function fetchApple(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const u = new URL(url);
  if (!APPLE.test(u.hostname)) error(400, `host not allowed: ${u.hostname}`);
  try {
    return new Uint8Array(await withSchemeFallback(u, (target) =>
      fetchWithRetry(target, { cf: { cacheTtl: 30 * 86400, cacheEverything: true } }).then((r) => r.arrayBuffer())));
  } catch (e) {
    error(502, `Apple did not serve ${u.hostname}${u.pathname}: ${failure(e)}`);
  }
}

/** What went wrong, in a line: an HTTP status, or the network error, for each scheme tried. */
function failure(e: unknown): string {
  if (e instanceof AggregateError) return e.errors.map(failure).join("; ");
  if (e instanceof HttpError) return `HTTP ${e.status}`;
  return e instanceof Error ? e.message : String(e);
}
