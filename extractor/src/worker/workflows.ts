import type * as v from "valibot";

import type { Env } from "./env.ts";
import { PIPELINES, type PipelineName, type runRequestSchema } from "./pipelines.ts";

export type RunRequest = v.InferOutput<typeof runRequestSchema>;

/** The Workflow binding behind a pipeline. */
export function workflowOf(env: Env, pipeline: PipelineName): Env[(typeof PIPELINES)[PipelineName]["binding"]] {
  return env[PIPELINES[pipeline].binding];
}

/** Creates the run's Workflow instance. A switch, so each binding gets its own params type. */
export function createRun(env: Env, run: RunRequest, id: string): Promise<WorkflowInstance> {
  switch (run.pipeline) {
    case "ios-images": return env.IOS_IMAGES.create({ id, params: run.params });
    case "ios-ota": return env.IOS_OTA.create({ id, params: run.params });
    case "android": return env.ANDROID.create({ id, params: run.params });
    case "reindex": return env.REINDEX.create({ id, params: run.params });
    case "index": return env.INDEX.create({ id, params: run.params });
  }
}
