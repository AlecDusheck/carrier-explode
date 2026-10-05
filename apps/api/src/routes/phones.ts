/** The phones of each platform's current build, and which carriers give each feature on one. */

import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { phoneOf, phonesAfter, statesAfter } from "@carrier-explode/db/d1";
import { fail, router, type ApiEnv } from "../context.ts";
import { pageQuery, paged, STRING_KEY } from "../page.ts";
import { budget } from "../rate.ts";
import { featurePageSchema, phonePageSchema } from "../shapes.ts";
import { ERRORS, json, releasePlatformParam } from "./common.ts";

const platform = z.object({ platform: releasePlatformParam });
const phone = platform.extend({
  device: z.string().regex(/^(?:[A-Za-z]+\d+,\d+|[a-z][a-z0-9_]{1,30})$/).openapi({ description: "An iPhone's product type or a Pixel's codename.", example: "iPhone18,1" }),
});

export const phones: OpenAPIHono<ApiEnv> = router()
  .openapi(createRoute({
    method: "get", path: "/{platform}/phones", operationId: "listPhones", tags: ["Phones"], summary: "The phones of the platform's current build",
    middleware: [budget("base")],
    request: { params: platform, query: z.object(pageQuery).strict() },
    responses: { ...json(phonePageSchema, "A page of phones, by code."), ...ERRORS },
  }), async (c) => {
    const { platform } = c.req.valid("param");
    return c.json(await paged(c, c.req.valid("query"), STRING_KEY, (p) => phonesAfter(c.var.db, platform, p), (r) => r.code, (rows) => rows), 200);
  })
  .openapi(createRoute({
    method: "get", path: "/{platform}/phones/{device}/features", operationId: "listPhoneFeatures", tags: ["Phones"],
    summary: "Each carrier source's feature states on one phone: on, available (a switch, or per plan), or no",
    middleware: [budget("base")],
    request: { params: phone, query: z.object(pageQuery).strict() },
    responses: { ...json(featurePageSchema, "A page of carrier sources, by key; a source that ships nothing for the phone is absent."), ...ERRORS },
  }), async (c) => {
    const { platform, device } = c.req.valid("param");
    if ((await phoneOf(c.var.db, device))?.platform !== platform) throw fail(404, `No ${device} in the current ${platform} build.`);
    return c.json(await paged(c, c.req.valid("query"), STRING_KEY, (p) => statesAfter(c.var.db, device, p), (r) => r.source, (rows) => rows), 200);
  });
