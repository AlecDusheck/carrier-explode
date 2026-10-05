/**
 * Whole-response cache policy, the site's: the edge cache is Workers Cache, addressed through cloudflare-cdn-cache-control
 * so Cache-Control speaks only to browsers, and a publish purges by the same tags. Edge TTLs use max-age: s-maxage would
 * disable stale-while-revalidate.
 */

import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { INDEX_TAG } from "@carrier-explode/storage";
import type { SourceKey } from "@carrier-explode/schema/types";
import type { ApiEnv } from "./context.ts";

/** Seconds per kind of response: wrangler.jsonc vars.CACHE_TTL. */
export type CacheTtl = { readonly [K in keyof Env["CACHE_TTL"]]: number };

/** What a response read: the sources it is tagged with, and whether its URL names a fixed version. */
export interface Read {
  readonly sources: ReadonlySet<SourceKey>;
  readonly pinned: boolean;
}

export interface Policy {
  readonly browser: string;
  readonly edge?: string;
  readonly tags?: readonly string[];
}

/** Browsers revalidate every time, so a purge reaches them at once; the edge answers that revalidation. */
const REVALIDATE = "no-cache";
const NOTHING: Policy = { browser: "private, no-store" };

/**
 * A response that read sources is purged by their keys. One pinned without any is content-addressed (a record by its hash,
 * a redirect), so only a purge of everything drops it; anything else depends on the index as a whole.
 */
function tagsOf({ sources, pinned }: Read): readonly string[] {
  if (sources.size > 0) return [...sources];
  return pinned ? [] : [INDEX_TAG];
}

export function cachePolicy(method: string, status: number, read: Read, ttl: CacheTtl): Policy {
  if (method !== "GET") return NOTHING;
  const tags = tagsOf(read);
  // Usually a typo or a crawler, and the answer changes when a publish adds it: absorbs a hammering, heals quickly.
  if (status === 404) return { browser: REVALIDATE, edge: `max-age=${ttl.missing}`, tags };
  if (status >= 400 || status < 200) return NOTHING;
  // A redirect to the canonical URL never changes; a 304 is its 200.
  const seconds = read.pinned || (status >= 300 && status !== 304) ? ttl.pinned : ttl.latest;
  return { browser: REVALIDATE, edge: `max-age=${seconds}, stale-while-revalidate=${ttl.staleWhileRevalidate}`, tags };
}

export function applyPolicy(headers: Headers, policy: Policy): void {
  headers.set("cache-control", policy.browser);
  if (policy.edge) headers.set("cloudflare-cdn-cache-control", policy.edge);
  if (policy.tags?.length) headers.set("cache-tag", policy.tags.join(","));
}

/** Stamps the policy on every response that has not set its own. */
export const caching: MiddlewareHandler<ApiEnv> = createMiddleware<ApiEnv>(async (c, next) => {
  c.set("sources", new Set());
  c.set("pinned", false);
  await next();
  if (c.res.headers.has("cache-control")) return;
  applyPolicy(c.res.headers, cachePolicy(c.req.method, c.res.status, { sources: c.var.sources, pinned: c.var.pinned }, c.env.CACHE_TTL));
});
