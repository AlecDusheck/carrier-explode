/** PURGE_PATH: drops cached answers so a publish shows at once. Called by the extractor with the token the site holds too. */

import { cache } from "cloudflare:workers";
import { Hono } from "hono";
import { PURGE_PATH, purgeCache, purgeRefusal } from "@carrier-explode/storage";
import { errorBody, type ApiEnv } from "./context.ts";

export const purge: Hono<ApiEnv> = new Hono<ApiEnv>().post(PURGE_PATH, async (c) => {
	const refused = purgeRefusal(c.req.header("authorization"), c.env.PURGE_TOKEN);
	if (refused !== null) return c.json(errorBody(401, refused), 401);
	const failure = await purgeCache(cache);
	if (failure !== null) return c.json(errorBody(502, failure), 502);
	return c.body(null, 204);
});
