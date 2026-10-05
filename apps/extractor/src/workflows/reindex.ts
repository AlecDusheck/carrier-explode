/** Every artifact decoded again (after a PROFILE_SCHEMA or MODEM_SUMMARY_SCHEMA bump, or a mapper fix), then a publish. */

import * as v from "valibot";

import type { Json } from "@carrier-explode/schema/types";
import { PIPELINES } from "../worker/pipelines.ts";
import type { RunContext } from "../worker/run-job.ts";
import { QUICK } from "../worker/steps.ts";
import { Pipeline, settle } from "./pipeline.ts";
import { normalizeShards, requestPublish, summaryShards } from "./tail.ts";

export class ReindexWorkflow extends Pipeline {
  protected async steps(c: RunContext, payload: unknown): Promise<Json> {
    const { shards = c.env.REINDEX_SHARDS, force = false } = v.parse(PIPELINES.reindex.params, payload);
    // Forced, it rewrites what predates its start; a retried job keeps what an earlier attempt wrote.
    const rewriteBefore = force ? await c.step.do("start time", QUICK, async () => new Date().toISOString()) : undefined;
    const [profiles, modems] = await Promise.all([normalizeShards(c, shards, rewriteBefore), summaryShards(c, shards, rewriteBefore)]);
    const publish = await requestPublish(c, force);
    return settle(
      { profiles: profiles.written, modems: modems.written, skipped: profiles.skipped + modems.skipped, publish },
      [...profiles.failed, ...modems.failed],
    );
  }
}
