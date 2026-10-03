/**
 * JobContext over the runtime's clients. Progress is throttled (every call
 * is a Worker request and a Durable Object call), and a heartbeat repeats the
 * last progress while a job is quiet, so a job that never reports still keeps
 * its container from sleeping.
 */

import type { JobSpec, JobType, Progress } from "../../../src/jobs.ts";
import type { JobContext, R2Client } from "../job.ts";
import type { ControlClient } from "./control-client.ts";

const MIN_PROGRESS_MS = 10_000;
const HEARTBEAT_MS = 60_000;

export interface Deps {
  readonly r2: R2Client;
  readonly control: ControlClient;
  readonly log: (line: string) => void;
}

/** A context plus `close`, which stops its heartbeat. */
export function createContext<T extends JobType>(spec: JobSpec<T>, tmp: string, deps: Deps): JobContext<T> & { close(): void } {
  let last: Progress = { done: 0, total: 0 };
  let sentAt = 0;
  const send = async (p: Progress): Promise<void> => {
    sentAt = Date.now();
    await deps.control.progress(p);
  };
  const heartbeat = setInterval(() => {
    if (Date.now() - sentAt < HEARTBEAT_MS) return;
    // A missed heartbeat only costs keep-alive margin; it must not fail the job, but it is reported.
    send(last).catch((e: unknown) => deps.log(`heartbeat failed: ${e instanceof Error ? e.message : String(e)}`));
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    spec,
    tmp,
    r2: deps.r2,
    log: (message) => deps.log(`[${spec.id}] ${message}`),
    async progress(done, total, note) {
      last = { done, total, ...(note !== undefined ? { note } : {}) };
      if (done < total && Date.now() - sentAt < MIN_PROGRESS_MS) return;
      await send(last);
    },
    close: () => clearInterval(heartbeat),
  };
}
