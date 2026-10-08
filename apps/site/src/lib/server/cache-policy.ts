/** Whole-response cache policy: storage's shared headers, by route, status and what the response read. */

import type { RequestEvent } from "@sveltejs/kit";
import type { RouteId } from "$app/types";
import * as v from "valibot";
import { NOT_CACHED, REVALIDATE, revalidating, type CachePolicy } from "@carrier-explode/storage";

/** A bundle member as-is. */
const RAW: RouteId =
	"/raw/[platform=appleplatform]/[kind=kind]/[name]/[[line=line]]/[version=version]/[...path]";

/** Seconds per kind of response: wrangler.jsonc vars.CACHE_TTL. */
export type CacheTtl = { readonly [K in keyof Env["CACHE_TTL"]]: number };

/** Usually a typo or a stale link, and the answer changes when an ingest lands: kept briefly. */
const missing = (ttl: CacheTtl): CachePolicy => ({ browser: REVALIDATE, edge: `max-age=${ttl.missing}` });

export function cachePolicy(
	event: Pick<RequestEvent, "request" | "isRemoteRequest" | "params" | "locals" | "route">,
	status: number,
	ttl: CacheTtl,
): CachePolicy {
	if (event.request.method !== "GET" || event.isRemoteRequest) return NOT_CACHED;
	// Something on the page read the visitor (the guesses on the lists).
	if (event.locals.perVisitor) return NOT_CACHED;
	if (status >= 400 && status !== 404) return NOT_CACHED;

	if (status === 404) return missing(ttl);
	// A file is held by the browser, never by a shared cache a purge cannot reach.
	if (event.route.id === RAW)
		return { browser: `private, max-age=${ttl.rawBrowser}`, edge: `max-age=${ttl.raw}` };
	// A pinned version is a fixed bundle. Without one the page tracks "newest",
	// which moves whenever the manifest does.
	return {
		browser: REVALIDATE,
		edge: revalidating(event.params.version ? ttl.pinned : ttl.latest, ttl.staleWhileRevalidate),
	};
}

/** A remote query's answer: SvelteKit sends a failure as a 200 too, naming its status in the body. */
const remoteAnswer = v.variant("type", [
	v.object({ type: v.literal("result") }),
	v.object({ type: v.literal("error"), error: v.object({ status: v.number() }) }),
]);

/** The status a remote response stands for. */
const remoteStatus = async (response: Response): Promise<number> => {
	if (response.status !== 200) return response.status;
	const answer = v.parse(remoteAnswer, await response.clone().json());
	return answer.type === "result" ? 200 : answer.error.status;
};

/**
 * The policy to stamp on a response, or null to leave the framework's. A remote query's answer is the same for everybody
 * unless it read the visitor, so the edge keeps it, and a missing one briefly, as a page's; the framework marks remote
 * responses private, no-store otherwise.
 */
export async function responsePolicy(
	event: Pick<RequestEvent, "request" | "isRemoteRequest" | "params" | "locals" | "route">,
	response: Response,
	ttl: CacheTtl,
): Promise<CachePolicy | null> {
	if (event.isRemoteRequest) {
		if (event.request.method !== "GET" || event.locals.perVisitor) return null;
		switch (await remoteStatus(response)) {
			case 200:
				return { browser: REVALIDATE, edge: revalidating(ttl.latest, ttl.staleWhileRevalidate) };
			case 404:
				return missing(ttl);
			default:
				return null;
		}
	}
	return response.headers.has("cache-control") ? null : cachePolicy(event, response.status, ttl);
}
