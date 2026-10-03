/**
 * The container's entry point (bundled by ../build.mjs into dist/main.mjs).
 *
 * SIGTERM (the host is restarting, or the Workflow stopped the container):
 * a running job reports failure at once, so the Workflow retries it now rather
 * than when its wait times out; jobs are idempotent, so the retry is safe.
 */

import { RUNNERS } from "./jobs/index.ts";
import { createControlClient } from "./runtime/control-client.ts";
import { createR2Client } from "./runtime/r2-client.ts";
import { endpointsFromEnv } from "./runtime/endpoints.ts";
import { startRuntime } from "./runtime/server.ts";

const PORT = 8080;

const endpoints = endpointsFromEnv(process.env);
const control = createControlClient(endpoints.control);
const log = (line: string): void => {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
};
const runtime = startRuntime(RUNNERS, { r2: createR2Client(endpoints.r2), control, log }, PORT);
log(`listening on ${PORT}, job ${process.env["JOB_ID"] ?? "(none yet)"}`);

process.once("SIGTERM", () => {
  runtime.server.close();
  const job = runtime.running();
  log(`SIGTERM${job ? ` during ${job.id}` : ""}`);
  if (!job) process.exit(0);
  control
    .done({ ok: false, error: "container stopped (SIGTERM) before the job finished" })
    .catch((e: unknown) => log(`SIGTERM: /done not delivered: ${e instanceof Error ? e.message : String(e)}`))
    .finally(() => process.exit(0));
});
