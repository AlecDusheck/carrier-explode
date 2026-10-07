/** An R2 object as a RangeSource, read by ranged gets through a bucket binding. */

import { checkRange, type RangeSource } from "./source.ts";

export class R2ReadError extends Error {
	override name = "R2ReadError";
}

/** What r2Source needs of a bucket: a Worker's R2Bucket binding is one, without this package seeing Workers types. */
export interface RangedBucket {
	head(key: string): Promise<{ readonly size: number } | null>;
	get(
		key: string,
		options: { readonly range: { readonly offset: number; readonly length: number } },
	): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export async function r2Source(bucket: RangedBucket, key: string): Promise<RangeSource> {
	const head = await bucket.head(key);
	if (head === null) throw new R2ReadError(`r2:${key}: no such object`);
	const src: RangeSource = {
		label: `r2:${key}`,
		size: head.size,
		async read(offset, length) {
			checkRange(src, offset, length);
			if (length === 0) return new Uint8Array();
			const got = await bucket.get(key, { range: { offset, length } });
			if (got === null) throw new R2ReadError(`${src.label}: gone while it was being read`);
			const bytes = new Uint8Array(await got.arrayBuffer());
			if (bytes.length !== length)
				throw new R2ReadError(`${src.label}: ${bytes.length} of the ${length} bytes asked for at ${offset}`);
			return bytes;
		},
	};
	return src;
}
