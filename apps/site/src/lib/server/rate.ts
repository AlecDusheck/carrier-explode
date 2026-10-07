/** Per-IP budgets by the work a request can start; per location and eventually consistent, so ceilings, not accounting. Cache hits never count. */

import { env } from "cloudflare:workers";
import type { RequestEvent } from "@sveltejs/kit";
import type { RouteId } from "$app/types";
import { QUERIES, isQueryName, type QueryPolicy, type RateClass } from "#lib/api/policy.ts";
import { NO_STORE, overLimit, RATE_LIMITED } from "@carrier-explode/storage";
import { RAW } from "./cache-policy";

const BUDGET = {
	scan: "RL_SCAN",
	diff: "RL_DIFF",
	bundle: "RL_BUNDLE",
	base: "RL_BASE",
} as const satisfies Record<RateClass, keyof Env>;

/** Pages that open an artifact whether or not they name a version: a member as-is, and a diff. */
const BUNDLE_ROUTES: ReadonlySet<RouteId> = new Set<RouteId>([RAW, "/compare"]);

/**
 * The policy of the remote query a request calls, or null for a page. A remote call's `event.url` is its page,
 * so the name comes off the request: /_app/remote/<hash>/<name>.
 */
export function remoteQuery(event: Pick<RequestEvent, "request" | "isRemoteRequest">): QueryPolicy | null {
	if (!event.isRemoteRequest) return null;
	const name = new URL(event.request.url).pathname.split("/remote/")[1]?.split("/")[1] ?? "";
	return isQueryName(name) ? QUERIES[name] : { rate: "base" };
}

export function rateClass(
	event: Pick<RequestEvent, "route" | "params">,
	query: QueryPolicy | null,
): RateClass {
	if (query) return query.rate;
	// Every other bundle page is pinned to a version.
	return (event.route.id !== null && BUNDLE_ROUTES.has(event.route.id)) || event.params.version
		? "bundle"
		: "base";
}

/** A 429, or null to let the request through. */
export async function overBudget(event: RequestEvent, rate: RateClass): Promise<Response | null> {
	if (!(await overLimit(env[BUDGET[rate]], event.request.headers.get("cf-connecting-ip")))) return null;
	// The remote client parses this shape off a failed response and throws it
	// into the pane's boundary; anything else there surfaces as a parse error.
	const body = event.isRemoteRequest
		? JSON.stringify({ type: "error", status: 429, error: { message: RATE_LIMITED } })
		: RATE_LIMITED + "\n";
	return new Response(body, {
		status: 429,
		headers: {
			"content-type": event.isRemoteRequest ? "application/json" : "text/plain; charset=utf-8",
			"retry-after": "60",
			"cache-control": NO_STORE,
		},
	});
}
