/** Every artifact through the mappers again (after a PROFILE_SCHEMA bump or a mapper fix), then the tail. */

import * as v from "valibot";

import type { Json } from "../../../src/lib/schema/index.ts";
import { PIPELINES } from "../worker/pipelines.ts";
import type { RunContext } from "../worker/run-job.ts";
import { Pipeline, settle } from "./pipeline.ts";
import { normalizeAll, publish } from "./publish.ts";

const DEFAULT_SHARDS = 8;

export class ReindexPipeline extends Pipeline {
  protected readonly pipeline = "reindex";

  protected async steps(c: RunContext, payload: unknown): Promise<Json> {
    const { shards = DEFAULT_SHARDS, force = false } = v.parse(PIPELINES.reindex.params, payload);
    const normalized = await normalizeAll(c, shards, force);
    const published = await publish(c, { force });
    return settle({ profiles: normalized.written, skipped: normalized.skipped, carriers: published.index.carriers }, normalized.failed);
  }
}
