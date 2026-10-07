/** The dataset archive's R2 customMetadata: what the extractor writes with it, and the site shows of it. */

import * as v from "valibot";

const digits = v.pipe(v.string(), v.regex(/^\d+$/));

export const datasetMetadataSchema = v.object({
	/** YYYY-MM-DD: when its contents last changed. */
	date: v.pipe(v.string(), v.isoDate()),
	sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
	/** Bytes, in decimal: R2 metadata values are strings. */
	size: digits,
});

export type DatasetMetadata = v.InferOutput<typeof datasetMetadataSchema>;
