/**
 * Drops the site's cached pages once a new index is in, through the site's
 * own /internal/purge (src/routes/internal/purge). "latest" covers every page
 * that tracks the newest data. Skipped when PURGE_URL is not configured.
 */

import { fetchWithRetry } from "../../../src/lib/http/index.ts";
import type { Env } from "./env.ts";

export async function purgeSite(env: Env): Promise<boolean> {
  if (!env.PURGE_URL || !env.PURGE_TOKEN) return false;
  const res = await fetchWithRetry(env.PURGE_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${env.PURGE_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ tags: ["latest"] }),
  }, { tries: 3 });
  await res.body?.cancel();
  return true;
}
