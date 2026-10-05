import { readFile } from "node:fs/promises";

import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { BUDGET } from "../src/rate.ts";

const wranglerSchema = v.object({
  ratelimits: v.array(v.object({ name: v.string(), namespace_id: v.string(), simple: v.object({ limit: v.number(), period: v.number() }) })),
  vars: v.object({ CACHE_TTL: v.record(v.string(), v.number()) }),
});

/** JSONC to JSON: comments go, strings (which hold `//` in URLs) stay. */
const stripComments = (text: string): string => text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, str: string | undefined) => str ?? "");

const config = async (path: string): Promise<v.InferOutput<typeof wranglerSchema>> =>
  v.parse(wranglerSchema, JSON.parse(stripComments(await readFile(new URL(path, import.meta.url), "utf8"))));

describe("wrangler.jsonc", async () => {
  const [api, site] = await Promise.all([config("../wrangler.jsonc"), config("../../site/wrangler.jsonc")]);

  it("binds the site's rate-limit namespaces, with its budgets, so one client's budget covers both", () => {
    for (const binding of Object.values(BUDGET)) {
      const ours = api.ratelimits.find((r) => r.name === binding);
      expect(ours, binding).toBeDefined();
      expect(ours).toEqual(site.ratelimits.find((r) => r.name === binding));
    }
    expect(api.ratelimits.map((r) => r.name).sort()).toEqual(Object.values(BUDGET).sort());
  });

  it("keeps each kind of answer as long as the site keeps its own", () => {
    for (const [kind, seconds] of Object.entries(api.vars.CACHE_TTL)) expect(site.vars.CACHE_TTL[kind], kind).toBe(seconds);
  });
});
