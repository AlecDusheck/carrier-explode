/** One job from a Workflow: start its container, wait for jobs/<id>.json. A failed attempt retries under a fresh id (a fresh container). */

import type { WorkflowStep } from "cloudflare:workers";
import { getContainer } from "@cloudflare/containers";
import * as v from "valibot";

import { keys } from "@carrier-explode/storage";
import { describe } from "../errors.ts";
import { JOBS, jobRecordSchema, jobResultSchema, parseOutput, specOf, type JobOutput, type JobParams, type JobResult, type JobSpec, type JobType } from "../jobs.ts";
import type { Env } from "./env.ts";
import { jobId } from "./ids.ts";
import { poll, QUICK, start } from "./steps.ts";

export interface RunContext {
  readonly env: Env;
  readonly step: WorkflowStep;
  /** The instance id and this run of it: a restarted instance's jobs must not find the last run's records. */
  readonly run: string;
}

export class JobFailedError extends Error {
  override name = "JobFailedError";
  constructor(readonly type: JobType, readonly unit: string, readonly failures: readonly string[]) {
    super(`${type} ${unit} failed ${failures.length}×: ${failures.join(" | ")}`);
  }
}

/** A finished job: the id of the attempt that succeeded (its record is jobs/<id>.json) and its validated output. */
export interface Done<T extends JobType> {
  readonly id: string;
  readonly output: JobOutput<T>;
}

/**
 * Runs a job to its validated output, or throws JobFailedError after JOB_ATTEMPTS tries. `ready` runs each time the
 * job is about to start, so what it writes for the job is as fresh as the moment its container takes it.
 */
export async function runJob<T extends JobType>(
  c: RunContext, type: T, unit: string | number, params: JobParams<T>, ready: () => Promise<void> = async () => {},
): Promise<Done<T>> {
  const failures: string[] = [];
  for (let attempt = 0; attempt < c.env.JOB_ATTEMPTS; attempt++) {
    const spec = specOf(jobId(c.run, type, unit, attempt), type, params);
    const result = await attemptJob(c, spec, ready);
    if (result.ok) return { id: spec.id, output: parseOutput(type, result.output) };
    failures.push(`${spec.id}: ${result.error}`);
  }
  throw new JobFailedError(type, String(unit), failures);
}

function containerOf(env: Env, spec: JobSpec) {
  const { size, serial } = JOBS[spec.type];
  const name = serial ? spec.type : spec.id;
  return size === "heavy" ? getContainer(env.HEAVY, name) : getContainer(env.LIGHT, name);
}

/** jobs/<id>.json's result, as text: Json is too deep for the Serializable check on step results. */
async function recordedResult(env: Env, id: string): Promise<string | null> {
  const obj = await env.BUCKET.get(keys.job(id));
  return obj && JSON.stringify(v.parse(jobRecordSchema, await obj.json()).result);
}

async function attemptJob(c: RunContext, spec: JobSpec, ready: () => Promise<void>): Promise<JobResult> {
  const container = containerOf(c.env, spec);
  await c.step.do(`start ${spec.id}`, start(c.env.START_RETRY_MINUTES), async () => {
    if (await c.env.BUCKET.head(keys.job(spec.id))) return true;
    await c.env.BUCKET.put(keys.jobSpec(spec.id), JSON.stringify(spec), { httpMetadata: { contentType: "application/json" } });
    const busy = new Error(`${spec.type}'s container is running another job`);
    const running = await container.running();
    if (running === spec.id) return true;
    if (running !== null) throw busy;
    await ready();
    if (!(await container.run(spec.id))) throw busy;
    return true;
  });
  const timeout = JOBS[spec.type].timeout;
  try {
    const result = await c.step.do(`result ${spec.id}`, poll(timeout), async () => {
      const recorded = await recordedResult(c.env, spec.id);
      if (recorded !== null) return recorded;
      if (await container.up()) throw new Error(`${spec.id} is running`);
      // The job writes its record just before it exits.
      const late = await recordedResult(c.env, spec.id);
      const exited: JobResult = { ok: false, error: "the container exited without recording a result" };
      return late ?? JSON.stringify(exited);
    });
    return v.parse(jobResultSchema, JSON.parse(result));
  } catch (e) {
    await c.step.do(`stop ${spec.id}`, QUICK, async () => {
      await container.destroy();
      return true;
    });
    return { ok: false, error: `no result within ${timeout / 60_000} minutes: ${describe(e)}` };
  }
}
