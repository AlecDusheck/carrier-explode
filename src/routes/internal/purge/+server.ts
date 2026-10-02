import { error } from "@sveltejs/kit";
import { cache, env } from "cloudflare:workers";

/**
 * Drops cached pages so a new bundle shows up without waiting out its TTL.
 * Called by .github/workflows/system-bundles.yml once an image is in the
 * bucket; "latest" covers every page that tracks the newest bundle, and a
 * `tags` body can name bundles instead (`b-ATT_US`).
 */
export async function POST({ request }) {
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!env.PURGE_TOKEN || given !== env.PURGE_TOKEN) error(401, "bad or missing purge token");

  const body = (await request.json().catch(() => ({}))) as { tags?: unknown };
  const named = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [];
  const tags = named.length ? named : ["latest"];
  const result = await cache.purge({ tags });
  if (!result.success) error(502, result.errors.map((e) => e.message).join("; ") || "purge failed");
  return Response.json({ purged: tags });
}
