/** The interface job code runs against in a container. Params and outputs per type: ../../src/jobs.ts. */

import type { ObjClaim } from "@carrier-explode/storage";
import type { JobOutput, JobSpec, JobType } from "../../src/jobs.ts";


export interface JobContext<T extends JobType = JobType> {
  readonly spec: JobSpec<T>;
  /** Scratch space on the container's disk, empty at start. */
  readonly tmp: string;
  readonly r2: R2Client;
  log(message: string): void;
  progress(done: number, total: number, note?: string): Promise<void>;
}

/** Bytes, text, or a file on the container's disk (streamed, never loaded whole). */
export type PutBody = Uint8Array | string | { readonly file: string };

/** An object's size, and when it was last written. */
export interface StoredHead {
  readonly size: number;
  readonly uploaded: Date;
}

export interface R2Client {
  get(key: string): Promise<Uint8Array | null>;
  /** Unvalidated: narrow it with valibot. */
  getJson(key: string): Promise<unknown>;
  head(key: string): Promise<StoredHead | null>;
  list(prefix: string): Promise<readonly string[]>;
  /** Only under the job's JOBS[type].writes (the job's context checks). */
  put(key: string, body: PutBody, contentType?: string): Promise<void>;
  putJson(key: string, value: unknown): Promise<void>;
  /** Never under obj/ or meta/: artifacts are immutable. A missing key is not an error. */
  delete(key: string): Promise<void>;
  /** Stores obj/<sha256> and meta/<sha256>.json unless present (the first origin wins); returns the sha256. */
  putObj(body: Uint8Array | { readonly file: string }, claim: ObjClaim): Promise<string>;
}

export type JobRunner<T extends JobType> = (ctx: JobContext<T>) => Promise<JobOutput<T>>;

export type Runners = { readonly [K in JobType]: JobRunner<K> };
