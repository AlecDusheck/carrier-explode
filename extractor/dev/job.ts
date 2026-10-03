/**
 * Runs one job in-process against a directory standing in for R2:
 *
 *   pnpm --dir extractor job <type> [--params '{...}'] [--r2 .r2] [--id <job id>]
 *
 * The job gets the real runtime (R2 client, control client, context,
 * executor) pointed at fake r2.internal / control.internal servers, so what
 * passes here passes the same protocol checks in a container, write scoping
 * included. Prints the output; exits 1 when the job fails.
 */

import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { JOB_TYPES, JOBS, isJobType, parseJobSpec } from "../src/jobs.ts";
import { RUNNERS } from "../container/src/jobs/index.ts";
import { createControlClient } from "../container/src/runtime/control-client.ts";
import { executeJob } from "../container/src/runtime/execute.ts";
import { createR2Client } from "../container/src/runtime/r2-client.ts";
import { startFakeServers } from "./fake-servers.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    params: { type: "string", default: "{}" },
    r2: { type: "string", default: ".r2" },
    id: { type: "string" },
  },
});

const [type] = positionals;
if (type === undefined || !isJobType(type)) {
  process.stderr.write(`usage: job <type> [--params JSON] [--r2 DIR] [--id ID]\n  type: ${JOB_TYPES.join(", ")}\n`);
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
const spec = parseJobSpec({ id: values.id ?? `dev-${stamp}:${type}:0`, type, params: JSON.parse(values.params) });
const dir = resolve(values.r2);
const log = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const fake = await startFakeServers({
  dir,
  spec,
  scope: { writes: JOBS[spec.type].writes },
  onProgress: (p) => log(`progress ${p.done}/${p.total}${p.note ? ` ${p.note}` : ""}`),
});
try {
  const control = createControlClient(fake.control, { tries: 2, backoff: 100 });
  const result = await executeJob(RUNNERS, spec, { r2: createR2Client(fake.r2), control, log });
  await control.done(result);
  if (!result.ok) {
    log(`${spec.id} failed`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
  }
} finally {
  await fake.close();
}
