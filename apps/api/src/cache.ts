/** Whole-response cache policy, the API's: storage's shared headers; every cached answer carries INDEX_TAG. */

import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import {
	applyPolicy,
	NOT_CACHED,
	REVALIDATE,
	revalidating,
	type CachePolicy,
} from "@carrier-explode/storage";
import type { ApiEnv } from "./context.ts";

/** Seconds per kind of response: wrangler.jsonc vars.CACHE_TTL. */
type CacheTtl = { readonly [K in keyof Env["CACHE_TTL"]]: number };

function cachePolicy(method: string, status: number, pinned: boolean, ttl: CacheTtl): CachePolicy {
	if (method !== "GET") return NOT_CACHED;
	// Usually a typo or a crawler, and the answer changes when a publish adds it: absorbs a hammering, heals quickly.
	if (status === 404) return { browser: REVALIDATE, edge: `max-age=${ttl.missing}` };
	if (status >= 400 || status < 200) return NOT_CACHED;
	// A redirect to the canonical URL never changes; a 304 is its 200.
	const seconds = pinned || (status >= 300 && status !== 304) ? ttl.pinned : ttl.latest;
	return { browser: REVALIDATE, edge: revalidating(seconds, ttl.staleWhileRevalidate) };
}

/** Stamps the policy on every response that has not set its own. */
export const caching: MiddlewareHandler<ApiEnv> = createMiddleware<ApiEnv>(async (c, next) => {
	c.set("pinned", false);
	await next();
	if (c.res.headers.has("cache-control")) return;
	applyPolicy(c.res.headers, cachePolicy(c.req.method, c.res.status, c.var.pinned, c.env.CACHE_TTL));
});
