/** What extraction ends with: profiles for what it stored, then a publish. */

import { deviceRecords, indexDb } from "@carrier-explode/db/d1";
import { boardProducts } from "@carrier-explode/schema";
import type { JobOutput } from "../jobs.ts";
import { fanOut, failures, succeeded, type Settled } from "../fan-out.ts";
import { runJob, type RunContext } from "../worker/run-job.ts";
import { QUICK } from "../worker/steps.ts";
import { createRun, publishRun } from "../worker/workflows.ts";

/** The jobs that process every artifact of a kind, in shards. */
type Sharded = "normalize" | "ios.modem-summaries";

export interface Totals {
  readonly written: number;
  readonly skipped: number;
  /** Failed jobs, and single artifacts that failed inside a job. */
  readonly failed: readonly string[];
}

const chunks = <T>(xs: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

/** Which phone each Apple board is, as D1's device records say when the step runs: normalize names override files' phones by it. */
const boardsNow = (c: RunContext): Promise<Record<string, string>> =>
  c.step.do("board products", QUICK, async () => Object.fromEntries(boardProducts(await deviceRecords(indexDb(c.env.DB), "apple"))));

export async function normalizeShas(c: RunContext, shas: readonly string[]): Promise<Totals> {
  const boards = await boardsNow(c);
  const parts = chunks([...new Set(shas)].sort(), c.env.NORMALIZE_CHUNK).map((chunk, i) => ({ chunk, i }));
  const results = await fanOut(parts, parts.length, async ({ chunk, i }) => (await runJob(c, "normalize", i, { shas: chunk, boards })).output);
  return totals("normalize", results);
}

const shardsOf = (of: number): number[] => Array.from({ length: of }, (_, shard) => shard);

/** Every artifact normalize reads, in `of` shards; with `rewriteBefore`, also those already normalized before it. */
export async function normalizeShards(c: RunContext, of: number, rewriteBefore: string | undefined): Promise<Totals> {
  const boards = await boardsNow(c);
  const rewrite = rewriteBefore === undefined ? {} : { rewriteBefore };
  const results = await fanOut(shardsOf(of), of, async (shard) => (await runJob(c, "normalize", `shard${shard}`, { shard, of, boards, ...rewrite })).output);
  return totals("normalize", results);
}

/** Every modem package summarised, in `of` shards; with `rewriteBefore`, also those already summarised before it. */
export async function summaryShards(c: RunContext, of: number, rewriteBefore: string | undefined): Promise<Totals> {
  const rewrite = rewriteBefore === undefined ? {} : { rewriteBefore };
  const results = await fanOut(shardsOf(of), of, async (shard) => (await runJob(c, "ios.modem-summaries", `shard${shard}`, { shard, of, ...rewrite })).output);
  return totals("ios.modem-summaries", results);
}

function totals(type: Sharded, results: readonly Settled<JobOutput<Sharded>>[]): Totals {
  const outs = succeeded(results);
  return {
    written: outs.reduce((n, o) => n + o.written, 0),
    skipped: outs.reduce((n, o) => n + o.skipped, 0),
    failed: [
      ...failures(results),
      ...outs.flatMap((o) => [
        ...o.failures.map((f) => `${type} ${f.sha}: ${f.error}`),
        ...(o.failed > o.failures.length ? [`${type}: ${o.failed - o.failures.length} more`] : []),
      ]),
    ],
  };
}

/** Starts a publish of the bucket as it is now. */
export function requestPublish(c: RunContext, force = false): Promise<string> {
  return c.step.do("request publish", async () => {
    const run = publishRun(new Date(), force);
    await createRun(c.env, run);
    return run.id;
  });
}
