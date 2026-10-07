/**
 * What the Extractor object and its container agree on: one job at JOB_PATH, and the bucket over plain HTTP at
 * BUCKET_HOST (bucket-proxy.ts). PUT /obj/<sha256> and `If-None-Match: *` PUTs write once: 201 written, 412 held.
 */

import * as v from "valibot";

import { jsonSchema } from "@carrier-explode/schema/records";
import type { Json } from "@carrier-explode/schema/types";

export const CONTAINER_JOBS = ["ios.ipsw", "galaxy.ap"] as const;
export type ContainerJobName = (typeof CONTAINER_JOBS)[number];

/** A job as the container's job server takes it: params are the job's own, which its unit defines. */
export interface ContainerJob {
	readonly job: ContainerJobName;
	readonly params: Json;
}

/** A failed job says whether a rerun would fail the same way (errors.ts `permanent`), as only the container sees the error. */
export const answerSchema = v.variant("ok", [
	v.object({ ok: v.literal(true), output: jsonSchema }),
	v.object({ ok: v.literal(false), error: v.string(), permanent: v.boolean() }),
]);
export type Answer = v.InferOutput<typeof answerSchema>;

export const JOB_PORT = 8080;
export const JOB_PATH = "/job";

export const BUCKET_HOST = "bucket.internal";
export const KIND_HEADER = "x-artifact-kind";
