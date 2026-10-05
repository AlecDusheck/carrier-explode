/** The Workflows, one instance per unit of work, and the feeds whose checks create them. */

import * as v from "valibot";

import { sha1Schema } from "@carrier-explode/schema/records";
import { androidBuildSchema, iosBuildSchema, JOB_SCHEMAS } from "../jobs.ts";

export const PIPELINE_NAMES = ["ios-build", "android-build", "ios-ota", "reindex", "publish", "labels"] as const;
export type PipelineName = (typeof PIPELINE_NAMES)[number];

const positive = v.pipe(v.number(), v.integer(), v.minValue(1));

/** Keyed by exactly PIPELINE_NAMES: `satisfies` refuses a missing or an unlisted pipeline. */
export const PIPELINES = {
  /** One iOS build: ios.ipsw per IPSW and ios.modems → ios.release → normalize → publish */
  "ios-build": { binding: "IOS_BUILD", params: iosBuildSchema },
  /** One Pixel build: android.ota and android.modem per device → android.release → normalize → publish */
  "android-build": { binding: "ANDROID_BUILD", params: androidBuildSchema },
  /** One OTA manifest: ios.ota over the files it lists that the bucket lacks → files.json → normalize → publish */
  "ios-ota": { binding: "IOS_OTA", params: v.object({ manifest: sha1Schema, fetch: v.array(v.pipe(v.string(), v.url())) }) },
  /** normalize and ios.modem-summaries over everything, sharded → publish. By hand, after a decoder or mapper change. */
  reindex: { binding: "REINDEX", params: v.object({ shards: v.exactOptional(v.pipe(positive, v.maxValue(64))), force: v.exactOptional(v.boolean()) }) },
  /** The index and the scan index, once per burst of changes. */
  publish: { binding: "PUBLISH", params: v.omit(JOB_SCHEMAS.publish.params, ["live"]) },
  /** Names for codes nothing names, from a web search and a model, once a week (LABELS_CRON). */
  labels: { binding: "LABELS", params: v.object({}) },
} as const satisfies Record<PipelineName, { binding: string; params: v.GenericSchema }>;

export type PipelineParams<P extends PipelineName> = v.InferOutput<(typeof PIPELINES)[P]["params"]>;

export const FEED_NAMES = ["ios-images", "ios-ota", "android"] as const;
export type FeedName = (typeof FEED_NAMES)[number];

/** OTA feeds change within hours and cost a fetch to check; IPSWs come a few times a month and cost more. */
const OTA_CHECK = "*/10 * * * *";
const IPSW_CHECK = "5 * * * *";
/** Mondays: names change slowly, and each one costs a search and a model call. */
export const LABELS_CRON = "17 4 * * 1";

export const FEEDS = {
  "ios-images": {
    cron: IPSW_CHECK,
    options: v.object({
      /** Exactly this version, held or not. */
      version: v.exactOptional(v.string()),
      /** Every release from this version up that is not held. */
      since: v.exactOptional(v.string()),
      /** Extract held builds again. */
      rebuild: v.exactOptional(v.boolean()),
      betas: v.exactOptional(v.boolean()),
    }),
  },
  "ios-ota": { cron: OTA_CHECK, options: v.object({}) },
  android: { cron: OTA_CHECK, options: v.object({ rebuild: v.exactOptional(v.boolean()) }) },
} as const satisfies Record<FeedName, { cron: string; options: v.GenericSchema }>;

export type FeedOptions<F extends FeedName> = v.InferOutput<(typeof FEEDS)[F]["options"]>;

/** POST /run's body: a feed's check with its options, or a by-hand pipeline with its params. */
export const runRequestSchema = v.variant("run", [
  v.object({ run: v.literal("ios-images"), options: v.optional(FEEDS["ios-images"].options, {}) }),
  v.object({ run: v.literal("ios-ota"), options: v.optional(FEEDS["ios-ota"].options, {}) }),
  v.object({ run: v.literal("android"), options: v.optional(FEEDS.android.options, {}) }),
  v.object({ run: v.literal("reindex"), params: v.optional(PIPELINES.reindex.params, {}) }),
  v.object({ run: v.literal("publish"), params: v.optional(v.object({ force: v.exactOptional(v.boolean()) }), {}) }),
  v.object({ run: v.literal("labels") }),
]);
export type RunRequest = v.InferOutput<typeof runRequestSchema>;
