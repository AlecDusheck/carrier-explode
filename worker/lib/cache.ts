/**
 * Layered caching.
 *
 *  1. Isolate memory — survives between requests on a warm isolate, costs nothing.
 *  2. Cloudflare Cache API (`caches.default`) — shared across isolates in a colo.
 *     Note: on `*.workers.dev` the Cache API is a no-op, so layer 1 carries the
 *     load there; on a custom domain (or a route) it does the real work.
 *  3. `cf: { cacheTtl, cacheEverything }` on upstream fetches — keeps Apple's
 *     multi-hundred-kilobyte .ipcc files at the edge so we download each once.
 *
 * Responses also carry long `Cache-Control` so the browser and any intermediary
 * cache them: bundle URLs are content-addressed, so their decodes never change.
 */

interface MemoEntry { value: unknown; expires: number }

const memory = new Map<string, MemoEntry>();
const MAX_MEMO_ENTRIES = 300;

export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  if (memory.size >= MAX_MEMO_ENTRIES) {
    // Cheap eviction: drop the oldest quarter.
    const keys = [...memory.keys()].slice(0, Math.floor(MAX_MEMO_ENTRIES / 4));
    for (const k of keys) memory.delete(k);
  }
  memory.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

export function dropMemo(prefix?: string): number {
  if (!prefix) { const n = memory.size; memory.clear(); return n; }
  let n = 0;
  for (const k of memory.keys()) if (k.startsWith(prefix)) { memory.delete(k); n++; }
  return n;
}

const CACHE_ORIGIN = "https://carrier-explode.cache";

/** Serve a JSON payload through the Cache API, keyed by a stable string. */
export async function cachedJson(
  key: string,
  ttlSeconds: number,
  ctx: ExecutionContext,
  produce: () => Promise<unknown>,
): Promise<Response> {
  const cacheKey = new Request(`${CACHE_ORIGIN}/${encodeURIComponent(key)}`, { method: "GET" });
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set("x-cache", "hit");
    return r;
  }
  const payload = await produce();
  const body = JSON.stringify(payload);
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${Math.min(ttlSeconds, 3600)}, s-maxage=${ttlSeconds}, stale-while-revalidate=86400`,
    "x-cache": "miss",
  });
  const res = new Response(body, { headers });
  ctx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
  return res;
}

const ALLOWED_HOSTS = [
  "updates.cdn-apple.com",
  "appldnld.apple.com",
  "appldnld.apple.com.edgesuite.net",
  "itunes.apple.com",
  "secure-appldnld.apple.com",
  "iphone.apple.com",
];

export function assertAppleUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "not a URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new HttpError(400, "bad scheme");
  const host = u.hostname.toLowerCase();
  const ok = ALLOWED_HOSTS.includes(host) || host.endsWith(".apple.com") || host.endsWith(".apple.com.edgesuite.net");
  if (!ok) throw new HttpError(400, `host not allowed: ${host}`);
  // The scheme is left as the manifest gave it: the 2008-era edgesuite.net host
  // has no certificate for its own name and only answers over plain HTTP.
  return u;
}

/** Fetch an Apple asset, leaning on the edge cache so we download it once. */
export async function fetchUpstream(url: string, ttlSeconds = 2592000): Promise<Uint8Array> {
  const u = assertAppleUrl(url);
  // Try the scheme the manifest gave, then the other one: some old paths are
  // HTTP-only, and some hosts have since dropped their plain-HTTP listener.
  const alt = new URL(u.toString());
  alt.protocol = u.protocol === "https:" ? "http:" : "https:";
  let last = "";
  for (const target of [u, alt]) {
    let res: Response;
    try {
      res = await fetch(target.toString(), {
        cf: { cacheTtl: ttlSeconds, cacheEverything: true },
        redirect: "follow",
        headers: { "user-agent": "carrier-explode/1.0 (+bundle inspector)" },
      } as RequestInit);
    } catch (e) {
      last = (e as Error).message;
      continue;
    }
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    last = `HTTP ${res.status}`;
  }
  throw new HttpError(502, `upstream ${last} for ${u.hostname}`);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-1", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha384Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-384", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
