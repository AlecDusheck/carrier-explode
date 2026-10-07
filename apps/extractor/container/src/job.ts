/** What a container job is: a function of its params (unvalidated: each job parses its own) to its output; and how it answers a failure. */

import type { Json } from "@carrier-explode/schema/types";
import { describe } from "../../src/errors.ts";
import type { Answer } from "../../src/container-protocol.ts";
import { permanent } from "../../src/errors.ts";
import type { Bucket } from "./bucket.ts";

export interface JobContext {
	/** Scratch space on the container's disk, empty at start and removed after the job. */
	readonly tmp: string;
	readonly bucket: Bucket;
	log(message: string): void;
}

export type JobRunner = (params: unknown, ctx: JobContext) => Promise<Json>;

/** A job's failure as its answer: whether a rerun would fail the same way is decided here, where the error is still an object. */
export const failure = (e: unknown): Answer => ({ ok: false, error: describe(e), permanent: permanent(e) });
