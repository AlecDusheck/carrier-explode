/** What the bucket and the index already hold, for a feed's check. */

import * as v from "valibot";

import { releaseList, type IndexDb } from "@carrier-explode/db/d1";
import type { ReleaseSummary } from "@carrier-explode/schema/types";

/** A stored JSON record, validated; null when absent. */
export async function readRecord<S extends v.GenericSchema>(bucket: R2Bucket, key: string, schema: S): Promise<v.InferOutput<S> | null> {
  const o = await bucket.get(key);
  return o ? v.parse(schema, await o.json()) : null;
}

export const heldIos = async (db: IndexDb): Promise<Array<Extract<ReleaseSummary, { readonly platform: "ios" }>>> =>
  (await releaseList(db)).flatMap((r) => (r.platform === "ios" ? [r] : []));

export const heldAndroid = async (db: IndexDb): Promise<Array<Extract<ReleaseSummary, { readonly platform: "android" }>>> =>
  (await releaseList(db)).flatMap((r) => (r.platform === "android" ? [r] : []));
