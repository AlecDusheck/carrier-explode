/**
 * Fan-out with a concurrency cap: Workflows keep jobs within max_instances, jobs
 * bound parallel R2 reads. Failures are collected per item, never thrown.
 */

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
        out[i] = { item, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const succeeded = <O>(results: readonly Settled<O>[]): O[] => results.flatMap((r) => (r.ok ? [r.value] : []));

export const failures = <O>(results: readonly Settled<O>[]): string[] => results.flatMap((r) => (r.ok ? [] : [r.error]));
