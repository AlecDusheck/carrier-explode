/** Per-IP budgets in the site's namespaces, so one client's budget covers both. Cache hits never run the worker, so never count. */

import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { NO_STORE, overLimit, RATE_LIMITED } from "@carrier-explode/storage";
import { errorBody, type ApiEnv } from "./context.ts";

/** `base`: index reads. `bundle`: a decoded record read from the bucket. */
export const BUDGET = {
	base: "RL_BASE",
	bundle: "RL_BUNDLE",
} as const satisfies Record<string, keyof Env>;

export type RateClass = keyof typeof BUDGET;

/** A 429 past the budget; a request without an IP fails open. */
export const budget = (rate: RateClass): MiddlewareHandler<ApiEnv> =>
	createMiddleware<ApiEnv>(async (c, next) => {
		if (await overLimit(c.env[BUDGET[rate]], c.req.header("cf-connecting-ip"))) {
			return c.json(errorBody(429, RATE_LIMITED), 429, { "retry-after": "60", "cache-control": NO_STORE });
		}
		return next();
	});
