/** The Worker's bindings (wrangler.jsonc), by hand so Workflow params are typed per pipeline. */

import type { HeavyExtractor, LightExtractor } from "./extractor.ts";
import type { PipelineParams } from "./pipelines.ts";
import type { PurgeVars } from "./purge.ts";
import type { Tuning } from "./tuning.ts";

export interface Env extends PurgeVars, Tuning {
  readonly BUCKET: R2Bucket;
  /** The index (packages/db), which publishes write. */
  readonly DB: D1Database;
  readonly HEAVY: DurableObjectNamespace<HeavyExtractor>;
  readonly LIGHT: DurableObjectNamespace<LightExtractor>;
  readonly IOS_BUILD: Workflow<PipelineParams<"ios-build">>;
  readonly ANDROID_BUILD: Workflow<PipelineParams<"android-build">>;
  readonly IOS_OTA: Workflow<PipelineParams<"ios-ota">>;
  readonly REINDEX: Workflow<PipelineParams<"reindex">>;
  readonly PUBLISH: Workflow<PipelineParams<"publish">>;
  readonly LABELS: Workflow<PipelineParams<"labels">>;
  /** Workers AI and the Web Search API, for the labels Workflow. */
  readonly AI: Ai;
  /** Bearer token for /run, /runs and /jobs. */
  readonly RUN_TOKEN: string;
  /** The bucket over R2's S3 API, for the containers: endpoint and name are vars, the bucket-scoped key secrets. */
  readonly R2_ENDPOINT: string;
  readonly R2_BUCKET: string;
  readonly R2_ACCESS_KEY_ID: string;
  readonly R2_SECRET_ACCESS_KEY: string;
}
