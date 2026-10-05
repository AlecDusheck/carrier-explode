/** Every job's params and output as valibot schemas, shared by the Worker and the container; both validate. */

import * as v from "valibot";

// types.ts and records.ts, not the schema entry: the Worker bundles this module and needs none of the mappers or concepts.
import { imageModemSchema, jsonSchema, sha256Schema, sourceKeySchema } from "@carrier-explode/schema/records";
import { MODEM_VENDORS, type Json } from "@carrier-explode/schema/types";
import type { Changed } from "@carrier-explode/db";
import { releasePrefix, type Prefix } from "@carrier-explode/storage";

const url = v.pipe(v.string(), v.url());
const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const positive = v.pipe(v.number(), v.integer(), v.minValue(1));
/** YYYY-MM. */
const month = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}$/));
/** `<instance>:<type>:<unit>[.r<k>]` (./worker/ids.ts). */
const jobIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(200), v.regex(/^[\w.:-]+$/));

const artifact = { sha: sha256Schema, version: v.string(), size: count };

const ipswRef = v.object({ device: v.string(), url });

/** One device's OTA of one build: what android.ota and android.modem extract from. */
const otaRef = v.object({ build: v.string(), device: v.string(), url });

/** An iOS build the IPSW feed plans: `label` is what pages show (`27.2 beta 2`). */
export const iosBuildSchema = v.object({
  build: v.string(),
  version: v.string(),
  label: v.string(),
  released: v.exactOptional(v.string()),
  prerelease: v.boolean(),
  ipsws: v.array(ipswRef),
});

/** A Pixel build the OTA feed plans, with every device's OTA. */
export const androidBuildSchema = v.object({
  build: v.string(),
  version: v.string(),
  patch: month,
  devices: v.array(v.object({ device: v.string(), url })),
});

export const JOB_TYPES = [
  "ios.ipsw", "ios.modems", "ios.release", "ios.ota", "ios.modem-summaries",
  "android.ota", "android.modem", "android.release",
  "normalize", "publish",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** A job over many artifacts: what it wrote, skipped as current, and failed. */
const tally = v.object({
  written: count,
  skipped: count,
  failed: count,
  /** The first few of `failed`. */
  failures: v.array(v.object({ sha: sha256Schema, error: v.string() })),
});

/** A deterministic slice of every artifact, for jobs that run in parallel over the whole bucket. */
const shard = { shard: count, of: positive };
/** A reindex's start: outputs written before it are rewritten, those since are kept. */
const rewriteBefore = v.exactOptional(v.pipe(v.string(), v.isoTimestamp()));

/** Lower-case Apple board → product type, from D1's device records: which phone each override file is for. */
const boards = v.record(v.string(), v.string());

export const JOB_SCHEMAS = {
  "ios.ipsw": {
    params: v.object({ build: v.string(), version: v.string(), label: v.string(), url, device: v.string() }),
    output: v.object({
      build: v.string(),
      device: v.string(),
      /** Product types the IPSW was built for. */
      devices: v.array(v.string()),
      bundles: v.array(v.object({ source: sourceKeySchema, ...artifact, cid: v.string() })),
    }),
  },
  "ios.modems": {
    params: v.object({ build: v.string(), ipsws: v.array(ipswRef) }),
    output: v.object({ modems: v.array(imageModemSchema) }),
  },
  "ios.release": {
    params: v.object({
      build: v.string(),
      version: v.string(),
      label: v.string(),
      released: v.exactOptional(v.string()),
      prerelease: v.boolean(),
      /** The build's ios.ipsw job ids; their outputs are read from jobs/<id>.json. */
      parts: v.array(jobIdSchema),
      /** The build's ios.modems job id. */
      modems: jobIdSchema,
    }),
    output: v.object({ build: v.string(), shas: v.array(sha256Schema) }),
  },
  /** Apple's OTA files, downloaded and stored as Apple serves them; one that fails is listed, not thrown. */
  "ios.ota": {
    params: v.object({ urls: v.array(url) }),
    output: v.object({
      stored: v.array(v.object({ url, sha: sha256Schema, cid: v.string() })),
      failed: v.array(v.object({ url, error: v.string() })),
    }),
  },
  /** Every stored modem package's summary, decoded again: after a MODEM_SUMMARY_SCHEMA bump. */
  "ios.modem-summaries": {
    params: v.object({ ...shard, rewriteBefore }),
    output: tally,
  },
  "android.ota": {
    params: otaRef,
    /** A device without CarrierSettings (a tablet) succeeds with no files. */
    output: v.object({
      build: v.string(),
      device: v.string(),
      carrierList: v.nullable(sha256Schema),
      files: v.array(v.object({ source: sourceKeySchema, ...artifact })),
    }),
  },
  "android.modem": {
    params: otaRef,
    /** modem is null for a device without one (a Wi-Fi tablet). */
    output: v.object({
      build: v.string(),
      device: v.string(),
      modem: v.nullable(v.object({
        family: v.picklist(MODEM_VENDORS),
        firmware: v.string(),
        /** Config label -> sha of its android.modem-config archive. */
        configs: v.record(v.string(), sha256Schema),
      })),
    }),
  },
  "android.release": {
    params: v.object({
      build: v.string(),
      version: v.string(),
      patch: month,
      /** The build's android.ota job ids; their outputs are read from jobs/<id>.json. */
      parts: v.array(jobIdSchema),
      /** The build's android.modem job ids, read the same way. */
      modems: v.array(jobIdSchema),
    }),
    output: v.object({ build: v.string(), sources: count, modems: count }),
  },
  normalize: {
    params: v.union([
      v.object({ shas: v.array(sha256Schema), boards, rewriteBefore }),
      v.object({ ...shard, boards, rewriteBefore }),
    ]),
    output: tally,
  },
  /**
   * The index's statements against D1 as `live` (an R2 key) holds it, then the scan index. `requested`: when the
   * bucket last changed; an index built from it since is current.
   */
  publish: {
    params: v.object({ requested: v.pipe(v.string(), v.isoTimestamp()), live: v.string(), force: v.exactOptional(v.boolean()) }),
    output: v.variant("kind", [
      v.object({ kind: v.literal("current") }),
      v.object({
        kind: v.literal("built"),
        builtAt: v.pipe(v.string(), v.isoTimestamp()),
        /** Statement batches, staged at keys.staging(<job id>, `batch-<n>.json`) for the Worker to apply in order. */
        batches: count,
        releases: count,
        carriers: count,
        countries: count,
        sources: count,
        /** gen is null when the heads had not moved and the scan index was kept. */
        scan: v.object({ gen: v.nullable(v.string()), sources: count, failed: count }),
        /** The sources whose pages the batches change, or every page: what the site purges. */
        changed: v.union([v.array(sourceKeySchema), v.literal("everything")]) satisfies v.GenericSchema<unknown, Changed>,
      }),
    ]),
  },
} as const satisfies Record<JobType, { params: v.GenericSchema; output: v.GenericSchema }>;

export type JobParams<T extends JobType> = v.InferOutput<(typeof JOB_SCHEMAS)[T]["params"]>;
export type JobOutput<T extends JobType> = v.InferOutput<(typeof JOB_SCHEMAS)[T]["output"]>;

export const isJobType = (s: string): s is JobType => JOB_TYPES.some((t) => t === s);

const MINUTES = 60_000;
const HOURS = 60 * MINUTES;

export interface JobTraits {
  /** heavy: standard-4 (4 vCPU, 12 GiB, 20 GB disk); light: standard-1. */
  readonly size: "heavy" | "light";
  /** How long the Workflow waits for its record, in ms. */
  readonly timeout: number;
  /** All the job may write; reads are unrestricted. */
  readonly writes: readonly Prefix[];
  /** All it may delete: what it owns and replaces, or the staging it consumes. Never obj/ or meta/. */
  readonly deletes: readonly Prefix[];
  /** Runs in the one container named for its type, so two never overlap: it rewrites and deletes what it owns. */
  readonly serial: boolean;
}

const INGEST = ["obj/", "meta/"] as const satisfies readonly Prefix[];

export const JOBS = {
  "ios.ipsw": { size: "heavy", timeout: 2 * HOURS, writes: ["staging/"], deletes: [], serial: false },
  "ios.modems": { size: "light", timeout: 1 * HOURS, writes: [...INGEST, "decoded/"], deletes: [], serial: false },
  "ios.release": { size: "light", timeout: 30 * MINUTES, writes: [...INGEST, releasePrefix("ios")], deletes: ["staging/"], serial: false },
  "ios.ota": { size: "light", timeout: 1 * HOURS, writes: INGEST, deletes: [], serial: false },
  "ios.modem-summaries": { size: "light", timeout: 2 * HOURS, writes: ["decoded/"], deletes: [], serial: false },
  "android.ota": { size: "light", timeout: 1 * HOURS, writes: INGEST, deletes: [], serial: false },
  "android.modem": { size: "light", timeout: 1 * HOURS, writes: INGEST, deletes: [], serial: false },
  "android.release": { size: "light", timeout: 30 * MINUTES, writes: [releasePrefix("android")], deletes: [], serial: false },
  normalize: { size: "light", timeout: 1 * HOURS, writes: ["norm/"], deletes: [], serial: false },
  publish: { size: "light", timeout: 1 * HOURS, writes: ["scan/", "staging/"], deletes: ["scan/"], serial: true },
} as const satisfies Record<JobType, JobTraits>;

export interface JobSpec<T extends JobType = JobType> {
  readonly id: string;
  readonly type: T;
  readonly params: JobParams<T>;
}

/** Any job, discriminated by `type`: what an untrusted spec parses to. */
export type AnyJobSpec = { [K in JobType]: JobSpec<K> }[JobType];

export type JobResult = { readonly ok: true; readonly output: Json } | { readonly ok: false; readonly error: string };

export const jobResultSchema = v.variant("ok", [
  v.object({ ok: v.literal(true), output: jsonSchema }),
  v.object({ ok: v.literal(false), error: v.string() }),
]) satisfies v.GenericSchema<JobResult>;

/** Validates `params` against `type`'s schema and pairs them. */
export function specOf<T extends JobType>(id: string, type: T, params: unknown): JobSpec<T> {
  const parsed = v.parse(JOB_SCHEMAS[type].params, params);
  // The parse is the proof; TS cannot narrow an indexed schema table by a generic key.
  return { id, type, params: parsed } as JobSpec<T>;
}

/** An untrusted JobSpec (what the container reads from jobs/<id>.spec.json). */
export function parseJobSpec(input: unknown): AnyJobSpec {
  const head = v.parse(v.object({ id: jobIdSchema, type: v.picklist(JOB_TYPES), params: v.unknown() }), input);
  // specOf checked params against head.type's own schema, which makes this its union member.
  return specOf(head.id, head.type, head.params) as AnyJobSpec;
}

export function parseOutput<T extends JobType>(type: T, output: unknown): JobOutput<T> {
  // As in specOf: the parse is the proof.
  return v.parse(JOB_SCHEMAS[type].output, output) as JobOutput<T>;
}

/** jobs/<id>.json, written by the container as its last act. */
export interface JobRecord {
  readonly spec: JobSpec;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly result: JobResult;
}

/** The part of a JobRecord its readers need. */
export const jobRecordSchema = v.object({ result: jobResultSchema });
