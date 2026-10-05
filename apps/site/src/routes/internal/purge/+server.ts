import { error } from "@sveltejs/kit";
import { cache, env } from "cloudflare:workers";
import * as v from "valibot";
import { purgeRequestSchema } from "@carrier-explode/storage";

/** Drops cached pages so new settings show up without waiting out their TTL. Called by the extractor once an ingest lands. */
export async function POST({ request }) {
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!env.PURGE_TOKEN || given !== env.PURGE_TOKEN) error(401, "bad or missing purge token");

  const parsed = v.safeParse(purgeRequestSchema, await request.json().catch(() => ({})));
  if (!parsed.success) error(400, v.summarize(parsed.issues));
  const result = await cache.purge(parsed.output.purge === "tags" ? { tags: parsed.output.tags } : { purgeEverything: true });
  if (!result.success) error(502, result.errors.map((e) => e.message).join("; ") || "purge failed");
  return Response.json(parsed.output);
}
