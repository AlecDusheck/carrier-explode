/**
 * The tail every ingest pipeline shares: normalize what is new, rebuild the
 * index, tell the site, rebuild the scan.
 */

import type { JobOutput } from "../jobs.ts";
import { fanOut, failures, succeeded, type Settled } from "../fan-out.ts";
import { MAX_INSTANCES } from "../worker/instances.ts";
import { purgeSite } from "../worker/purge.ts";
import { runJob, type RunContext } from "../worker/run-job.ts";

/** Shas per normalize job: keeps the spec (stored in the container's Durable Object) far under its value limit. */
const NORMALIZE_CHUNK = 500;

export interface Normalized {
  readonly written: number;
  readonly skipped: number;
  readonly failed: readonly string[];
}

const chunks = <T>(xs: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

/** Profiles for `shas`; failures (a job, or single artifacts inside one) are listed, not thrown. */
export async function normalizeShas(c: RunContext, shas: readonly string[], force = false): Promise<Normalized> {
  const unique = [...new Set(shas)].sort();
  const parts = chunks(unique, NORMALIZE_CHUNK).map((chunk, i) => ({ chunk, i }));
  const results = await fanOut(parts, MAX_INSTANCES.light, async ({ chunk, i }) =>
    (await runJob(c, "normalize", i, { shas: chunk, ...(force ? { force } : {}) })).output);
  return totals(results);
}

/** Every artifact, in `of` shards: the reindex pipeline. */
export async function normalizeAll(c: RunContext, of: number, force: boolean): Promise<Normalized> {
  const shards = Array.from({ length: of }, (_, shard) => shard);
  const results = await fanOut(shards, MAX_INSTANCES.light, async (shard) =>
    (await runJob(c, "normalize", `shard${shard}`, { all: true, shard, of, ...(force ? { force } : {}) })).output);
  return totals(results);
}

function totals(results: readonly Settled<JobOutput<"normalize">>[]): Normalized {
  const outs = succeeded(results);
  return {
    written: outs.reduce((n, o) => n + o.written, 0),
    skipped: outs.reduce((n, o) => n + o.skipped, 0),
    failed: [...failures(results), ...outs.flatMap((o) => o.failed.map((f) => `normalize ${f.sha}: ${f.error}`))],
  };
}

export interface Published {
  readonly index: JobOutput<"index">;
  readonly scan: JobOutput<"scan"> | null;
}

/** index → purge → scan (when asked). The index is what the site reads, so the purge follows it directly. */
export async function publish(c: RunContext, scan: { readonly force: boolean } | null): Promise<Published> {
  const index = await runJob(c, "index", "all", {});
  await purgeStep(c);
  if (!scan) return { index: index.output, scan: null };
  const built = await runJob(c, "scan", "all", scan.force ? { force: true } : {});
  return { index: index.output, scan: built.output };
}

/** The site's cache purge, as a step of its own so a replay does not purge twice. */
export function purgeStep(c: RunContext): Promise<boolean> {
  return c.step.do("purge", { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "1 minute" }, () => purgeSite(c.env));
}
