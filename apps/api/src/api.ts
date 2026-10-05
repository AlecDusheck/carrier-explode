/** The public API: /v1's routes, their OpenAPI document at /openapi.json, and a docs page at /. */

import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { etag } from "hono/etag";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { indexDb } from "@carrier-explode/db/d1";
import { caching } from "./cache.ts";
import { errorBody, type ApiEnv } from "./context.ts";
import { canonical } from "./page.ts";
import { budget } from "./rate.ts";
import { builds } from "./routes/builds.ts";
import { catalog } from "./routes/catalog.ts";
import { modems } from "./routes/modems.ts";
import { phones } from "./routes/phones.ts";
import { sources } from "./routes/sources.ts";
import { RECORD_SCHEMAS } from "./shapes.ts";

const DESCRIPTION = `Every carrier settings file Apple and Google ship, decoded: the index and records carrierexplode.com reads, as JSON.

- Decoded data only: settings, profiles and modem configurations as the decoders read them, never the files themselves.
- Lists come a page at a time: follow \`next.url\`, or pass \`next.cursor\` as \`cursor\`. A query has one spelling; any other redirects to it.
- Answers are cached at the edge until the next index is published. \`latest\` follows a line's newest version; a version slug never changes.
- No key. Each IP has a budget per minute, shared with carrierexplode.com; past it, a 429 says when to retry.`;

/** One D1 session per request: reads go to the nearest replica and stay in order within the request. */
const session = createMiddleware<ApiEnv>(async (c, next) => {
  c.set("db", indexDb(c.env.DB.withSession()));
  await next();
});

const READ_ONLY = cors({ origin: "*", allowMethods: ["GET", "HEAD", "OPTIONS"] });

export const api: OpenAPIHono<ApiEnv> = new OpenAPIHono<ApiEnv>();

api.use("*", caching, etag(), canonical, session);
api.use("/v1/*", READ_ONLY);
api.use("/openapi.json", READ_ONLY, budget("base"));
api.use("/", budget("base"));

// Static segments before the parameters that would also match them: /v1/ios/builds is a build list, not a source kind.
for (const routes of [catalog, modems, builds, phones, sources]) api.route("/v1", routes);

api.get("/openapi.json", (c) => {
  const doc = api.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "carrier-explode API", version: "1", description: DESCRIPTION },
    servers: [{ url: new URL(c.req.url).origin }],
    // No key: every operation is open.
    security: [],
  });
  return c.json({ ...doc, components: { ...doc.components, schemas: { ...doc.components?.schemas, ...Object.fromEntries(RECORD_SCHEMAS) } } });
});
api.get("/", swaggerUI({ url: "/openapi.json", title: "carrier-explode API" }));

api.notFound((c) => c.json(errorBody(404, "No such route: /openapi.json lists them."), 404));
api.onError((e, c) => {
  if (e instanceof HTTPException) return c.json(errorBody(e.status, e.message), e.status);
  console.error(e);
  return c.json(errorBody(500, e.message), 500);
});
