/** The base of every Workflow. Each validates its own payload: instances can be created outside /run. */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import type { Json } from "@carrier-explode/schema/types";
import type { Env } from "../worker/env.ts";
import type { RunContext } from "../worker/run-job.ts";

export abstract class Pipeline extends WorkflowEntrypoint<Env, unknown> {
  protected abstract steps(c: RunContext, payload: unknown): Promise<Json>;

  override async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep): Promise<Json> {
    // A step, so replays keep it and a restart, which reruns every step, draws a new one: its jobs run afresh.
    const nonce = await step.do("run", async () => crypto.randomUUID().slice(0, 8));
    return this.steps({ env: this.env, step, run: `${event.instanceId}.${nonce}` }, event.payload);
  }
}

/** Thrown at the end of a run that lost some jobs, so the instance shows as errored. */
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
