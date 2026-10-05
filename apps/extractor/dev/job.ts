/** Runs one job in-process against a bucket in a directory: `pnpm --filter @carrier-explode/extractor job <type> [--params JSON] [--r2 .r2]`. */

import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { JOB_TYPES, isJobType, parseJobSpec } from "../src/jobs.ts";
import { stamp } from "../src/time.ts";
import { RUNNERS } from "../container/src/jobs/index.ts";
import { executeJob } from "../container/src/runtime/execute.ts";
import { dirR2Client } from "./dir-r2.ts";

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

const spec = parseJobSpec({ id: values.id ?? `dev-${stamp(new Date())}:${type}:0`, type, params: JSON.parse(values.params) });
const log = (line: string): void => {
  process.stderr.write(`${line}\n`);
};
const result = await executeJob(RUNNERS, spec, { r2: dirR2Client(resolve(values.r2)), log });
if (result.ok) process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
else {
  log(`${spec.id} failed`);
  process.exitCode = 1;
}
