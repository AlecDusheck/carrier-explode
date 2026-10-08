/** Pixel and Galaxy modem configurations, decoded, and their band combinations: content-addressed, so never stale under their URL. */

import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { bandCombinationsSchema, modemConfigSchema } from "@carrier-explode/schema/records";
import { keys, readRecord, validRecord } from "@carrier-explode/storage";
import { fail, router, type ApiEnv } from "../context.ts";
import { combosSchema, modemConfigRecordSchema } from "../shapes.ts";
import { ERRORS, json, NO_QUERY } from "./common.ts";

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);

export const modems: OpenAPIHono<ApiEnv> = router();

modems.openapi(
	createRoute({
		method: "get",
		path: "/modem-configs/{sha}",
		operationId: "getModemConfig",
		tags: ["Modems"],
		summary: "A Pixel or Galaxy modem configuration, decoded: the SIMs it selects, its facts, items and base",
		request: {
			params: z.object({
				sha: SHA256.openapi({
					description: "A configuration's sha, as a build's, a device's or a carrier's modems name it.",
				}),
			}),
			query: NO_QUERY,
		},
		responses: { ...json(modemConfigRecordSchema, "The configuration."), ...ERRORS },
	}),
	async (c) => {
		const { sha } = c.req.valid("param");
		c.set("pinned", true);
		const raw: unknown = await (await c.env.BUCKET.get(keys.modemConfig(sha)))?.json();
		// norm/ holds versions' Profiles beside the configurations, and a Profile names its source.
		if (raw === undefined || (typeof raw === "object" && raw !== null && "source" in raw))
			throw fail(404, `No modem configuration ${sha}.`);
		return c.json(validRecord(keys.modemConfig(sha), modemConfigSchema, raw), 200);
	},
);

modems.openapi(
	createRoute({
		method: "get",
		path: "/combos/{key}",
		operationId: "getBandCombinations",
		tags: ["Modems"],
		summary: "A list of band combinations a modem configuration names",
		request: {
			params: z.object({ key: SHA256.openapi({ description: "A configuration's `combos[].key`." }) }),
			query: NO_QUERY,
		},
		responses: { ...json(combosSchema, "The band combinations."), ...ERRORS },
	}),
	async (c) => {
		const { key } = c.req.valid("param");
		c.set("pinned", true);
		const combos = await readRecord(c.env.BUCKET, keys.combos(key), bandCombinationsSchema);
		if (!combos) throw fail(404, `No band combinations ${key}.`);
		return c.json(combos, 200);
	},
);
