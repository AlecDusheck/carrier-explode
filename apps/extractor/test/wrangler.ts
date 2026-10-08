/** wrangler.jsonc's environments, as the tests read them. */

import { fileURLToPath } from "node:url";

import * as v from "valibot";
import { experimental_readRawConfig } from "wrangler";

import { tuningSchema } from "../src/env.ts";

/** The index and bucket an environment binds: local state is keyed by their ids, so the readers must bind the extractor's. */
const storageSchema = {
	d1_databases: v.tuple([v.object({ database_name: v.string(), database_id: v.string() })]),
	r2_buckets: v.tuple([v.object({ bucket_name: v.string() })]),
};

/** The parts of an environment in wrangler.jsonc the Worker's tables must agree with. */
const envSchema = v.object({
	name: v.string(),
	...storageSchema,
	workflows: v.array(v.object({ binding: v.string(), name: v.string() })),
	ai: v.object({ binding: v.literal("AI") }),
	triggers: v.object({ crons: v.array(v.string()) }),
	containers: v.tuple([v.object({ max_instances: v.number() })]),
	durable_objects: v.object({ bindings: v.array(v.object({ name: v.string(), class_name: v.string() })) }),
	queues: v.object({
		producers: v.array(v.object({ binding: v.string(), queue: v.string() })),
		consumers: v.array(
			v.object({
				queue: v.string(),
				max_batch_size: v.number(),
				max_batch_timeout: v.exactOptional(v.number()),
				max_concurrency: v.number(),
				max_retries: v.number(),
				retry_delay: v.number(),
				dead_letter_queue: v.exactOptional(v.string()),
			}),
		),
	}),
	vars: v.record(v.string(), v.unknown()),
});
const wranglerSchema = v.object({ env: v.object({ dev: envSchema, production: envSchema }) });

/** wrangler.jsonc as wrangler itself reads it. */
const read = (path: string): unknown =>
	experimental_readRawConfig({ config: fileURLToPath(new URL(path, import.meta.url)) }).rawConfig;

export const wrangler = v.parse(wranglerSchema, read("../wrangler.jsonc"));

/** Production's vars, which the index tests run with. */
export const productionTuning = v.parse(tuningSchema, wrangler.env.production.vars);

/** The site's and the API's dev environments, which read what the extractor's writes. */
const readerSchema = v.object({
	env: v.object({
		dev: v.object({ name: v.string(), ...storageSchema }),
		production: v.object({ name: v.string() }),
	}),
});
export const readers = {
	site: v.parse(readerSchema, read("../../site/wrangler.jsonc")),
	api: v.parse(readerSchema, read("../../api/wrangler.jsonc")),
};
