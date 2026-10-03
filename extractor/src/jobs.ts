/**
 * Every job's params and output, as valibot schemas: the one place the Worker
 * (which starts jobs and reads their outputs to fan out) and the container
 * (which runs them) agree on shapes. Both ends validate, because each side of
 * the wire is the other's external input.
 *
 * Read by the ios-ingest and android agents: a runner for type T receives
 * JobParams<T> and must resolve to JobOutput<T>.
 */

import * as v from "valibot";

import type { Json } from "../../src/lib/schema/index.ts";

/* ------------------------------------------------------------------ atoms */

export const jsonSchema: v.GenericSchema<Json> = v.lazy(() =>
  v.union([v.null(), v.boolean(), v.number(), v.string(), v.array(jsonSchema), v.record(v.string(), jsonSchema)]),
);

const sha256 = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/, "expected a lower-case sha256"));
const url = v.pipe(v.string(), v.url());
const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const positive = v.pipe(v.number(), v.integer(), v.minValue(1));
/** `ios:carrier:TMobile_us`; parsed strictly by parseSourceKey where it matters. */
const sourceKey = v.pipe(v.string(), v.regex(/^(ios|android):(carrier|country|default):[^:]+(:Watch)?$/));
/** YYYY-MM, a Pixel security patch month. */
const month = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}$/));

/** `<instance>:<type>:<unit>[.r<k>]`, see ./worker/ids.ts. */
const jobIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(200), v.regex(/^[\w.:-]+$/));

/** One iPhone IPSW of a build. */
const ipswRef = v.object({ device: v.string(), url });

/** One iOS build to extract, as ios.plan lists it. `label` is what pages show ("27.2 beta 2"). */
const iosBuild = v.object({
  build: v.string(),
  version: v.string(),
  label: v.string(),
  released: v.exactOptional(v.string()),
  prerelease: v.exactOptional(v.boolean()),
  ipsws: v.array(ipswRef),
});

/** One bundle as one IPSW carries it, stored as its own obj/ (deterministic re-zip). */
const ipswBundle = v.object({ source: sourceKey, sha: sha256, version: v.string(), size: count, cid: v.exactOptional(v.string()) });

/** One Pixel OTA: carrier settings differ per device within a build, so each device's OTA is read. */
const androidOta = v.object({ build: v.string(), device: v.string(), url, version: v.string(), patch: month });

/* ------------------------------------------------------------- the table */

export const JOB_TYPES = [
  "ios.plan", "ios.ipsw", "ios.modems", "ios.release", "ios.ota-archive",
  "android.plan", "android.ota", "android.release",
  "normalize", "index", "scan",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** Params, then output, per job type. */
export const JOB_SCHEMAS = {
  "ios.plan": {
    params: v.object({
      /** Exactly this version, held or not. */
      version: v.exactOptional(v.string()),
      /** Every release from this version up that is not held. */
      since: v.exactOptional(v.string()),
      max: v.exactOptional(positive),
      /** Extract every held build again. */
      rebuild: v.exactOptional(v.boolean()),
      betas: v.exactOptional(v.boolean()),
    }),
    output: v.object({ builds: v.array(iosBuild) }),
  },
  "ios.ipsw": {
    params: v.object({ build: v.string(), version: v.string(), label: v.string(), url, device: v.string() }),
    output: v.object({
      build: v.string(),
      device: v.string(),
      /** Product types the IPSW was built for. */
      devices: v.array(v.string()),
      bundles: v.array(ipswBundle),
    }),
  },
  "ios.modems": {
    params: v.object({ build: v.string(), ipsws: v.array(ipswRef) }),
    /** Release.modems entries (the v1 ImageModem shape). */
    output: v.object({ modems: v.array(jsonSchema) }),
  },
  "ios.release": {
    params: v.object({
      build: v.string(),
      version: v.string(),
      label: v.string(),
      released: v.exactOptional(v.string()),
      prerelease: v.exactOptional(v.boolean()),
      /**
       * Job ids of the build's ios.ipsw runs: the job reads each one's output
       * from jobs/<id>.json (too big together to travel as params).
       */
      parts: v.array(jobIdSchema),
      /** Job id of the build's ios.modems run; null when it failed (the release ships without modems). */
      modems: v.nullable(jobIdSchema),
    }),
    /** The merged bundles' shas: what normalize needs. */
    output: v.object({ build: v.string(), shas: v.array(sha256) }),
  },
  "ios.ota-archive": {
    params: v.object({
      /** Archive at most this many new files (local runs, first runs). */
      limit: v.exactOptional(positive),
    }),
    output: v.object({
      /** Newly archived artifacts, for normalize. */
      shas: v.array(sha256),
      /** Whether refs.json changed in a way the index shows: new refs, archives, or refs leaving the live manifest. */
      changed: v.boolean(),
      refs: count,
      archived: count,
      failed: count,
      /** sha1 of the manifest snapshot, when it was new. */
      manifest: v.nullable(v.string()),
    }),
  },
  "android.plan": {
    params: v.object({
      /** Plan builds already held, too. */
      rebuild: v.exactOptional(v.boolean()),
    }),
    output: v.object({
      builds: v.array(v.object({
        build: v.string(),
        version: v.string(),
        patch: month,
        devices: v.array(v.object({ device: v.string(), url })),
      })),
    }),
  },
  "android.ota": {
    params: androidOta,
    /** A device without CarrierSettings (a tablet) succeeds with no files. */
    output: v.object({
      build: v.string(),
      device: v.string(),
      carrierList: v.nullable(sha256),
      files: v.array(v.object({ source: sourceKey, sha: sha256, version: v.string(), size: count })),
    }),
  },
  "android.release": {
    params: v.object({
      build: v.string(),
      version: v.string(),
      patch: month,
      released: v.exactOptional(v.string()),
      /** Job ids of the build's android.ota runs, read from jobs/<id>.json like ios.release's parts. */
      parts: v.array(jobIdSchema),
    }),
    output: v.object({ build: v.string(), sources: count }),
  },
  normalize: {
    params: v.union([
      v.object({ shas: v.array(sha256), force: v.exactOptional(v.boolean()) }),
      v.object({ all: v.literal(true), shard: count, of: positive, force: v.exactOptional(v.boolean()) }),
    ]),
    output: v.object({
      written: count,
      skipped: count,
      failedCount: count,
      /** The first few failures; failedCount has them all. */
      failed: v.array(v.object({ sha: sha256, error: v.string() })),
    }),
  },
  index: {
    params: v.object({}),
    output: v.object({ releases: count, carriers: count, countries: count, sources: count }),
  },
  scan: {
    params: v.object({ force: v.exactOptional(v.boolean()) }),
    /** gen is null when the heads had not moved and nothing was rebuilt. */
    output: v.object({ gen: v.nullable(v.string()), sources: count, failed: count }),
  },
} as const satisfies Record<JobType, { params: v.GenericSchema; output: v.GenericSchema }>;

export type JobParams<T extends JobType> = v.InferOutput<(typeof JOB_SCHEMAS)[T]["params"]>;
export type JobOutput<T extends JobType> = v.InferOutput<(typeof JOB_SCHEMAS)[T]["output"]>;

export const isJobType = (s: string): s is JobType => JOB_TYPES.some((t) => t === s);

/* ------------------------------------------------------------- traits */

export interface JobTraits {
  /** heavy: standard-4 (4 vCPU, 12 GiB, 20 GB disk); light: standard-1. */
  readonly size: "heavy" | "light";
  /** How long the Workflow waits for /done before it gives up on the attempt. */
  readonly timeout: `${number} ${"minutes" | "hours"}`;
  /** Key prefixes the job may write through r2.internal; reads are unrestricted. */
  readonly writes: readonly string[];
}

const INGEST = ["obj/", "meta/"] as const;

export const JOBS = {
  "ios.plan": { size: "light", timeout: "15 minutes", writes: [] },
  "ios.ipsw": { size: "heavy", timeout: "2 hours", writes: INGEST },
  "ios.modems": { size: "light", timeout: "1 hours", writes: [...INGEST, "decoded/"] },
  "ios.release": { size: "light", timeout: "30 minutes", writes: [...INGEST, "releases/ios/"] },
  "ios.ota-archive": { size: "light", timeout: "1 hours", writes: [...INGEST, "feeds/ios-ota/"] },
  "android.plan": { size: "light", timeout: "15 minutes", writes: [] },
  "android.ota": { size: "light", timeout: "1 hours", writes: INGEST },
  "android.release": { size: "light", timeout: "30 minutes", writes: ["releases/android/"] },
  normalize: { size: "light", timeout: "1 hours", writes: ["norm/"] },
  index: { size: "light", timeout: "30 minutes", writes: ["index/"] },
  scan: { size: "light", timeout: "1 hours", writes: ["scan/"] },
} as const satisfies Record<JobType, JobTraits>;

/* ------------------------------------------------------------ the wire */

/** A job as the Worker hands it to a container. */
export interface JobSpec<T extends JobType = JobType> {
  readonly id: string;
  readonly type: T;
  readonly params: JobParams<T>;
}

/** Any job, discriminated by `type`: what code that dispatches on the type narrows. */
export type AnyJobSpec = { [K in JobType]: JobSpec<K> }[JobType];

/** What /done carries. Output is the job's own; the Worker validates it against JOB_SCHEMAS. */
export type JobResult = { readonly ok: true; readonly output: Json } | { readonly ok: false; readonly error: string };

export const jobResultSchema = v.variant("ok", [
  v.object({ ok: v.literal(true), output: jsonSchema }),
  v.object({ ok: v.literal(false), error: v.string() }),
]) satisfies v.GenericSchema<JobResult>;

export const progressSchema = v.object({ done: count, total: count, note: v.exactOptional(v.string()) });
export type Progress = v.InferOutput<typeof progressSchema>;

/**
 * Parses an untrusted JobSpec (the container's POST /run body). The params
 * schema is picked by `type`, so the result is the matching union member.
 */
export function parseJobSpec(input: unknown): AnyJobSpec {
  const head = v.parse(v.object({ id: jobIdSchema, type: v.picklist(JOB_TYPES), params: v.unknown() }), input);
  // specOf validated params against head.type's own schema, which is what makes this the matching member.
  return specOf(head.id, head.type, head.params) as AnyJobSpec;
}

/** Validates `params` for `type` and pairs them; the one place a spec is built. */
export function specOf<T extends JobType>(id: string, type: T, params: unknown): JobSpec<T> {
  const parsed = v.parse(JOB_SCHEMAS[type].params, params);
  // The schema just checked `parsed` against JobParams<T>; TS cannot see through the indexed table.
  return { id, type, params: parsed } as JobSpec<T>;
}

/** Validates a job's output against its type's schema. */
export function parseOutput<T extends JobType>(type: T, output: unknown): JobOutput<T> {
  // Same as specOf: a successful parse is the proof.
  return v.parse(JOB_SCHEMAS[type].output, output) as JobOutput<T>;
}

/* ------------------------------------------------------------ records */

/** jobs/<id>.json, written by the Worker when /done arrives. */
export interface JobRecord {
  readonly spec: JobSpec;
  readonly pipeline: string;
  readonly instance: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly result: JobResult;
}
