/**
 * One job, from a Workflow: start its container, wait for /done, read the
 * outcome, stop the container. A timeout or a failure retries the job under a
 * fresh id (`.r1`, `.r2`): a fresh Durable Object and container, since the
 * old one may be wedged, and job code is idempotent by contract.
 *
 * Steps are named by job id, so a replayed Workflow skips what already ran.
 */

import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { getContainer } from "@cloudflare/containers";
import * as v from "valibot";

import { keys } from "../../../src/lib/storage/keys.ts";
import { JOBS, jobResultSchema, parseOutput, specOf, type JobOutput, type JobParams, type JobResult, type JobSpec, type JobType } from "../jobs.ts";
import type { Env } from "./env.ts";
import { doneEvent, jobId } from "./ids.ts";
import type { PipelineName } from "./pipelines.ts";

export interface RunContext {
  readonly env: Env;
  readonly step: WorkflowStep;
  readonly pipeline: PipelineName;
  readonly instance: string;
}

const ATTEMPTS = 3;

/** Starting can fail while every instance of the class is busy (max_instances): back off and try again. */
const START: WorkflowStepConfig = { retries: { limit: 6, delay: "1 minute", backoff: "exponential" }, timeout: "10 minutes" };
const QUICK: WorkflowStepConfig = { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" };

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

/** Runs a job to its validated output, or throws JobFailedError after ATTEMPTS tries. */
export async function runJob<T extends JobType>(c: RunContext, type: T, unit: string | number, params: JobParams<T>): Promise<Done<T>> {
  const failures: string[] = [];
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const spec = specOf(jobId(c.instance, type, unit, attempt), type, params);
    const result = await attemptJob(c, spec);
    if (result.ok) return { id: spec.id, output: parseOutput(type, result.output) };
    failures.push(`${spec.id}: ${result.error}`);
  }
  throw new JobFailedError(type, String(unit), failures);
}

const stubOf = (env: Env, spec: JobSpec) =>
  JOBS[spec.type].size === "heavy" ? getContainer(env.HEAVY, spec.id) : getContainer(env.LIGHT, spec.id);

async function attemptJob(c: RunContext, spec: JobSpec): Promise<JobResult> {
  await c.step.do(`start ${spec.id}`, START, async () => {
    await stubOf(c.env, spec).launch({ spec, pipeline: c.pipeline, instance: c.instance, startedAt: new Date().toISOString() });
    return spec.id;
  });
  const timeout = JOBS[spec.type].timeout;
  let missed: string | undefined;
  try {
    await c.step.waitForEvent(`wait ${spec.id}`, { type: doneEvent(spec.id), timeout });
  } catch (e) {
    // waitForEvent throws when its timeout passes: the attempt failed, and the error says why.
    missed = `no /done within ${timeout}: ${e instanceof Error ? e.message : String(e)}`;
  }
  await c.step.do(`stop ${spec.id}`, QUICK, async () => {
    await stubOf(c.env, spec).stop();
    return true;
  });
  if (missed !== undefined) return { ok: false, error: missed };
  // The step returns the record as text: Json is too deep for the Serializable check on step results.
  const record = await c.step.do(`result ${spec.id}`, QUICK, () => readRecord(c.env, spec.id));
  return v.parse(recordSchema, JSON.parse(record)).result;
}

const recordSchema = v.object({ result: jobResultSchema });

/** jobs/<id>.json; /done writes it before it sends the event, so it is there. */
async function readRecord(env: Env, id: string): Promise<string> {
  const obj = await env.BUCKET.get(keys.job(id));
  if (!obj) throw new Error(`${keys.job(id)} missing after its done event`);
  return obj.text();
}
