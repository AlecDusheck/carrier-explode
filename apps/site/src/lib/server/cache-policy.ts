/**
 * Whole-response cache policy. The edge cache is Workers Cache, addressed through
 * cloudflare-cdn-cache-control so Cache-Control speaks only to browsers. Edge TTLs use max-age:
 * s-maxage would disable stale-while-revalidate.
 */

import type { RequestEvent } from "@sveltejs/kit";
import type { RouteId } from "$app/types";
import type { SourceKey } from "@carrier-explode/schema/types";
import { INDEX_TAG } from "@carrier-explode/storage";

/** A bundle member as-is. */
export const RAW: RouteId = "/raw/[platform=appleplatform]/[kind=kind]/[name]/[[line=line]]/[version=version]/[...path]";

/** Seconds per kind of response: wrangler.jsonc vars.CACHE_TTL. */
export type CacheTtl = { readonly [K in keyof Env["CACHE_TTL"]]: number };

const revalidating = (seconds: number, ttl: CacheTtl): string => `max-age=${seconds}, stale-while-revalidate=${ttl.staleWhileRevalidate}`;

// What browsers are told. "no-cache" is revalidate-before-use, not don't-store:
// a purge reaches people at once.
export const REVALIDATE = "no-cache";
const PRIVATE = "private, no-store";

/** Responses that are the same for everyone, and what each cache should do. */
export type Policy = { readonly browser: string; readonly edge?: string; readonly tags?: readonly string[] };

/**
 * A response's cache tags: each source it read, by key, which a publish that changes the source purges; and `index` for
 * what depends on the index as a whole. Pages show the lists, so every page is tagged `index`.
 */
const tagsOf = (sources: ReadonlySet<SourceKey>, page: boolean): string[] => [...(page || sources.size === 0 ? [INDEX_TAG] : []), ...sources];

export function cachePolicy(
  event: Pick<RequestEvent, "request" | "isRemoteRequest" | "params" | "locals" | "route">,
  status: number,
  ttl: CacheTtl,
): Policy {
  const nothing = { browser: PRIVATE };
  if (event.request.method !== "GET" || event.isRemoteRequest) return nothing;
  // Something on the page read the visitor (the guesses on the lists).
  if (event.locals.perVisitor) return nothing;
  if (status >= 400 && status !== 404) return nothing;

  const tags = tagsOf(event.locals.sources, true);

  if (status === 404) return { browser: REVALIDATE, edge: `max-age=${ttl.missing}`, tags };
  // A file is held by the browser, never by a shared cache a purge cannot reach.
  if (event.route.id === RAW) return { browser: `private, max-age=${ttl.rawBrowser}`, edge: `max-age=${ttl.raw}`, tags };
  // A pinned version is a fixed bundle. Without one the page tracks "newest",
  // which moves whenever the manifest does.
  return { browser: REVALIDATE, edge: revalidating(event.params.version ? ttl.pinned : ttl.latest, ttl), tags };
}

/** A v1 URL's 301: the same for everybody until a publish changes the redirect table. */
export const movedPolicy = (ttl: CacheTtl): Policy => ({ browser: REVALIDATE, edge: revalidating(ttl.latest, ttl), tags: [INDEX_TAG] });

/**
 * The policy to stamp on a response, or null to leave the framework's. A remote query's answer is the same for everybody
 * unless it read the visitor, so the edge keeps it; the framework marks remote responses private, no-store otherwise.
 */
export function responsePolicy(
  event: Pick<RequestEvent, "request" | "isRemoteRequest" | "params" | "locals" | "route">,
  response: Response,
  ttl: CacheTtl,
): Policy | null {
  if (event.isRemoteRequest) {
    return event.request.method === "GET" && response.status === 200 && !event.locals.perVisitor
      ? { browser: REVALIDATE, edge: revalidating(ttl.latest, ttl), tags: tagsOf(event.locals.sources, false) }
      : null;
  }
  return response.headers.has("cache-control") ? null : cachePolicy(event, response.status, ttl);
}

/** Writes a policy's headers. A cache tag is what a purge can name later. */
export function applyPolicy(response: Response, policy: Policy): void {
  response.headers.set("cache-control", policy.browser);
  if (policy.edge) response.headers.set("cloudflare-cdn-cache-control", policy.edge);
  if (policy.tags?.length) response.headers.set("cache-tag", policy.tags.join(","));
}
