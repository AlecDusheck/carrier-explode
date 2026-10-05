/** Another job's output, from its record: for inputs too big to travel as params (ios.release, android.release). */

import { keys } from "@carrier-explode/storage";
import { jobRecordSchema, parseOutput, type JobOutput, type JobType } from "../../src/jobs.ts";
import type { R2Client } from "./job.ts";
import { readRecord } from "./jobs/shared/records.ts";

export async function readJobOutput<T extends JobType>(r2: R2Client, id: string, type: T): Promise<JobOutput<T>> {
  const record = await readRecord(r2, keys.job(id), jobRecordSchema);
  if (!record) throw new Error(`${keys.job(id)}: no such job record`);
  if (!record.result.ok) throw new Error(`${id} failed: ${record.result.error}`);
  return parseOutput(type, record.result.output);
}
