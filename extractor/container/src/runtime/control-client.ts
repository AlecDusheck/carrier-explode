/** The job's side of control.internal (protocol: ../../../src/protocol/control.ts). */

import { fetchWithRetry, type RetryOptions } from "../../../../src/lib/http/index.ts";
import type { JobResult, Progress } from "../../../src/jobs.ts";

export interface ControlClient {
  progress(p: Progress): Promise<void>;
  done(result: JobResult): Promise<void>;
}

/** /done is what ends the Workflow's wait, so it gets more attempts than a heartbeat. */
const DONE_TRIES = 10;

export function createControlClient(base: string, retry: RetryOptions = {}): ControlClient {
  const post = async (path: string, body: unknown, tries?: number): Promise<void> => {
    const res = await fetchWithRetry(new URL(path, base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, tries === undefined ? retry : { ...retry, tries });
    await res.body?.cancel();
  };
  return {
    progress: (p) => post("/progress", p),
    done: (result) => post("/done", result, DONE_TRIES),
  };
}
