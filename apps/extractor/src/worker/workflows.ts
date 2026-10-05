import type { Env } from "./env.ts";
import { timedInstanceId } from "./ids.ts";
import { PIPELINES, type PipelineName, type PipelineParams } from "./pipelines.ts";

/** A Workflow instance to create: its pipeline, id and params. */
export type Run = { readonly [P in PipelineName]: { readonly pipeline: P; readonly id: string; readonly params: PipelineParams<P> } }[PipelineName];

/** The Workflow binding behind a pipeline. */
export function workflowOf(env: Env, pipeline: PipelineName): Env[(typeof PIPELINES)[PipelineName]["binding"]] {
  return env[PIPELINES[pipeline].binding];
}

/** Creates the run's Workflow instance. A switch, so each binding gets its own params type. */
export function createRun(env: Env, run: Run): Promise<WorkflowInstance> {
  switch (run.pipeline) {
    case "ios-build": return env.IOS_BUILD.create({ id: run.id, params: run.params });
    case "android-build": return env.ANDROID_BUILD.create({ id: run.id, params: run.params });
    case "ios-ota": return env.IOS_OTA.create({ id: run.id, params: run.params });
    case "reindex": return env.REINDEX.create({ id: run.id, params: run.params });
    case "publish": return env.PUBLISH.create({ id: run.id, params: run.params });
    case "labels": return env.LABELS.create({ id: run.id, params: run.params });
  }
}

/** A publish of the bucket and the labels as they are at `now`; one requested earlier but not yet built covers this one too. */
export const publishRun = (now: Date, force: boolean): Run =>
  ({ pipeline: "publish", id: timedInstanceId("publish", now), params: { requested: now.toISOString(), ...(force ? { force } : {}) } });
