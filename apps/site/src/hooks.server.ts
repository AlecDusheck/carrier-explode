/** Every request: per-IP budgets, then v1 redirects, then the cache policy on the way out. */

import { env } from "cloudflare:workers";
import type { Handle, HandleServerError } from "@sveltejs/kit/hooks";
import { applyPolicy, movedPolicy, responsePolicy } from "#lib/server/cache-policy.ts";
import { legacyRoutes, legacyStep } from "#lib/server/legacy.ts";
import { overBudget, rateClass, remoteQuery } from "#lib/server/rate.ts";

export const handleError: HandleServerError = ({ kind, event }) => (kind === "framework" ? event.locals.moved : undefined);

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.sources = new Set();
  const query = remoteQuery(event);
  const limited = await overBudget(event, rateClass(event, query));
  if (limited) return limited;
  if (event.request.method === "GET") {
    const moved = await legacyStep(event, legacyRoutes);
    if (moved) {
      applyPolicy(moved, movedPolicy(env.CACHE_TTL));
      return moved;
    }
  }

  const response = await resolve(event);
  const policy = responsePolicy(event, response, env.CACHE_TTL);
  if (policy) applyPolicy(response, policy);
  return response;
};
