/** Fan-out with a concurrency cap. Failures are collected per item, never thrown. */

import { describe } from "./errors.ts";

export type Settled<O, I = unknown> = { readonly item: I } & (
  | { readonly ok: true; readonly value: O }
  | { readonly ok: false; readonly error: string }
);

export async function fanOut<I, O>(items: readonly I[], limit: number, fn: (item: I) => Promise<O>): Promise<Settled<O, I>[]> {
  const out: Settled<O, I>[] = [];
  // Shared by every worker: each next() claims the next item.
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [i, item] of queue) {
      try {
        out[i] = { item, ok: true, value: await fn(item) };
      } catch (e) {
        out[i] = { item, ok: false, error: describe(e) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const succeeded = <O>(results: readonly Settled<O>[]): O[] => results.flatMap((r) => (r.ok ? [r.value] : []));

export const failures = <O>(results: readonly Settled<O>[]): string[] => results.flatMap((r) => (r.ok ? [] : [r.error]));

/** The values, or one error naming the failures: a partial read must not pass as whole. */
export function allOrThrow<O>(what: string, results: readonly Settled<O>[]): O[] {
  const failed = failures(results);
  if (failed.length) throw new Error(`${what}: ${failed.length} failed: ${failed.slice(0, 5).join(" | ")}`);
  return succeeded(results);
}
