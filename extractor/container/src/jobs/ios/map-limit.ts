/** Runs `fn` over `items`, at most `limit` at a time, results in input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  // One iterator shared by every worker: each next() hands out the next unclaimed item.
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [i, item] of queue) out[i] = await fn(item);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
