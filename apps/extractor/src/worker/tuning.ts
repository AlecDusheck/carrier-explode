/** The extractor's tuning: wrangler.jsonc vars, in this shape (test/tables.test.ts checks). */

import * as v from "valibot";

import type { FeedName } from "./pipelines.ts";

const positive = v.pipe(v.number(), v.integer(), v.minValue(1));

export const tuningSchema = v.object({
  /** Instances each feed keeps extracting at once. */
  FEED_WINDOWS: v.object({ "ios-images": positive, "ios-ota": positive, android: positive }) satisfies v.GenericSchema<unknown, Record<FeedName, number>>,
  /** Tries of a job, each in a fresh container. */
  JOB_ATTEMPTS: positive,
  /** How long a job's start keeps retrying while every container of its class is running. */
  START_RETRY_MINUTES: positive,
  OTA_FILES_PER_JOB: positive,
  /** Shas per normalize job: bounds one job, and what a failed one redoes. */
  NORMALIZE_CHUNK: positive,
  /** A reindex's shards, unless it names its own. */
  REINDEX_SHARDS: positive,
  /** The labels Workflow: the AI Gateway its search and model calls go through, the search provider, the model, and codes tried per kind each run. */
  LABELLER: v.object({
    gateway: v.pipe(v.string(), v.minLength(1)),
    provider: v.picklist(["ceramic", "exa", "linkup"]),
    model: v.pipe(v.string(), v.minLength(1)),
    perKind: positive,
  }),
});

export type Tuning = v.InferOutput<typeof tuningSchema>;
