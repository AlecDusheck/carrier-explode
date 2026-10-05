/** The site's only door to R2. The site only reads, and validates every JSON record on the way in. */

import { error } from "@sveltejs/kit";
import { env } from "cloudflare:workers";
import * as v from "valibot";

/** A record read from `where`, checked against its contract: one that breaks it is a 500, never a guess. */
export function validated<T>(where: string, schema: v.GenericSchema<unknown, T>, raw: unknown): T {
  const parsed = v.safeParse(schema, raw);
  if (!parsed.success) error(500, `${where} does not match its contract: ${v.summarize(parsed.issues)}`);
  return parsed.output;
}

/** A JSON object, validated; null when the key is absent. */
export async function readJson<T>(key: string, schema: v.GenericSchema<unknown, T>): Promise<T | null> {
  const obj = await env.BUCKET.get(key);
  return obj ? validated(key, schema, await obj.json()) : null;
}

/** An object's bytes, or one range of them; null when the key is absent. */
export async function readBytes(key: string, range?: { offset: number; length: number }): Promise<Uint8Array<ArrayBuffer> | null> {
  const obj = await env.BUCKET.get(key, range ? { range } : undefined);
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}
