/**
 * publish: the index's statements against D1 as the Worker read it (params.live), staged in batches for the Worker to
 * apply, then the scan index. Nothing when an index built since `requested` is already applied.
 */

import { batches, delta, indexRows, liveSchema } from "@carrier-explode/db";
import { keys } from "@carrier-explode/storage";
import type { JobContext } from "../job.ts";
import type { JobOutput } from "../../../src/jobs.ts";
import { buildIndex } from "./build-index.ts";
import { scan } from "./scan.ts";
import { readRecord } from "./shared/records.ts";

export async function publish(ctx: JobContext<"publish">): Promise<JobOutput<"publish">> {
  const { requested, force, live: liveKey } = ctx.spec.params;
  const live = await readRecord(ctx.r2, liveKey, liveSchema);
  if (live === null) throw new Error(`${liveKey}: missing; the Workflow writes it before starting the job`);
  if (!force && live.builtAt !== null && live.builtAt >= requested) {
    ctx.log(`the index applied was built at ${live.builtAt}, after ${requested}`);
    return { kind: "current" };
  }
  const index = await buildIndex(ctx, live);
  const { statements, changed } = await delta(indexRows(index), live);
  const staged = batches(statements);
  for (const [n, batch] of staged.entries()) await ctx.r2.putJson(keys.staging(ctx.spec.id, `batch-${n}.json`), batch);
  ctx.log(`${staged.length} batches, ${staged.reduce((sum, b) => sum + b.length, 0)} statements`);
  return {
    kind: "built",
    builtAt: live.readAt,
    batches: staged.length,
    releases: index.releases.length,
    carriers: index.carriers.length,
    countries: index.countries.length,
    sources: Object.keys(index.sources).length,
    scan: await scan(ctx, index),
    changed: changed === "everything" ? changed : [...changed],
  };
}
