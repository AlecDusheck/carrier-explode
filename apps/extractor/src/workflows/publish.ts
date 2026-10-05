/**
 * One publish: the publish job, given D1's live hashes to diff against as it starts (index statements, then the scan index),
 * each statement batch applied in order, then the site's and the API's caches purged.
 */

import * as v from "valibot";

import { statementSchema } from "@carrier-explode/db";
import { indexDb, liveIndex } from "@carrier-explode/db/d1";
import type { Json } from "@carrier-explode/schema/types";
import { keys, purgeFor } from "@carrier-explode/storage";
import { PIPELINES } from "../worker/pipelines.ts";
import { purgeReaders } from "../worker/purge.ts";
import { runJob, type RunContext } from "../worker/run-job.ts";
import { QUICK } from "../worker/steps.ts";
import { Pipeline, settle } from "./pipeline.ts";

const batchSchema = v.array(statementSchema);

export class PublishWorkflow extends Pipeline {
  protected async steps(c: RunContext, payload: unknown): Promise<Json> {
    const params = v.parse(PIPELINES.publish.params, payload);
    const live = keys.staging(c.run, "live.json");
    // Read as the container takes the job, so a publish queued behind another sees what that one applied.
    const readLive = async (): Promise<void> => {
      // The primary: a replica may not hold the last publish yet.
      await c.env.BUCKET.put(live, JSON.stringify(await liveIndex(indexDb(c.env.DB.withSession("first-primary")))));
    };
    const { id, output } = await runJob(c, "publish", "all", { ...params, live }, readLive);
    if (output.kind === "current") return output;

    for (let n = 0; n < output.batches; n++) {
      await c.step.do(`apply batch ${n}`, QUICK, async () => {
        const key = keys.staging(id, `batch-${n}.json`);
        const obj = await c.env.BUCKET.get(key);
        if (!obj) throw new Error(`${key}: missing; the publish job staged it`);
        const statements = v.parse(batchSchema, await obj.json());
        await c.env.DB.batch(statements.map((s) => c.env.DB.prepare(s.sql).bind(...s.params)));
        return statements.length;
      });
    }
    // A step of its own, so a replay does not purge twice.
    await c.step.do("purge", QUICK, () => purgeReaders(c.env, purgeFor(output.changed)));
    const { scan } = output;
    return settle(output, scan.failed ? [`scan: ${scan.failed} of ${scan.sources + scan.failed} sources failed`] : []);
  }
}
