/**
 * What a container's Durable Object remembers about its job: the spec, which
 * Workflow instance waits for it, and its last progress. One DO per job (the
 * DO name is the job id), so the record never changes owner, and an outbound
 * call's ctx.containerId identifies the job with no further lookup.
 */

import * as v from "valibot";

import { parseJobSpec, progressSchema, type JobSpec, type Progress } from "../jobs.ts";
import { PIPELINE_NAMES, type PipelineName } from "./pipelines.ts";

export interface Launch {
  readonly spec: JobSpec;
  readonly pipeline: PipelineName;
  readonly instance: string;
  readonly startedAt: string;
  readonly progress?: Progress & { readonly at: string };
  readonly finishedAt?: string;
}

const launchSchema = v.object({
  spec: v.unknown(),
  pipeline: v.picklist(PIPELINE_NAMES),
  instance: v.string(),
  startedAt: v.string(),
  progress: v.exactOptional(v.object({ ...progressSchema.entries, at: v.string() })),
  finishedAt: v.exactOptional(v.string()),
});

/** A stored Launch, re-validated (its spec through parseJobSpec, so params stay typed by job type). */
export function parseLaunch(x: unknown): Launch {
  const { spec, ...rest } = v.parse(launchSchema, x);
  return { ...rest, spec: parseJobSpec(spec) };
}
