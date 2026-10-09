/** What every reader of the store shares: validated record reads, cache headers a purge can reach, the purge endpoint's checks. */

import * as v from "valibot";

import { keys } from "./keys.ts";
import { INDEX_TAG } from "./purge.ts";

/** A stored record that breaks its contract: a 500 for a reader, never a guess. */
export class RecordError extends Error {
	override name = "RecordError";
}

export function validRecord<T>(key: string, schema: v.GenericSchema<unknown, T>, raw: unknown): T {
	const parsed = v.safeParse(schema, raw);
	if (!parsed.success)
		throw new RecordError(`${key} does not match its contract: ${v.summarize(parsed.issues)}`);
	return parsed.output;
}

/** The JSON text of the record at `key`, or a RecordError: a retry reads the same text. */
export function parseRecord(key: string, text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (e) {
		if (e instanceof SyntaxError) throw new RecordError(`${key} is not JSON: ${e.message}`);
		throw e;
	}
}

/** The JSON record at `key`, validated; null when the key is absent. */
export async function readRecord<T>(
	bucket: R2Bucket,
	key: string,
	schema: v.GenericSchema<unknown, T>,
): Promise<T | null> {
	const o = await bucket.get(key);
	return o === null ? null : validRecord(key, schema, parseRecord(key, await o.text()));
}

/**
 * The object at a modemConfig or combos key, else at its PREVIOUS_MODEM_SCHEMA key, which serves until a reindex writes
 * the current one; null when neither is held.
 */
export async function readModem(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
	const previous = keys.previousModem(key);
	if (previous === undefined) throw new Error(`${key}: not a modem record's key`);
	return (await bucket.get(key)) ?? bucket.get(previous);
}

/** readRecord of a modem record, by readModem. */
export async function readModemRecord<T>(
	bucket: R2Bucket,
	key: string,
	schema: v.GenericSchema<unknown, T>,
): Promise<T | null> {
	const o = await readModem(bucket, key);
	return o === null ? null : validRecord(o.key, schema, parseRecord(o.key, await o.text()));
}

/** Browsers revalidate before each use, so a purge reaches them at once; the edge answers the revalidation. */
export const REVALIDATE = "no-cache";
export const NO_STORE = "private, no-store";

/** What browsers may keep, and what the edge may (cloudflare-cdn-cache-control, so Cache-Control speaks only to browsers), tagged INDEX_TAG. */
export type CachePolicy = { readonly browser: string } | { readonly browser: string; readonly edge: string };

export const NOT_CACHED: CachePolicy = { browser: NO_STORE };

/** An edge TTL; max-age, as s-maxage would disable stale-while-revalidate. */
export const revalidating = (seconds: number, staleWhileRevalidate: number): string =>
	`max-age=${seconds}, stale-while-revalidate=${staleWhileRevalidate}`;

export function applyPolicy(headers: Headers, policy: CachePolicy): void {
	headers.set("cache-control", policy.browser);
	if ("edge" in policy) {
		headers.set("cloudflare-cdn-cache-control", policy.edge);
		headers.set("cache-tag", INDEX_TAG);
	}
}

/** A purge's bearer as the endpoint checks it: null when it is the shared PURGE_TOKEN, else why not. */
export const purgeRefusal = (
	authorization: string | null | undefined,
	token: string | undefined,
): string | null => (token && authorization === `Bearer ${token}` ? null : "bad or missing purge token");

/** The Workers cache, as a purge uses it. */
interface PurgeableCache {
	purge(options: {
		readonly tags: string[];
	}): Promise<{ readonly success: boolean; readonly errors: ReadonlyArray<{ readonly message: string }> }>;
}

/** Purges every response the reader cached; why it failed, or null. */
export async function purgeCache(cache: PurgeableCache): Promise<string | null> {
	const result = await cache.purge({ tags: [INDEX_TAG] });
	return result.success ? null : result.errors.map((e) => e.message).join("; ") || "purge failed";
}
