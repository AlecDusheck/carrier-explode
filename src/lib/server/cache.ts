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
import { bytesToHex } from "$lib/decode";

/**
 * JSON built by `fn`, kept in the colo cache for `ttlSeconds` when `keep`
 * allows. By default a null/undefined result is never stored: it usually
 * means "not reachable yet".
 */
export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>, keep: (v: T) => boolean = (v) => v != null): Promise<T> {
  const { platform } = getRequestEvent();
  const cache = platform?.caches?.default;
  if (!platform || !cache) return fn();
  const req = new Request(`https://cache.carrier-explode/${encodeURIComponent(key)}`);
  const hit = await cache.match(req);
  if (hit) return hit.json<T>();
  const value = await fn();
  if (keep(value)) {
    const res = new Response(JSON.stringify(value), {
      headers: { "content-type": "application/json", "cache-control": `public, s-maxage=${ttlSeconds}` },
    });
    platform.ctx.waitUntil(cache.put(req, res).catch(() => {}));
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

/** Fetch from Apple. Old manifest entries are HTTP-only and some hosts have dropped HTTP, so try both. */
export async function fetchApple(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const u = new URL(url);
  if (!APPLE.test(u.hostname)) error(400, `host not allowed: ${u.hostname}`);
  const alt = new URL(u);
  alt.protocol = u.protocol === "https:" ? "http:" : "https:";
  let last = "";
  for (const target of [u, alt]) {
    try {
      const res = await fetch(target, {
        cf: { cacheTtl: 30 * 86400, cacheEverything: true },
        headers: { "user-agent": "carrier-explode/1.0" },
      });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  error(502, `Apple returned ${last} for ${u.hostname}`);
}

export async function digestHex(algorithm: "SHA-1" | "SHA-384", bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest(algorithm, bytes)));
}
