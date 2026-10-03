/** A job's end: its record in R2 first, then the event its Workflow waits on, which reads that record. */

import { keys } from "../../../src/lib/storage/keys.ts";
import type { JobRecord, JobResult } from "../jobs.ts";
import type { Env } from "./env.ts";
import { doneEvent } from "./ids.ts";
import type { Launch } from "./launch.ts";
import { workflowOf } from "./workflows.ts";

/** The payload of a done event: only whether to read an output or an error from jobs/<id>.json. */
interface DoneEvent {
  readonly ok: boolean;
}

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
  await instance.sendEvent({ type: doneEvent(id), payload: { ok: result.ok } satisfies DoneEvent });
}
