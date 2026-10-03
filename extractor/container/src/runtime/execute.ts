/**
 * Runs one job to a JobResult: never throws. The output is validated against
 * the job type's schema here, so a runner that drifts from the contract fails
 * in the container, with its own job id in the error, not later in the Workflow.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Json } from "../../../../src/lib/schema/index.ts";
import { parseOutput, type AnyJobSpec, type JobOutput, type JobResult, type JobSpec, type JobType } from "../../../src/jobs.ts";
import type { RunnerTable } from "../job.ts";
import { createContext, type Deps } from "./context.ts";

export type Registry = RunnerTable<JobType>;

async function dispatch<T extends JobType>(registry: Registry, spec: JobSpec<T>, tmp: string, deps: Deps): Promise<JobOutput<T>> {
  const ctx = createContext(spec, tmp, deps);
  try {
    const runner: Registry[T] = registry[spec.type];
    return parseOutput(spec.type, await runner(ctx));
  } finally {
    ctx.close();
  }
}

const message = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e));

export async function executeJob(registry: Registry, spec: AnyJobSpec, deps: Deps, tmpRoot = tmpdir()): Promise<JobResult> {
  const tmp = await mkdtemp(join(tmpRoot, "job-"));
  try {
    const output: Json = await dispatch(registry, spec, tmp, deps);
    return { ok: true, output };
  } catch (e) {
    deps.log(`[${spec.id}] failed: ${message(e)}`);
    return { ok: false, error: message(e) };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
