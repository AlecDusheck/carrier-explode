/** What the extractor asks each reader of the store (the site, the API) to drop from its cache after a publish, at its PURGE_PATH. */

import * as v from "valibot";

import type { SourceKey } from "@carrier-explode/schema/types";

/** Every reader serves its purge here, on its own origin, behind the one PURGE_TOKEN. */
export const PURGE_PATH = "/internal/purge";

/** The cache tag of whatever depends on the index as a whole; a response that read one source is tagged with its key. */
export const INDEX_TAG = "index";

/** A purge names at most 100 tags. */
const PURGE_TAGS = 100;

export const purgeRequestSchema = v.variant("purge", [
  v.object({ purge: v.literal("tags"), tags: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1), v.maxLength(PURGE_TAGS)) }),
  v.object({ purge: v.literal("everything") }),
]);
export type PurgeRequest = v.InferOutput<typeof purgeRequestSchema>;

/** The changed sources' tags and INDEX_TAG, which every page carries; everything when asked, or when they do not fit one purge. */
export const purgeFor = (changed: readonly SourceKey[] | "everything"): PurgeRequest =>
  changed !== "everything" && changed.length < PURGE_TAGS ? { purge: "tags", tags: [INDEX_TAG, ...changed] } : { purge: "everything" };
