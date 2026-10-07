import { fileURLToPath } from "node:url";

import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { experimental_readRawConfig } from "wrangler";

import { BUDGET } from "../src/rate.ts";

const ENVIRONMENTS = ["dev", "production"] as const;

const envSchema = v.object({
	ratelimits: v.array(
		v.object({
			name: v.string(),
			namespace_id: v.string(),
			simple: v.object({ limit: v.number(), period: v.number() }),
		}),
	),
	vars: v.object({ CACHE_TTL: v.record(v.string(), v.number()) }),
});
const wranglerSchema = v.object({ env: v.object({ dev: envSchema, production: envSchema }) });

const config = (path: string): v.InferOutput<typeof wranglerSchema> =>
	v.parse(
		wranglerSchema,
		experimental_readRawConfig({ config: fileURLToPath(new URL(path, import.meta.url)) }).rawConfig,
	);

describe("wrangler.jsonc", async () => {
	const [api, site] = [config("../wrangler.jsonc"), config("../../site/wrangler.jsonc")];

	it.for(ENVIRONMENTS)(
		"binds the site's rate-limit namespaces in %s, with its budgets, so one client's budget covers both",
		(name) => {
			const [ours, theirs] = [api.env[name], site.env[name]];
			for (const binding of Object.values(BUDGET)) {
				const limit = ours.ratelimits.find((r) => r.name === binding);
				expect(limit, binding).toBeDefined();
				expect(limit).toEqual(theirs.ratelimits.find((r) => r.name === binding));
			}
			expect(ours.ratelimits.map((r) => r.name).toSorted()).toEqual(Object.values(BUDGET).toSorted());
		},
	);

	it.for(ENVIRONMENTS)("keeps each kind of answer in %s as long as the site keeps its own", (name) => {
		for (const [kind, seconds] of Object.entries(api.env[name].vars.CACHE_TTL))
			expect(site.env[name].vars.CACHE_TTL[kind], kind).toBe(seconds);
	});

	it("runs dev with production's budgets and cache times", () => {
		expect(api.env.dev).toEqual(api.env.production);
		expect(site.env.dev).toEqual(site.env.production);
	});
});
