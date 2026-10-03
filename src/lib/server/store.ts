/**
 * The site's only door to R2 (bucket carrier-explode-v2, binding BUCKET). The
 * extractor writes everything; the site reads, and validates every JSON record
 * against its contract on the way in (./records.ts).
 */

import { error } from "@sveltejs/kit";
import { env } from "cloudflare:workers";
import * as v from "valibot";

/** A JSON object, validated; null when the key is absent. A record that breaks its contract is a 500, never a guess. */
export async function readJson<T>(key: string, schema: v.GenericSchema<unknown, T>): Promise<T | null> {
  const obj = await env.BUCKET.get(key);
  if (!obj) return null;
  const parsed = v.safeParse(schema, await obj.json());
  if (!parsed.success) error(500, `${key} does not match its contract: ${v.summarize(parsed.issues)}`);
  return parsed.output;
}

/** An object's bytes, or one range of them; null when the key is absent. */
export async function readBytes(key: string, range?: { offset: number; length: number }): Promise<Uint8Array<ArrayBuffer> | null> {
  const obj = await env.BUCKET.get(key, range ? { range } : undefined);
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}

/** The object's etag, or null: what a cache key built from a whole index file names it by. */
export async function etagOf(key: string): Promise<string | null> {
  return (await env.BUCKET.head(key))?.etag ?? null;
}
