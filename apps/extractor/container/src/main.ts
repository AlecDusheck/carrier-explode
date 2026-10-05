/** The container entry point: runs job JOB_ID from its spec in R2, writes jobs/<id>.json, exits. On SIGTERM a running job records failure, so the Workflow retries it at once. */

import { keys } from "@carrier-explode/storage";
import { parseJobSpec, type JobRecord, type JobResult } from "../../src/jobs.ts";
import { RUNNERS } from "./jobs/index.ts";
import { executeJob } from "./runtime/execute.ts";
import { createR2Client } from "./runtime/r2-client.ts";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const log = (line: string): void => {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
};

const r2 = createR2Client({
  endpoint: env("R2_ENDPOINT"), bucket: env("R2_BUCKET"), accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
});
const id = env("JOB_ID");
const spec = parseJobSpec(await r2.getJson(keys.jobSpec(id)));
if (spec.id !== id) throw new Error(`${keys.jobSpec(id)} holds ${spec.id}`);
const startedAt = new Date().toISOString();

/** The first result is the record; a SIGTERM after it only waits for it. */
let recorded: Promise<void> | undefined;
const record = (result: JobResult): Promise<void> => {
  const r: JobRecord = { spec, startedAt, finishedAt: new Date().toISOString(), result };
  return (recorded ??= r2.putJson(keys.job(spec.id), r));
};

process.once("SIGTERM", () => {
  log(`[${spec.id}] SIGTERM`);
  void record({ ok: false, error: "container stopped (SIGTERM) before the job finished" }).finally(() => process.exit(1));
});

log(`[${spec.id}] start ${spec.type}`);
const result = await executeJob(RUNNERS, spec, { r2, log });
await record(result);
process.exit(result.ok ? 0 : 1);
