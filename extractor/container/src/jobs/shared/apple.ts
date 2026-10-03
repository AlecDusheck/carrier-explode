/**
 * Downloads from Apple, for the jobs that archive Apple's files. The host
 * allow-list is the extractor's (src/lib/http is deliberately generic); the
 * scheme fallback is because old manifest entries are http-only and some
 * hosts have since dropped http.
 */

import { fetchWithRetry, withSchemeFallback } from "../../../../../src/lib/http/index.ts";

const APPLE = /(^|\.)(cdn-)?apple\.com(\.edgesuite\.net)?$/;

export async function fetchApple(url: string): Promise<Uint8Array> {
  const host = new URL(url).hostname;
  if (!APPLE.test(host)) throw new Error(`${url}: not an Apple host`);
  return withSchemeFallback(url, async (u) => new Uint8Array(await (await fetchWithRetry(u)).arrayBuffer()));
}
