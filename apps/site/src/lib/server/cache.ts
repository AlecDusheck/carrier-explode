/** Behind the edge's page cache: the colo's Cache API for derived JSON, and a request scope for work a page's queries share. */

import { getRequestEvent } from "$app/server";
import { env, waitUntil } from "cloudflare:workers";

/**
 * `fn`'s JSON, kept in the colo cache for CACHE_TTL.derived unless null ("not there yet"). Keys name the content the
 * value is derived from, which never changes under them. Hits are unvalidated: only this writes the key.
 */
export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const cache = await caches.open("derived");
	const req = new Request(`https://cache.carrier-explode/${encodeURIComponent(key)}`);
	const hit = await cache.match(req);
	if (hit) return hit.json<T>();
	const value = await fn();
	if (value !== null && value !== undefined) {
		const res = new Response(JSON.stringify(value), {
			headers: {
				"content-type": "application/json",
				"cache-control": `public, s-maxage=${env.CACHE_TTL.derived}`,
			},
		});
		waitUntil(cache.put(req, res));
	}
	return value;
}

/** `fn` at most once per request and arguments, told apart by `keyOf`. Keyed by `locals`, which remote calls share with their page. */
export function perRequest<A extends string[], T>(fn: (...args: A) => Promise<T>): (...args: A) => Promise<T>;
export function perRequest<A extends unknown[], T>(
	fn: (...args: A) => Promise<T>,
	keyOf: (...args: A) => string,
): (...args: A) => Promise<T>;
export function perRequest<T>(
	fn: (...args: unknown[]) => Promise<T>,
	keyOf: (...args: unknown[]) => string = (...args) => args.join("\0"),
): (...args: unknown[]) => Promise<T> {
	const scopes = new WeakMap<App.Locals, Map<string, Promise<T>>>();
	return (...args) => {
		const { locals } = getRequestEvent();
		let scope = scopes.get(locals);
		if (!scope) scopes.set(locals, (scope = new Map()));
		const key = keyOf(...args);
		let p = scope.get(key);
		if (!p) scope.set(key, (p = fn(...args)));
		return p;
	};
}
