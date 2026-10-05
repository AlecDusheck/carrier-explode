/** Sources (a carrier, country or default settings file of one platform), their versions, and each version decoded. */

import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { sourceOf, sourcesAfter, type SourceRow } from "@carrier-explode/db/d1";
import { deviceModems, head, lineOf, linesOf, versionOn } from "@carrier-explode/schema";
import { profileSchema } from "@carrier-explode/schema/records";
import {
  isVersionSlug, KIND_SEGMENT, SEGMENT_KIND, shipsKind, sourceKey, type KindSegment, type Platform, type Profile, type SourceKey, type SourceKind, type TimelineEntry,
} from "@carrier-explode/schema/types";
import { keys } from "@carrier-explode/storage";
import { fail, router, type ApiContext, type ApiEnv } from "../context.ts";
import { sourceCarrier } from "../names.ts";
import { pageQuery, paged, STRING_KEY } from "../page.ts";
import { budget } from "../rate.ts";
import { carrierModemsSchema, settingsSchema, sourcePageSchema, sourceSchema, versionPageSchema, versionSchema } from "../shapes.ts";
import { readRecord } from "../store.ts";
import { ERRORS, json, NO_QUERY, platformParam } from "./common.ts";

const list = z.object({
  platform: platformParam,
  kind: z.enum(KIND_SEGMENT).openapi({ description: "`carriers`, `countries` (Apple only) or `defaults`." }),
});
const source = list.extend({
  name: z.string().min(1).max(200).openapi({ description: "The platform's own name for it.", example: "ATT_US" }),
});
const LATEST = "latest";
const version = source.extend({
  version: z.string().refine((s) => s === LATEST || isVersionSlug(s), "a version slug (`72.0`, `50.1@2022-04-12`) or `latest`")
    .openapi({ description: "A version slug from the source's versions, or `latest` for the line's newest non-beta.", example: LATEST }),
});
const line = z.string().regex(/^[\w,]{1,40}$/).openapi({
  description: "A Pixel's codename (Android, which ships settings per device; default: the newest Pixel), or an Apple model's product type for a model-specific bundle (default: the main line).",
  example: "tokay",
});
const onLine = z.object({ line: line.optional() }).strict();

/** The kind a list or source URL names, if its platform ships it. */
function kindOn(platform: Platform, segment: KindSegment): SourceKind {
  const kind = SEGMENT_KIND[segment];
  if (!shipsKind(platform, kind)) throw fail(404, `${platform} ships no ${segment}.`);
  return kind;
}

/** The source a URL names, and its index row; the response is tagged with it. */
async function located(c: ApiContext, p: z.output<typeof source>): Promise<{ readonly key: SourceKey; readonly row: SourceRow }> {
  const key = sourceKey({ platform: p.platform, kind: kindOn(p.platform, p.kind), name: p.name });
  const row = await sourceOf(c.var.db, key);
  if (!row) throw fail(404, `No ${p.name} in ${p.platform} ${p.kind}. Something only just published appears after the next index run.`);
  c.var.sources.add(key);
  return { key, row };
}

interface Located {
  readonly key: SourceKey;
  readonly row: SourceRow;
  readonly line: string | null;
  readonly entry: TimelineEntry;
  readonly previous: TimelineEntry | null;
  /** Named by its slug rather than `latest`, so its answer never changes under its URL. */
  readonly pinned: boolean;
}

/** The version a URL names on its line. */
async function atVersion(c: ApiContext, p: z.output<typeof version>, named: string | undefined): Promise<Located> {
  const { key, row } = await located(c, p);
  const slug = p.version === LATEST ? undefined : p.version;
  const at = versionOn(row.timeline, named ?? null, slug);
  if (!at.found) throw fail(404, at.missing === "line" ? `${p.name} has no line ${named ?? ""}.` : `${p.name} has no version ${slug ?? ""} on line ${named ?? "(default)"}.`);
  return { key, row, line: at.line, entry: at.entry, previous: at.previous, pinned: slug !== undefined };
}

async function profileOf(c: ApiContext, at: Located): Promise<Profile> {
  const profile = await readRecord(c.env.BUCKET, keys.norm(at.entry.sha), profileSchema);
  if (!profile) throw fail(404, `${at.key} ${at.entry.slug} is not decoded yet.`);
  return profile;
}

export const sources: OpenAPIHono<ApiEnv> = router()
  .openapi(createRoute({
    method: "get", path: "/{platform}/{kind}", operationId: "listSources", tags: ["Sources"], summary: "One platform's sources of one kind",
    middleware: [budget("base")],
    request: { params: list, query: z.object(pageQuery).strict() },
    responses: { ...json(sourcePageSchema, "A page of sources, by name."), ...ERRORS },
  }), async (c) => {
    const { platform, kind } = c.req.valid("param");
    const of = kindOn(platform, kind);
    return c.json(await paged(c, c.req.valid("query"), STRING_KEY, (p) => sourcesAfter(c.var.db, platform, of, p), (s) => s.name, (rows) => rows.map((s) => ({
      key: s.key, name: s.name, carrier: { id: s.carrier.id, name: s.carrier.name, iso: s.carrier.iso }, updated: s.carrier.updated,
    }))), 200);
  })
  .openapi(createRoute({
    method: "get", path: "/{platform}/{kind}/{name}", operationId: "getSource", tags: ["Sources"], summary: "A source: its carrier and its lines of versions",
    middleware: [budget("base")],
    request: { params: source, query: NO_QUERY },
    responses: { ...json(sourceSchema, "The source."), ...ERRORS },
  }), async (c) => {
    const { key, row } = await located(c, c.req.valid("param"));
    const carrier = await sourceCarrier(c.var.db, key);
    if (!carrier) throw fail(404, `No ${key}.`);
    const lines = linesOf(row.timeline).map((l) => ({ line: l, versions: lineOf(row.timeline, l).length, head: head(row.timeline, l)?.entry.slug ?? null }));
    return c.json({ key, carrier, lines }, 200);
  })
  .openapi(createRoute({
    method: "get", path: "/{platform}/{kind}/{name}/versions", operationId: "listVersions", tags: ["Sources"], summary: "The versions on one of a source's lines, newest first",
    middleware: [budget("base")],
    request: { params: source, query: z.object({ ...pageQuery, line: line.optional() }).strict() },
    responses: { ...json(versionPageSchema, "A page of versions."), ...ERRORS },
  }), async (c) => {
    const { row } = await located(c, c.req.valid("param"));
    const query = c.req.valid("query");
    const at = head(row.timeline, query.line ?? null);
    if (!at) throw fail(404, `No line ${query.line ?? ""}.`);
    const entries = lineOf(row.timeline, at.line);
    return c.json(await paged(c, query, STRING_KEY, async (p) => {
      const from = p.after === null ? 0 : entries.findIndex((e) => e.slug === p.after) + 1;
      if (from === 0 && p.after !== null) throw fail(400, `Version ${p.after} is no longer on this line: start again without a cursor.`);
      return entries.slice(from, from + p.take);
    }, (e) => e.slug, (rows) => rows), 200);
  })
  .openapi(createRoute({
    method: "get", path: "/{platform}/{kind}/{name}/{version}", operationId: "getVersion", tags: ["Versions"],
    summary: "A version, decoded into the platform-neutral model: identity, APNs, concepts (features and values) and variants",
    middleware: [budget("bundle")],
    request: { params: version, query: onLine },
    responses: { ...json(versionSchema, "The version."), ...ERRORS },
  }), async (c) => {
    const at = await atVersion(c, c.req.valid("param"), c.req.valid("query").line);
    c.set("pinned", at.pinned);
    const { raw: _native, ...profile } = await profileOf(c, at);
    return c.json({ key: at.key, line: at.line, entry: at.entry, previous: at.previous?.slug ?? null, profile }, 200);
  })
  .openapi(createRoute({
    method: "get", path: "/{platform}/{kind}/{name}/{version}/settings", operationId: "getVersionSettings", tags: ["Versions"], summary: "A version's native settings, every one decoded",
    middleware: [budget("bundle")],
    request: { params: version, query: onLine },
    responses: { ...json(settingsSchema, "The settings, by key path."), ...ERRORS },
  }), async (c) => {
    const at = await atVersion(c, c.req.valid("param"), c.req.valid("query").line);
    c.set("pinned", at.pinned);
    return c.json({ key: at.key, line: at.line, slug: at.entry.slug, settings: (await profileOf(c, at)).raw }, 200);
  })
  .openapi(createRoute({
    method: "get", path: "/{platform}/{kind}/{name}/{version}/modems", operationId: "getVersionModems", tags: ["Versions"],
    summary: "The Pixel modem configurations this carrier's SIMs select on the version's device (Android)",
    middleware: [budget("base")],
    request: { params: version, query: onLine },
    responses: { ...json(carrierModemsSchema, "The modem configurations; fetch each by its sha from /v1/android/modem-configs."), ...ERRORS },
  }), async (c) => {
    const params = c.req.valid("param");
    if (params.platform !== "android") throw fail(404, "Only Android versions select modem configurations; an iPhone's are in its bundle's settings.");
    const at = await atVersion(c, params, c.req.valid("query").line);
    return c.json(deviceModems(at.row.modems, at.line), 200);
  });
