/** Downloads from Apple. The host allow-list is the extractor's; src/lib/http is deliberately generic. */

import { MANIFEST_URL } from "../../../../../src/lib/decode/index.ts";
import { fetchWithRetry, withSchemeFallback } from "../../../../../src/lib/http/index.ts";

const APPLE = /(^|\.)(cdn-)?apple\.com(\.edgesuite\.net)?$/;

/** Old manifest entries are http-only and some hosts have since dropped http, hence the scheme fallback. */
export async function fetchApple(url: string): Promise<Uint8Array> {
  const host = new URL(url).hostname;
  if (!APPLE.test(host)) throw new Error(`${url}: not an Apple host`);
  return withSchemeFallback(url, async (u) => new Uint8Array(await (await fetchWithRetry(u)).arrayBuffer()));
}

/** The OTA manifest as Apple serves it now; a query of its own gets past a stale CDN copy. */
export const fetchManifest = (): Promise<Uint8Array> => fetchApple(`${MANIFEST_URL}?t=${Date.now()}`);
