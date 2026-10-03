/**
 * Cron only creates Workflow instances: it runs under the 15-minute cap of
 * scheduled handlers, and the work does not. The instance id is the schedule
 * slot, so a cron delivered twice starts one run.
 */

import * as v from "valibot";

import type { Env } from "./env.ts";
import { cronInstanceId } from "./ids.ts";
import { PIPELINE_NAMES, PIPELINES, runRequestSchema } from "./pipelines.ts";
import { createRun } from "./workflows.ts";

export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  const due = PIPELINE_NAMES.filter((p) => PIPELINES[p].cron === controller.cron);
  if (!due.length) throw new Error(`no pipeline is scheduled at "${controller.cron}"`);
  const slot = new Date(controller.scheduledTime);
  const started = await Promise.allSettled(
    due.map((pipeline) => createRun(env, v.parse(runRequestSchema, { pipeline }), cronInstanceId(pipeline, slot))),
  );
  const failed = started.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
  if (failed.length) throw new AggregateError(failed, `cron ${controller.cron}: ${failed.length} run(s) not started`);
}
