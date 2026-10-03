/**
 * The contract between the extractor Worker and the job code running in its
 * containers. A job is one unit of container work (one IPSW, one Pixel OTA,
 * one reindex shard...). The Workflow decides which jobs run; a job only
 * reads and writes R2 through `ctx` and returns a small JSON output, which the
 * Workflow reads to fan out or fan in.
 *
 * Transport (implemented by ./runtime.ts in the container and the Worker's
 * outboundByHost handlers; jobs never see it):
 *   http://r2.internal       GET|HEAD|PUT /o/<key>, GET /list?prefix=&cursor=, multipart under /mpu/<key>
 *   http://control.internal  POST /progress, POST /done   (scoped to the calling container's job)
 */

import type { Json } from "../../../src/lib/schema/types.ts";
import type { ObjMeta } from "../../../src/lib/storage/keys.ts";

export const JOB_TYPES = [
  // iOS
  "ios.plan",        // which iOS builds/IPSWs are new                     -> { builds: [...] }
  "ios.ipsw",        // one IPSW: carrier + country bundles, packaged       (heavy)
  "ios.release",     // merge a build's ipsw outputs + modems -> releases/ios/<build>.json
  "ios.modems",      // modem packages of a build, over range requests
  "ios.ota-archive", // Apple OTA manifest: snapshot + archive new .ipcc files, feeds/ios-ota/refs.json
  // Android
  "android.plan",    // which Pixel builds are new                         -> { builds: [...] }
  "android.ota",     // one Pixel OTA: CarrierSettings over range requests -> releases/android/<id>.json
  // Derived
  "normalize",       // artifacts -> norm/v<N>/<sha>.json (params.shas, or params.all)
  "index",           // rebuild index/* from releases, refs and profiles
  "scan",            // rebuild the cross-source scan index
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** Which container class runs it. heavy: standard-4 (20 GB disk); light: standard-1. */
export const JOB_SIZE: Record<JobType, "heavy" | "light"> = {
  "ios.plan": "light", "ios.ipsw": "heavy", "ios.release": "light", "ios.modems": "light", "ios.ota-archive": "light",
  "android.plan": "light", "android.ota": "light", normalize: "light", index: "light", scan: "light",
};

export interface JobSpec {
  /** Unique; also the container's Durable Object name. `<workflow instance>:<type>:<n>`. */
  id: string;
  type: JobType;
  params: Record<string, Json>;
}

export interface JobContext {
  spec: JobSpec;
  /** A scratch directory on the container's disk, empty at start. */
  tmp: string;
  r2: R2Client;
  log(message: string): void;
  /** Also keeps the container awake: call at least every few minutes. */
  progress(done: number, total: number, note?: string): Promise<void>;
}

export interface R2Client {
  get(key: string): Promise<Uint8Array | null>;
  getJson<T>(key: string): Promise<T | null>;
  head(key: string): Promise<{ size: number } | null>;
  /** Keys under a prefix (all pages). */
  list(prefix: string): Promise<string[]>;
  /** Any writable key (WRITABLE_PREFIXES). Large bodies (> 64 MB, or a file path) go multipart. */
  put(key: string, body: Uint8Array | string | { file: string }, contentType?: string): Promise<void>;
  putJson(key: string, value: unknown): Promise<void>;
  /**
   * Content-addressed artifact: writes obj/<sha256> (skipped if present) and
   * meta/<sha256>.json (skipped if present, so the first origin wins). Returns the sha256.
   */
  putObj(body: Uint8Array | { file: string }, meta: Omit<ObjMeta, "sha256" | "size" | "storedAt">): Promise<string>;
}

/** What /done carries back to the Workflow. Keep `output` under ~512 KB (Workflow step result limit is 1 MiB). */
export interface JobResult {
  ok: boolean;
  output?: Json;
  error?: string;
}

export type JobRunner = (ctx: JobContext) => Promise<Json>;
