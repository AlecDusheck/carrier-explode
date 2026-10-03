/** The index alone, from what is stored: after a change to the index builder. */

import * as v from "valibot";

import type { Json } from "../../../src/lib/schema/index.ts";
import { PIPELINES } from "../worker/pipelines.ts";
import { runJob, type RunContext } from "../worker/run-job.ts";
import { Pipeline } from "./pipeline.ts";
import { purgeStep } from "./publish.ts";

export class IndexPipeline extends Pipeline {
  protected readonly pipeline = "index";

  protected async steps(c: RunContext, payload: unknown): Promise<Json> {
    v.parse(PIPELINES.index.params, payload);
    const index = await runJob(c, "index", "all", {});
    await purgeStep(c);
    return index.output;
  }
}
