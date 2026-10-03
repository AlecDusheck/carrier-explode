/** A job's end: its record in R2 first, then the event its Workflow waits on, which reads that record. */

import { keys } from "../../../src/lib/storage/keys.ts";
import type { JobRecord, JobResult } from "../jobs.ts";
import type { Env } from "./env.ts";
import { doneEvent } from "./ids.ts";
import type { Launch } from "./launch.ts";
import { workflowOf } from "./workflows.ts";

export async function finishJob(env: Env, launch: Launch, result: JobResult): Promise<void> {
  const { id } = launch.spec;
  const record: JobRecord = {
    spec: launch.spec,
    pipeline: launch.pipeline,
    instance: launch.instance,
    startedAt: launch.startedAt,
    finishedAt: new Date().toISOString(),
    result,
  };
  await env.BUCKET.put(keys.job(id), JSON.stringify(record), { httpMetadata: { contentType: "application/json" } });
  const instance = await workflowOf(env, launch.pipeline).get(launch.instance);
  // The Workflow reads the outcome from the record; the payload only makes the event legible in the dashboard.
  await instance.sendEvent({ type: doneEvent(id), payload: { ok: result.ok } });
}
