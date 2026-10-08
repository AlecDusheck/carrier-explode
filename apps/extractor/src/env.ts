/** The Worker's bindings (wrangler.jsonc), by hand so Workflow params and queue messages are typed, and its vars' shape. */

import * as v from "valibot";

import type { Extractor } from "./container.ts";
import { FEED_NAMES, type ContainerPipeline, type PipelineParams } from "./pipelines.ts";
import type { IndexMessage } from "./indexing.ts";
import type { PurgeMessage, PurgeVars } from "./queues.ts";
import { scopeSchema } from "./scope.ts";

const positive = v.pipe(v.number(), v.integer(), v.minValue(1));

export const tuningSchema = v.object({
	SCOPE: scopeSchema,
	/** How many of the container class's max_instances each container pipeline may hold at once; they sum to one less. */
	CONTAINER_SHARE: v.object({ "ios-build": positive, "galaxy-build": positive }) satisfies v.GenericSchema<
		unknown,
		Record<ContainerPipeline, number>
	>,
	/** The labels Workflow: the AI Gateway its search and model calls go through, the search provider, the model, and codes tried per kind of candidate each run. */
	LABELLER: v.object({
		gateway: v.pipe(v.string(), v.minLength(1)),
		provider: v.picklist(["ceramic", "exa", "linkup"]),
		model: v.pipe(v.string(), v.minLength(1)),
		perKind: positive,
	}),
	/** When each scheduled feed is checked; it is the Worker's `triggers.crons` (test/tables.test.ts checks). */
	PIPELINE_CRONS: v.record(v.picklist(FEED_NAMES), v.pipe(v.string(), v.minLength(1))),
	/** How long a platform's facts must stop arriving before it is derived again. */
	SETTLE_DELAY_S: positive,
	/** A Workflow step's tries after its first, by kind of step, and the wait before the first retry. */
	STEP_RETRIES: v.object({ step: positive, container: positive, delayMs: positive }),
	/** A Worker step's limit; a container step's is its job's deadline and a minute. */
	STEP_TIMEOUT_MS: positive,
	/** How long a container may take to start (a cold start pulls the image), and one job to answer. */
	CONTAINER_LIMITS: v.object({ readyMs: positive, jobDeadlineMs: positive }),
	/**
	 * Requests in flight at once: iOS merge's and an IPSW job's R2 calls, the community catalogs (ipsw.me, AppleDB), Galaxy's
	 * R2 reads and Pixel's update service.
	 */
	FEED_CONCURRENCY: v.object({
		iosMerge: positive,
		ipswBundles: positive,
		appleCatalogs: positive,
		galaxyReads: positive,
		pixelOta: positive,
	}),
	/** What one index message takes on, each bounded by the D1 queries an invocation may make. */
	INDEX_BATCH: v.object({
		otaFiles: positive,
		derivedSources: positive,
		changedReleases: positive,
		profileRows: positive,
	}),
});

type Tuning = v.InferOutput<typeof tuningSchema>;

export interface Env extends PurgeVars, Tuning {
	readonly BUCKET: R2Bucket;
	/** The index (packages/db), written by the index queue's consumer, the feed checks (devices, their names) and the labels Workflow (names). */
	readonly DB: D1Database;
	readonly INDEX_QUEUE: Queue<IndexMessage>;
	readonly PURGE_QUEUE: Queue<PurgeMessage>;
	readonly EXTRACTOR: DurableObjectNamespace<Extractor>;
	readonly IOS_BUILD: Workflow<PipelineParams<"ios-build">>;
	readonly APPLE_OTA: Workflow<PipelineParams<"apple-ota">>;
	readonly PIXEL_DEVICE: Workflow<PipelineParams<"pixel-device">>;
	readonly PIXEL_OTA: Workflow<PipelineParams<"pixel-ota">>;
	readonly GALAXY_BUILD: Workflow<PipelineParams<"galaxy-build">>;
	readonly LABELS: Workflow<PipelineParams<"labels">>;
	readonly REINDEX: Workflow<PipelineParams<"reindex">>;
	readonly DATASET: Workflow<PipelineParams<"dataset">>;
	/** The public API (apps/api), which the dataset is read from. */
	readonly API: Fetcher;
	/** Workers AI and the Web Search API, for the labels Workflow. */
	readonly AI: Ai;
	/** Bearer token for /run and /runs. */
	readonly RUN_TOKEN: string;
}
