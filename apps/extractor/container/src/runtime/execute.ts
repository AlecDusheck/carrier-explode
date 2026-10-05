/** Runs one job to a JobResult and never throws; the output is validated here, so contract drift fails with the job's id. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Json } from "@carrier-explode/schema";
import { parseOutput, type AnyJobSpec, type JobOutput, type JobResult, type JobSpec, type JobType } from "../../../src/jobs.ts";
import { describe } from "../../../src/errors.ts";
import type { Runners } from "../job.ts";
import { createContext, type Deps } from "./context.ts";

async function dispatch<T extends JobType>(runners: Runners, spec: JobSpec<T>, tmp: string, deps: Deps): Promise<JobOutput<T>> {
  const runner: Runners[T] = runners[spec.type];
  return parseOutput(spec.type, await runner(createContext(spec, tmp, deps)));
}

export async function executeJob(runners: Runners, spec: AnyJobSpec, deps: Deps): Promise<JobResult> {
  const tmp = await mkdtemp(join(tmpdir(), "job-"));
  try {
    const output: Json = await dispatch(runners, spec, tmp, deps);
    return { ok: true, output };
  } catch (e) {
    // The stack stays in the log; the result travels into run errors, which join many of them.
    deps.log(`[${spec.id}] failed: ${e instanceof Error ? (e.stack ?? e.message) : describe(e)}`);
    return { ok: false, error: describe(e) };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
