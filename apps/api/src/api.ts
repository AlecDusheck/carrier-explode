/** The public API: /v1's routes, their OpenAPI document at /openapi.json, and a docs page at /. */

import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { etag } from "hono/etag";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { indexDb } from "@carrier-explode/db";
import { caching } from "./cache.ts";
import { errorBody, errorStatus, type ApiEnv } from "./context.ts";
import { canonical } from "./page.ts";
import { builds } from "./routes/builds.ts";
import { carriers } from "./routes/carriers.ts";
import { catalog } from "./routes/catalog.ts";
import { compare } from "./routes/compare.ts";
import { devices } from "./routes/devices.ts";
import { features } from "./routes/features.ts";
import { modems } from "./routes/modems.ts";
import { sims } from "./routes/sims.ts";
import { sources } from "./routes/sources.ts";
import { RECORD_SCHEMAS } from "./shapes.ts";

const DESCRIPTION = `Every carrier settings file Apple, Google and Samsung ship, decoded: the index and records carrierexplode.com reads, as JSON.

- Decoded data only: settings, profiles and modem configurations as the decoders read them, never the files themselves.
- Start at \`/v1\`: every collection, with an example. Carriers link one carrier's sources across platforms; each platform's own model (sources, versions, builds, modems) lives under \`/v1/{platform}\`.
- Lists come a page at a time: follow \`next.url\`, or pass \`next.cursor\` as \`cursor\`. A query has one spelling; any other redirects to it.
- Errors are \`{ error: { status, code, message } }\`.
- Answers are cached at the edge until the index changes them. \`latest\` follows a line's newest version; a version slug never changes.
- No key, but send a User-Agent that names your project and a contact, e.g. \`myproject/1.0 (+https://example.com; me@example.com)\`: a bare library default such as \`curl/8.7.1\` gets 403.
- Each IP may make 300 uncached requests in 10 seconds, counted with carrierexplode.com's; past that, Cloudflare answers 429 for 10 seconds.`;

/** One D1 session per request: reads go to the nearest replica and stay in order within the request. */
const session = createMiddleware<ApiEnv>(async (c, next) => {
	c.set("db", indexDb(c.env.DB.withSession()));
	await next();
});

/** The API is data for programs, not pages to list in search results. */
const noindex = createMiddleware<ApiEnv>(async (c, next) => {
	await next();
	c.header("X-Robots-Tag", "noindex");
});

const READ_ONLY = cors({ origin: "*", allowMethods: ["GET", "HEAD", "OPTIONS"] });

export const api: OpenAPIHono<ApiEnv> = new OpenAPIHono<ApiEnv>();

api.use("*", noindex, caching, etag(), canonical, session);
api.use("/v1/*", READ_ONLY);
api.use("/openapi.json", READ_ONLY);

// Static segments before the parameters that would also match them: /v1/carriers is not a platform, /v1/ios/builds not a kind.
for (const routes of [catalog, carriers, features, devices, sims, compare, modems, builds, sources])
	api.route("/v1", routes);

api.get("/openapi.json", (c) => {
	const doc = api.getOpenAPI31Document({
		openapi: "3.1.0",
		info: { title: "carrier-explode API", version: "1", description: DESCRIPTION },
		servers: [{ url: new URL(c.req.url).origin }],
		// No key: every operation is open.
		security: [],
	});
	return c.json({
		...doc,
		components: {
			...doc.components,
			schemas: { ...doc.components?.schemas, ...Object.fromEntries(RECORD_SCHEMAS) },
		},
	});
});
api.get("/", swaggerUI({ url: "/openapi.json", title: "carrier-explode API" }));

api.notFound((c) => c.json(errorBody(404, "No such route: /v1 and /openapi.json list them."), 404));
api.onError((e, c) => {
	if (e instanceof HTTPException) {
		const status = errorStatus(e.status);
		return c.json(errorBody(status, e.message), status);
	}
	console.error(e);
	return c.json(errorBody(500, e.message), 500);
});
