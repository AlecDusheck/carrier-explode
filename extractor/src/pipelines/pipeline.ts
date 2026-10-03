/**
 * The base of every pipeline Workflow. The instance payload is validated by
 * each pipeline against its own schema (PIPELINES[...].params), since
 * instances can also be created outside /run (wrangler, the dashboard).
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import type { Json } from "../../../src/lib/schema/types.ts";
import type { Env } from "../worker/env.ts";
import type { PipelineName } from "../worker/pipelines.ts";
import type { RunContext } from "../worker/run-job.ts";

export abstract class Pipeline extends WorkflowEntrypoint<Env, unknown> {
  protected abstract readonly pipeline: PipelineName;
  protected abstract steps(c: RunContext, payload: unknown): Promise<Json>;

  override run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep): Promise<Json> {
    return this.steps({ env: this.env, step, pipeline: this.pipeline, instance: event.instanceId }, event.payload);
  }
}

/** Thrown at the end of a run that published what it could but lost some jobs, so the instance shows as errored. */
export class IncompleteRunError extends Error {
  override name = "IncompleteRunError";
  constructor(readonly failures: readonly string[]) {
    super(`${failures.length} job(s) failed: ${failures.join(" | ")}`);
  }
}

/** The run's summary, or IncompleteRunError when anything failed along the way. */
export function settle(summary: { readonly [k: string]: Json }, failed: readonly string[]): Json {
  if (failed.length) throw new IncompleteRunError(failed);
  return summary;
}
