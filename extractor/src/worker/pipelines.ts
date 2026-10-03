/**
 * The pipelines a run can start, their Workflow bindings, the params each
 * takes, and when cron starts them. Pure data: ./api.ts and ./cron.ts read it,
 * ../pipelines/*.ts implement the steps.
 */

import * as v from "valibot";

import { JOB_SCHEMAS } from "../jobs.ts";

export const PIPELINES = {
  /** ios.plan → ios.ipsw ×N, ios.modems per build → ios.release per build → normalize → index → scan */
  "ios-images": { binding: "IOS_IMAGES", params: JOB_SCHEMAS["ios.plan"].params, cron: "17 5 * * *" },
  /** ios.ota-archive → normalize (new shas) → index → scan, when anything changed */
  "ios-ota": { binding: "IOS_OTA", params: JOB_SCHEMAS["ios.ota-archive"].params, cron: "*/30 * * * *" },
  /** android.plan → android.ota ×N → normalize → index → scan */
  android: { binding: "ANDROID", params: JOB_SCHEMAS["android.plan"].params, cron: "47 5 * * *" },
  /** normalize {all} sharded → index → scan. By hand, after a PROFILE_SCHEMA bump. */
  reindex: {
    binding: "REINDEX",
    params: v.object({ shards: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64))), force: v.exactOptional(v.boolean()) }),
    cron: null,
  },
  /** index alone. By hand, after a schema/index-build change. */
  index: { binding: "INDEX", params: v.object({}), cron: null },
} as const satisfies Record<string, { binding: string; params: v.GenericSchema; cron: string | null }>;

export type PipelineName = keyof typeof PIPELINES;
export type PipelineParams<P extends PipelineName> = v.InferOutput<(typeof PIPELINES)[P]["params"]>;
export type PipelineBinding = (typeof PIPELINES)[PipelineName]["binding"];

export const PIPELINE_NAMES = ["ios-images", "ios-ota", "android", "reindex", "index"] as const satisfies readonly PipelineName[];

/** POST /run's body: the pipeline, and its params (each pipeline's are all optional). */
export const runRequestSchema = v.variant("pipeline", [
  v.object({ pipeline: v.literal("ios-images"), params: v.optional(PIPELINES["ios-images"].params, {}) }),
  v.object({ pipeline: v.literal("ios-ota"), params: v.optional(PIPELINES["ios-ota"].params, {}) }),
  v.object({ pipeline: v.literal("android"), params: v.optional(PIPELINES.android.params, {}) }),
  v.object({ pipeline: v.literal("reindex"), params: v.optional(PIPELINES.reindex.params, {}) }),
  v.object({ pipeline: v.literal("index"), params: v.optional(PIPELINES.index.params, {}) }),
]);
