/**
 * Two layers. Isolate memory is free and survives between requests on a warm
 * isolate. The Cache API is shared across a colo but is a no-op on
 * *.workers.dev, which is why the deployment sits on a custom domain.
 * Upstream .ipcc fetches also set cf.cacheTtl so Apple is hit once per file.
 */

import { error } from "@sveltejs/kit";
import { getRequestEvent } from "$app/server";

const memory = new Map<string, { value: unknown; expires: number }>();

/** Memoise in the isolate. A null/undefined result is never stored: it usually means "not reachable yet". */
export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  if (value != null) {
    if (memory.size >= 400) for (const k of [...memory.keys()].slice(0, 100)) memory.delete(k);
    memory.set(key, { value, expires: Date.now() + ttlMs });
  }
  return value;
}

/** Memory first, then the colo cache, for JSON that is expensive to build. */
export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  return memo(key, Math.min(ttlSeconds, 3600) * 1000, async () => {
    const { platform } = getRequestEvent();
    const cache = platform?.caches?.default;
    const req = new Request(`https://cache.carrier-explode/${encodeURIComponent(key)}`);
    const hit = await cache?.match(req);
    if (hit) return (await hit.json()) as T;
    const value = await fn();
    if (cache && value != null) {
      const res = new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json", "cache-control": `public, s-maxage=${ttlSeconds}` },
      });
      platform!.ctx.waitUntil(cache.put(req, res).catch(() => {}));
    }
    return value;
  });
}

// updates.cdn-apple.com, appldnld.apple.com, and the 2008-era appldnld.apple.com.edgesuite.net
const APPLE = /(^|\.)(cdn-)?apple\.com(\.edgesuite\.net)?$/;

/** Fetch from Apple. Old manifest entries are HTTP-only and some hosts have dropped HTTP, so try both. */
export async function fetchApple(url: string): Promise<Uint8Array> {
  const u = new URL(url);
  if (!APPLE.test(u.hostname)) error(400, `host not allowed: ${u.hostname}`);
  const alt = new URL(u);
  alt.protocol = u.protocol === "https:" ? "http:" : "https:";
  let last = "";
  for (const target of [u, alt]) {
    try {
      const res = await fetch(target, {
        cf: { cacheTtl: 30 * 86400, cacheEverything: true },
        headers: { "user-agent": "carrier-explode/1.0" },
      } as RequestInit);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  error(502, `Apple returned ${last} for ${u.hostname}`);
}

export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-1", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha384Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-384", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
