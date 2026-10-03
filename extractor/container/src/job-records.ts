/**
 * Reading another job's output from its record (jobs/<id>.json, written by
 * the Worker at /done), for jobs whose inputs are too big to travel as params:
 * ios.release reads its build's ios.ipsw outputs this way.
 */

import * as v from "valibot";

import { keys } from "../../../src/lib/storage/keys.ts";
import { jobResultSchema, parseOutput, type JobOutput, type JobType } from "../../src/jobs.ts";
import type { R2Client } from "./job.ts";

const recordSchema = v.object({ result: jobResultSchema });

export async function readJobOutput<T extends JobType>(r2: R2Client, id: string, type: T): Promise<JobOutput<T>> {
  const raw = await r2.getJson(keys.job(id));
  if (raw === null) throw new Error(`${keys.job(id)}: no such job record`);
  const { result } = v.parse(recordSchema, raw);
  if (!result.ok) throw new Error(`${id} failed: ${result.error}`);
  return parseOutput(type, result.output);
}
