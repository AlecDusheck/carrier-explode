/** The retry policies of a job's steps. */

import type { WorkflowStepConfig } from "cloudflare:workers";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Starting fails while every container of the class is running (max_instances), or a one-at-a-time job's is: try every minute. */
export const start = (minutes: number): WorkflowStepConfig => ({ retries: { limit: minutes, delay: MINUTE, backoff: "constant" }, timeout: 5 * MINUTE });

/** Reads a job's record once a minute until `timeoutMs` has passed. */
export const poll = (timeoutMs: number): WorkflowStepConfig => ({
  retries: { limit: Math.ceil(timeoutMs / MINUTE), delay: MINUTE, backoff: "constant" },
  timeout: MINUTE,
});

export const QUICK: WorkflowStepConfig = { retries: { limit: 5, delay: 5 * SECOND, backoff: "exponential" }, timeout: 2 * MINUTE };
