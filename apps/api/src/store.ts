/** The API's only door to R2: decoded JSON records, each checked against its contract on the way in. Never an artifact's bytes. */

import * as v from "valibot";

/** A record as stored, unchecked; null when the key is absent. */
export async function readJson(bucket: R2Bucket, key: string): Promise<unknown> {
  const obj = await bucket.get(key);
  return obj ? obj.json<unknown>() : null;
}

/** A record checked against its contract: one that breaks it is a 500, never a guess. */
export function validated<T>(key: string, schema: v.GenericSchema<unknown, T>, raw: unknown): T {
  const parsed = v.safeParse(schema, raw);
  if (!parsed.success) throw new Error(`${key} does not match its contract: ${v.summarize(parsed.issues)}`);
  return parsed.output;
}

/** A record, validated; null when the key is absent. */
export async function readRecord<T>(bucket: R2Bucket, key: string, schema: v.GenericSchema<unknown, T>): Promise<T | null> {
  const raw = await readJson(bucket, key);
  return raw === null ? null : validated(key, schema, raw);
}
