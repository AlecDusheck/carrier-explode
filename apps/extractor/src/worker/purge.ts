/** Purges every reader's cache (the site's, the API's) at its PURGE_PATH once a new index is in. */

import { fetchWithRetry } from "@carrier-explode/http";
import { PURGE_PATH, type PurgeRequest } from "@carrier-explode/storage";

/** The readers' origins and the bearer they share: both, or neither to skip purging. */
export interface PurgeVars {
  readonly PURGE_ORIGINS?: readonly string[];
  readonly PURGE_TOKEN?: string;
}

/** Where to purge; null when neither is set. Half of the pair is a misconfiguration, and throws. */
export function purgeTargets(env: PurgeVars): { readonly urls: readonly string[]; readonly token: string } | null {
  const { PURGE_ORIGINS: origins = [], PURGE_TOKEN: token } = env;
  if (origins.length && token) return { urls: origins.map((o) => new URL(PURGE_PATH, o).href), token };
  if (origins.length) throw new Error("PURGE_ORIGINS is set but PURGE_TOKEN is not: `wrangler secret put PURGE_TOKEN`, or remove PURGE_ORIGINS");
  if (token) throw new Error("PURGE_TOKEN is set but PURGE_ORIGINS is not");
  return null;
}

/** True once every reader has purged; false when purging is off. */
export async function purgeReaders(env: PurgeVars, request: PurgeRequest): Promise<boolean> {
  const target = purgeTargets(env);
  if (!target) return false;
  await Promise.all(target.urls.map(async (url) => {
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: { authorization: `Bearer ${target.token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    }, { tries: 3 });
    await res.body?.cancel();
  }));
  return true;
}
