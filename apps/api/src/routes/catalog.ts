/** What the API covers: platforms and features, which never change between deploys, and the carriers and countries of the index. */

import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { carrierOf, carriersAfter, countriesAfter, countryOf } from "@carrier-explode/db/d1";
import { conceptById, decoderFamily, FAMILY_KINDS, FEATURE_SLUGS, isReleasePlatform, KIND_SEGMENT, needs5G, PLATFORMS } from "@carrier-explode/schema";
import { fail, router, type ApiEnv } from "../context.ts";
import { pageQuery, paged, STRING_KEY } from "../page.ts";
import { budget } from "../rate.ts";
import { carrierDetailSchema, carrierPageSchema, countryPageSchema, countrySchema, featuresSchema, platformsSchema, type Feature, type PlatformInfo } from "../shapes.ts";
import { ERRORS, json, NO_QUERY } from "./common.ts";

const PLATFORM_INFO: readonly PlatformInfo[] = PLATFORMS.map((platform) => {
  const family = decoderFamily(platform);
  return { platform, family, kinds: FAMILY_KINDS[family].map((k) => KIND_SEGMENT[k]), builds: isReleasePlatform(platform) };
});

const FEATURES: readonly Feature[] = FEATURE_SLUGS.map((slug) => {
  const concept = conceptById(slug);
  if (concept === undefined) throw new Error(`feature ${slug} has no concept`);
  return { slug, name: concept.name, description: concept.description, needs5G: needs5G(slug) };
});

const ISO = z.string().regex(/^[a-z]{2}$/).openapi({ description: "ISO 3166 alpha-2, lower case.", example: "us" });

export const catalog: OpenAPIHono<ApiEnv> = router()
  .openapi(createRoute({
    method: "get", path: "/platforms", operationId: "listPlatforms", tags: ["Catalog"], summary: "Every platform, the kinds of source it ships, and whether it has builds",
    middleware: [budget("base")],
    request: { query: NO_QUERY },
    responses: { ...json(platformsSchema, "The platforms."), ...ERRORS },
  }), (c) => c.json(PLATFORM_INFO, 200))
  .openapi(createRoute({
    method: "get", path: "/features", operationId: "listFeatures", tags: ["Catalog"], summary: "The carrier features the index reads per phone",
    middleware: [budget("base")],
    request: { query: NO_QUERY },
    responses: { ...json(featuresSchema, "The features, in display order."), ...ERRORS },
  }), (c) => c.json(FEATURES, 200))
  .openapi(createRoute({
    method: "get", path: "/carriers", operationId: "listCarriers", tags: ["Carriers"], summary: "Carriers across platforms, each with its sources",
    middleware: [budget("base")],
    request: { query: z.object(pageQuery).strict() },
    responses: { ...json(carrierPageSchema, "A page of carriers, by id."), ...ERRORS },
  }), async (c) => c.json(await paged(c, c.req.valid("query"), STRING_KEY, (p) => carriersAfter(c.var.db, p), (r) => r.id, (rows) => rows), 200))
  .openapi(createRoute({
    method: "get", path: "/carriers/{id}", operationId: "getCarrier", tags: ["Carriers"], summary: "A carrier: its sources, the SIMs that link them, and its Pixel modem configurations",
    middleware: [budget("base")],
    request: { params: z.object({ id: z.string().max(200).openapi({ example: "ATT_US" }) }), query: NO_QUERY },
    responses: { ...json(carrierDetailSchema, "The carrier."), ...ERRORS },
  }), async (c) => {
    const { id } = c.req.valid("param");
    const row = await carrierOf(c.var.db, id);
    if (!row) throw fail(404, `No carrier ${id}.`);
    return c.json({ carrier: { ...row.carrier, name: row.name }, modems: row.modems }, 200);
  })
  .openapi(createRoute({
    method: "get", path: "/countries", operationId: "listCountries", tags: ["Carriers"], summary: "Countries, each with its country bundles and carriers",
    middleware: [budget("base")],
    request: { query: z.object(pageQuery).strict() },
    responses: { ...json(countryPageSchema, "A page of countries, by ISO code."), ...ERRORS },
  }), async (c) => c.json(await paged(c, c.req.valid("query"), STRING_KEY, (p) => countriesAfter(c.var.db, p), (r) => r.iso, (rows) => rows), 200))
  .openapi(createRoute({
    method: "get", path: "/countries/{iso}", operationId: "getCountry", tags: ["Carriers"], summary: "A country: its country bundles and carriers",
    middleware: [budget("base")],
    request: { params: z.object({ iso: ISO }), query: NO_QUERY },
    responses: { ...json(countrySchema, "The country."), ...ERRORS },
  }), async (c) => {
    const { iso } = c.req.valid("param");
    const country = await countryOf(c.var.db, iso);
    if (!country) throw fail(404, `No country ${iso}.`);
    return c.json(country, 200);
  });
