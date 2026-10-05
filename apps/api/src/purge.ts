/** PURGE_PATH: drops cached answers so a publish shows at once. Called by the extractor with the token the site holds too. */

import { cache } from "cloudflare:workers";
import { Hono } from "hono";
import * as v from "valibot";
import { PURGE_PATH, purgeRequestSchema } from "@carrier-explode/storage";
import { errorBody, type ApiEnv } from "./context.ts";

export const purge: Hono<ApiEnv> = new Hono<ApiEnv>().post(PURGE_PATH, async (c) => {
  if (!c.env.PURGE_TOKEN || c.req.header("authorization") !== `Bearer ${c.env.PURGE_TOKEN}`) return c.json(errorBody(401, "bad or missing purge token"), 401);
  const parsed = v.safeParse(purgeRequestSchema, await c.req.json<unknown>().catch(() => null));
  if (!parsed.success) return c.json(errorBody(400, v.summarize(parsed.issues)), 400);
  const result = await cache.purge(parsed.output.purge === "tags" ? { tags: parsed.output.tags } : { purgeEverything: true });
  if (!result.success) return c.json(errorBody(502, result.errors.map((e) => e.message).join("; ") || "purge failed"), 502);
  return c.json(parsed.output, 200);
});
