import { fileURLToPath } from "node:url";

import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { experimental_readRawConfig } from "wrangler";

const ENVIRONMENTS = ["dev", "production"] as const;

const positive = v.pipe(v.number(), v.integer(), v.minValue(1));
const cacheTtl = { CACHE_TTL: v.record(v.string(), v.number()) };

const siteVars = v.object(cacheTtl);
const apiVars = v.object({
	...cacheTtl,
	API_PAGE_LIMITS: v.pipe(
		v.object({ default: positive, max: positive }),
		v.check((l) => l.default <= l.max, "the default page is at most the largest"),
	),
});

const wranglerSchema = <S extends v.GenericSchema>(vars: S) => {
	const env = v.object({ vars });
	return v.object({ env: v.object({ dev: env, production: env }) });
};

const config = <S extends v.GenericSchema>(
	path: string,
	vars: S,
): v.InferOutput<ReturnType<typeof wranglerSchema<S>>> =>
	v.parse(
		wranglerSchema(vars),
		experimental_readRawConfig({ config: fileURLToPath(new URL(path, import.meta.url)) }).rawConfig,
	);

describe("wrangler.jsonc", async () => {
	const [api, site] = [config("../wrangler.jsonc", apiVars), config("../../site/wrangler.jsonc", siteVars)];

	it.for(ENVIRONMENTS)("keeps each kind of answer in %s as long as the site keeps its own", (name) => {
		for (const [kind, seconds] of Object.entries(api.env[name].vars.CACHE_TTL))
			expect(site.env[name].vars.CACHE_TTL[kind], kind).toBe(seconds);
	});

	it("runs dev with production's cache times and page limits", () => {
		expect(api.env.dev).toEqual(api.env.production);
		expect(site.env.dev).toEqual(site.env.production);
	});
});
