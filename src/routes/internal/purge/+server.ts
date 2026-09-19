import { error, json } from "@sveltejs/kit";

/**
 * Drops cached pages so a new bundle shows up without waiting out its TTL.
 * Called by .github/workflows/system-bundles.yml once an image is in the
 * bucket; "latest" covers every page that tracks the newest bundle, and a
 * `tags` body can name bundles instead (`b-ATT_US`).
 */
export async function POST({ request, platform }) {
  const token = platform?.env.PURGE_TOKEN;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || given !== token) error(401, "bad or missing purge token");

  const body = (await request.json().catch(() => ({}))) as { tags?: unknown };
  const named = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [];
  const tags = named.length ? named : ["latest"];
  const result = await platform?.ctx.cache?.purge({ tags });
  if (!result) error(501, "no cache to purge");
  if (!result.success) error(502, result.errors.map((e) => e.message).join("; ") || "purge failed");
  return json({ purged: tags });
}
