/** Reading a stored record back through its valibot schema. */

import * as v from "valibot";

import type { R2Client } from "../../job.ts";

/** The record at `key` validated by `schema`; null when absent; throws with the key when malformed. */
export async function readRecord<S extends v.GenericSchema>(r2: R2Client, key: string, schema: S): Promise<v.InferOutput<S> | null> {
  const raw = await r2.getJson(key);
  if (raw === null) return null;
  const parsed = v.safeParse(schema, raw);
  if (!parsed.success) throw new Error(`${key}: ${v.summarize(parsed.issues)}`);
  return parsed.output;
}
