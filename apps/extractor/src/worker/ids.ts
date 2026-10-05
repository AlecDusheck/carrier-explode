/** Instance and job ids. Workflows take instance ids of up to 100 characters from [A-Za-z0-9_-]. */

import type { JobType } from "../jobs.ts";
import { stamp } from "../time.ts";
import { PIPELINE_NAMES, type PipelineName } from "./pipelines.ts";

const MAX = 100;

/** An instance named by what it extracts (`android-build-CP3A_260905_009`), so a check can never start it twice. */
export function instanceId(pipeline: PipelineName, unit: string): string {
  const id = `${pipeline}-${unit.replace(/[^\w-]/g, "_")}`;
  if (id.length > MAX) throw new Error(`instance id too long: ${id}`);
  return id;
}

/** A by-hand or publish instance: the time plus a random suffix, so two in one second do not collide. */
export const timedInstanceId = (pipeline: PipelineName, now: Date): string => instanceId(pipeline, `${stamp(now)}-${crypto.randomUUID().slice(0, 6)}`);

/** The pipeline an instance id belongs to, read back from its prefix. */
export const pipelineOfInstance = (id: string): PipelineName | undefined => PIPELINE_NAMES.find((p) => id.startsWith(`${p}-`));

/** `<run>:<type>:<unit>[.r<attempt>]`; the unit (`23C55.iPhone17,1`) keeps only word, dot and dash characters. */
export function jobId(run: string, type: JobType, unit: string | number, attempt: number): string {
  return `${run}:${type}:${String(unit).replace(/[^\w.-]/g, "_")}${attempt ? `.r${attempt}` : ""}`;
}
