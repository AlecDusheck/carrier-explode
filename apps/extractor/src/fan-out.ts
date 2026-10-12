/** Fan-out with a concurrency cap, whole or failed; and fixed-size batches. */

import { describe } from "./errors.ts";

/**
 * `fn` over every item, at most `limit` at once, in `items` order; or, once all have settled, one error naming the
 * failures: a partial read must not pass as whole.
 */
export async function mapLimit<I, O>(
	what: string,
	items: readonly I[],
	limit: number,
	fn: (item: I) => Promise<O>,
): Promise<O[]> {
	const out: O[] = [];
	const failed: string[] = [];
	// Shared by every worker: each next() claims the next item.
	const queue = items.entries();
	const worker = async (): Promise<void> => {
		for (const [i, item] of queue) {
			try {
				out[i] = await fn(item);
			} catch (e) {
				failed[i] = describe(e);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	const errors = Object.values(failed);
	if (errors.length) throw new Error(`${what}: ${errors.length} failed: ${errors.slice(0, 5).join(" | ")}`);
	return out;
}

/** `items` in consecutive runs of at most `size`. */
export function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
	for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
