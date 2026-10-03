/**
 * Fan-out with a concurrency cap, for Workflows: at most `limit` jobs of a
 * kind in flight, so a run never asks for more containers than the class's
 * max_instances. Failures are collected, not thrown, so one bad IPSW does not
 * cancel its siblings; the pipeline decides what a failure means.
 */

import type { JobTraits } from "../jobs.ts";

/** Keep equal to wrangler.jsonc containers[].max_instances. */
export const MAX_INSTANCES = { heavy: 6, light: 16 } as const satisfies Record<JobTraits["size"], number>;

export type Settled<O> = { readonly ok: true; readonly value: O } | { readonly ok: false; readonly error: string };

export async function fanOut<I, O>(items: readonly I[], limit: number, fn: (item: I) => Promise<O>): Promise<Settled<O>[]> {
  const out: Settled<O>[] = [];
  // One iterator shared by every worker: each next() hands out the next unclaimed item.
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [i, item] of queue) {
      try {
        out[i] = { ok: true, value: await fn(item) };
      } catch (e) {
        out[i] = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** The values of the settled results that succeeded. */
export const succeeded = <O>(results: readonly Settled<O>[]): O[] => results.flatMap((r) => (r.ok ? [r.value] : []));

/** The errors of the ones that failed. */
export const failures = <O>(results: readonly Settled<O>[]): string[] => results.flatMap((r) => (r.ok ? [] : [r.error]));
