/** The Worker's bindings (wrangler.jsonc), by hand so Workflow params and queue messages are typed, and its vars' shape. */

import * as v from "valibot";

import type { Extractor } from "./container.ts";
import type { ContainerPipeline, PipelineParams } from "./pipelines.ts";
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
	/** The labels Workflow: the AI Gateway its search and model calls go through, the search provider, the model, and codes tried per kind each run. Set where the AI binding is. */
	LABELLER: v.exactOptional(
		v.object({
			gateway: v.pipe(v.string(), v.minLength(1)),
			provider: v.picklist(["ceramic", "exa", "linkup"]),
			model: v.pipe(v.string(), v.minLength(1)),
			perKind: positive,
		}),
	),
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
	/** With AI and LABELLER, or none of them: Workers AI has no local simulator, so dev binds none. */
	readonly LABELS?: Workflow<PipelineParams<"labels">>;
	readonly REINDEX: Workflow<PipelineParams<"reindex">>;
	readonly DATASET: Workflow<PipelineParams<"dataset">>;
	/** The public API (apps/api), which the dataset is read from. */
	readonly API: Fetcher;
	/** Workers AI and the Web Search API, for the labels Workflow. */
	readonly AI?: Ai;
	/** Bearer token for /run and /runs. */
	readonly RUN_TOKEN: string;
}
