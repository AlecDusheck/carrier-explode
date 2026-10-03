/**
 * Names that must be stable across Workflow replays and short enough for
 * Workflows (instance ids and event types are capped at 100 characters, and
 * event types to [A-Za-z0-9_-]).
 */

import type { JobType } from "../jobs.ts";
import type { PipelineName } from "./pipelines.ts";

const MAX = 100;

/** `20261003T051700`, UTC. */
const stamp = (t: Date): string => t.toISOString().replace(/[-:]/g, "").slice(0, 15);

/** A cron run's id is its schedule slot, so a cron that fires twice creates one instance. */
export const cronInstanceId = (pipeline: PipelineName, scheduled: Date): string => `${pipeline}-${stamp(scheduled)}`;

/** A manual run's id: the time plus a random suffix, so two runs in one second do not collide. */
export const manualInstanceId = (pipeline: PipelineName, now: Date): string =>
  `${pipeline}-${stamp(now)}-${crypto.randomUUID().slice(0, 6)}`;

/** The pipeline an instance id belongs to, read back from its prefix (longest name first: "index" is not "ios-..."). */
export function pipelineOfInstance(id: string, names: readonly PipelineName[]): PipelineName | undefined {
  return [...names].sort((a, b) => b.length - a.length).find((p) => id.startsWith(`${p}-`));
}

/**
 * `<instance>:<type>:<n>` plus `.r<k>` for retries. `n` names the unit within
 * the run (`23C55.iPhone17_1`, `3`); characters other than word, dot and dash
 * become `_`.
 */
export function jobId(instance: string, type: JobType, n: string | number, attempt: number): string {
  const unit = String(n).replace(/[^\w.-]/g, "_");
  const id = `${instance}:${type}:${unit}${attempt ? `.r${attempt}` : ""}`;
  if (doneEvent(id).length > MAX) throw new Error(`job id too long for a Workflow event type: ${id}`);
  return id;
}

/** The type of the Workflow event /done sends for a job. */
export const doneEvent = (id: string): string => `done-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/** The job type inside a job id. */
export function typeOfJobId(id: string): string | undefined {
  return id.split(":")[1];
}
