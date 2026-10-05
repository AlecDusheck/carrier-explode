/** OS builds (an iOS build, a Pixel build): what each changed, and the modems it ships. */

import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { changesAfter, releaseOf, releasesAfter } from "@carrier-explode/db/d1";
import { releaseSchema } from "@carrier-explode/schema/records";
import type { ReleasePlatform, ReleaseSummary } from "@carrier-explode/schema/types";
import { keys } from "@carrier-explode/storage";
import { fail, router, type ApiContext, type ApiEnv } from "../context.ts";
import { NUMBER_KEY, pageQuery, paged, STRING_KEY } from "../page.ts";
import { budget } from "../rate.ts";
import { buildModemsSchema, buildPageSchema, buildSchema, changePageSchema, type BuildModems } from "../shapes.ts";
import { readRecord } from "../store.ts";
import { ERRORS, json, NO_QUERY, releasePlatformParam } from "./common.ts";

const platform = z.object({ platform: releasePlatformParam });
const build = platform.extend({
  build: z.string().regex(/^[\w.]{3,40}$/).openapi({ description: "An iOS build (`24A437`) or a Pixel build id (`CP3A.260905.009`).", example: "24A437" }),
});

async function summaryOf(c: ApiContext, platform: ReleasePlatform, id: string): Promise<ReleaseSummary> {
  const summary = await releaseOf(c.var.db, platform, id);
  if (!summary) throw fail(404, `No ${platform} build ${id}.`);
  return summary;
}

/** A build's modems from its release record, which holds them as the extractor read them. */
async function modemsOf(c: ApiContext, platform: ReleasePlatform, id: string): Promise<BuildModems> {
  const release = await readRecord(c.env.BUCKET, keys.release(platform, id), releaseSchema);
  if (!release) throw fail(404, `No ${platform} build ${id}.`);
  return release.platform === "ios" ? { platform: "ios", modems: release.modems } : { platform: "android", modems: release.modems };
}

export const builds: OpenAPIHono<ApiEnv> = router()
  .openapi(createRoute({
    method: "get", path: "/{platform}/builds", operationId: "listBuilds", tags: ["Builds"], summary: "One platform's builds, newest first",
    middleware: [budget("base")],
    request: { params: platform, query: z.object(pageQuery).strict() },
    responses: { ...json(buildPageSchema, "A page of builds."), ...ERRORS },
  }), async (c) => {
    const { platform } = c.req.valid("param");
    return c.json(await paged(c, c.req.valid("query"), NUMBER_KEY, (p) => releasesAfter(c.var.db, platform, p), (r) => r.sort, (rows) => rows.map((r) => r.summary)), 200);
  })
  .openapi(createRoute({
    method: "get", path: "/{platform}/builds/{build}", operationId: "getBuild", tags: ["Builds"], summary: "A build: its version, devices and how many sources it carries",
    middleware: [budget("base")],
    request: { params: build, query: NO_QUERY },
    responses: { ...json(buildSchema, "The build."), ...ERRORS },
  }), async (c) => {
    const { platform, build } = c.req.valid("param");
    return c.json(await summaryOf(c, platform, build), 200);
  })
  .openapi(createRoute({
    method: "get", path: "/{platform}/builds/{build}/changes", operationId: "listBuildChanges", tags: ["Builds"], summary: "The sources a build added, removed or changed against the platform's build before it",
    middleware: [budget("base")],
    request: { params: build, query: z.object(pageQuery).strict() },
    responses: { ...json(changePageSchema, "A page of changes, by source."), ...ERRORS },
  }), async (c) => {
    const { platform, build } = c.req.valid("param");
    await summaryOf(c, platform, build);
    return c.json(await paged(c, c.req.valid("query"), STRING_KEY, (p) => changesAfter(c.var.db, platform, build, p), (r) => r.source, (rows) => rows), 200);
  })
  .openapi(createRoute({
    method: "get", path: "/{platform}/builds/{build}/modems", operationId: "getBuildModems", tags: ["Builds"],
    summary: "The modems a build ships: iOS modem firmware packages, or Pixel modem firmwares and their carrier configurations",
    middleware: [budget("bundle")],
    request: { params: build, query: NO_QUERY },
    responses: { ...json(buildModemsSchema, "The build's modems."), ...ERRORS },
  }), async (c) => {
    const { platform, build } = c.req.valid("param");
    return c.json(await modemsOf(c, platform, build), 200);
  });
