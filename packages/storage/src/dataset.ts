/** The dataset archive's R2 customMetadata: what the extractor writes with it, and the site shows of it. */

import * as v from "valibot";

import { sha256Schema } from "@carrier-explode/schema/records";

const digits = v.pipe(v.string(), v.regex(/^\d+$/));

export const datasetMetadataSchema = v.object({
	/** YYYY-MM-DD: when its contents last changed. */
	date: v.pipe(v.string(), v.isoDate()),
	sha256: sha256Schema,
	/** Bytes, in decimal: R2 metadata values are strings. */
	size: digits,
});

export type DatasetMetadata = v.InferOutput<typeof datasetMetadataSchema>;
