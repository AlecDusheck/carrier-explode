/**
 * The contract between the extractor Worker and the job code running in its
 * containers. A job is one unit of container work (one IPSW, one Pixel OTA,
 * one reindex shard...). The Workflow decides which jobs run; a job only
 * reads and writes R2 through `ctx` and returns a small JSON output, which the
 * Workflow reads to fan out or fan in.
 *
 * Params and outputs per job type are valibot schemas in ../../src/jobs.ts,
 * shared with the Worker. A runner for type T gets `ctx.spec.params` already
 * validated as JobParams<T> and must resolve to JobOutput<T>.
 *
 * Transport (implemented by ./runtime/ in the container and the Worker's
 * outboundByHost handlers; jobs never see it):
 *   http://r2.internal       GET|HEAD|PUT /o/<key>, GET /list?prefix=&cursor=, multipart under /mpu/<key>
 *   http://control.internal  POST /progress, POST /done   (scoped to the calling container's job)
 */

import type { ObjMeta } from "../../../src/lib/storage/keys.ts";
import type { JobOutput, JobSpec, JobType } from "../../src/jobs.ts";

export { JOB_TYPES, JOBS, type JobOutput, type JobParams, type JobResult, type JobSpec, type JobType } from "../../src/jobs.ts";

export interface JobContext<T extends JobType = JobType> {
  readonly spec: JobSpec<T>;
  /** A scratch directory on the container's disk, empty at start. */
  readonly tmp: string;
  readonly r2: R2Client;
  log(message: string): void;
  /** Also keeps the container awake: call at least every few minutes. */
  progress(done: number, total: number, note?: string): Promise<void>;
}

/** A body for put: bytes, text, or a file on the container's disk (streamed, never loaded whole). */
export type PutBody = Uint8Array | string | { readonly file: string };

export interface R2Client {
  get(key: string): Promise<Uint8Array | null>;
  /** Parsed JSON, unvalidated: callers narrow it (valibot) before use. */
  getJson(key: string): Promise<unknown>;
  head(key: string): Promise<{ readonly size: number } | null>;
  /** Keys under a prefix (all pages). */
  list(prefix: string): Promise<string[]>;
  /** A key under one of the job's writable prefixes (JOBS[type].writes). Bodies over 64 MB go multipart. */
  put(key: string, body: PutBody, contentType?: string): Promise<void>;
  putJson(key: string, value: unknown): Promise<void>;
  /**
   * Content-addressed artifact: writes obj/<sha256> (skipped if present) and
   * meta/<sha256>.json (skipped if present, so the first origin wins). Returns the sha256.
   */
  putObj(body: Uint8Array | { readonly file: string }, meta: Omit<ObjMeta, "sha256" | "size" | "storedAt">): Promise<string>;
}

export type JobRunner<T extends JobType> = (ctx: JobContext<T>) => Promise<JobOutput<T>>;

/**
 * Runners by type, as the registry (./jobs/index.ts) imports them:
 *   ./jobs/ios/index.ts   export const iosRunners: RunnerTable<"ios.plan" | "ios.ipsw" | "ios.modems" | "ios.release">
 *   ./jobs/android.ts     export const androidRunners: RunnerTable<"android.plan" | "android.ota">
 */
export type RunnerTable<T extends JobType> = { readonly [K in T]: JobRunner<K> };
