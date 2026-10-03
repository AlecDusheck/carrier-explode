/**
 * The extractor Worker's bindings (wrangler.jsonc). Written by hand rather
 * than generated, so the Workflow params are typed per pipeline.
 */

import type { HeavyExtractor, LightExtractor } from "./extractor.ts";
import type { PipelineParams } from "./pipelines.ts";

export interface Env {
  readonly BUCKET: R2Bucket;
  readonly HEAVY: DurableObjectNamespace<HeavyExtractor>;
  readonly LIGHT: DurableObjectNamespace<LightExtractor>;
  readonly IOS_IMAGES: Workflow<PipelineParams<"ios-images">>;
  readonly IOS_OTA: Workflow<PipelineParams<"ios-ota">>;
  readonly ANDROID: Workflow<PipelineParams<"android">>;
  readonly REINDEX: Workflow<PipelineParams<"reindex">>;
  readonly INDEX: Workflow<PipelineParams<"index">>;
  /** Bearer token for /run, /runs and /jobs (`wrangler secret put RUN_TOKEN`). */
  readonly RUN_TOKEN: string;
  /** The site's /internal/purge; purging is skipped when unset. */
  readonly PURGE_URL?: string;
  readonly PURGE_TOKEN?: string;
}
