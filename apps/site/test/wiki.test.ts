import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as v from "valibot";
import { experimental_readRawConfig } from "wrangler";
import { headingSlug } from "../src/lib/wiki-headings.ts";

const DIR = "src/wiki";
/** Article path under /wiki (`ios/der-pri`, `credits`) -> its markdown. */
const articles = new Map(
	readdirSync(DIR, { recursive: true, encoding: "utf8" })
		.filter((f) => f.endsWith(".md"))
		.map((f) => [f.slice(0, -3), readFileSync(`${DIR}/${f}`, "utf8")]),
);

/** The ids an article's headings get: their text as rendered, backticks dropped. */
const anchors = (md: string) =>
	new Set(
		[...md.matchAll(/^#{2,3} (.+)$/gm)].map(([, heading = ""]) => headingSlug(heading.replace(/`/g, ""))),
	);

const ratelimits = v.parse(
	v.object({
		env: v.object({
			production: v.object({
				ratelimits: v.array(
					v.object({ name: v.string(), simple: v.object({ limit: v.number(), period: v.literal(60) }) }),
				),
			}),
		}),
	}),
	experimental_readRawConfig({ config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)) })
		.rawConfig,
).env.production.ratelimits;

describe("wiki", () => {
	it("states the API's per-minute budgets as wrangler.jsonc sets them", () => {
		const md = articles.get("api") ?? "";
		for (const name of ["RL_BASE", "RL_BUNDLE"]) {
			const limit = ratelimits.find((r) => r.name === name)?.simple.limit;
			expect(md, name).toContain(`**${limit}** requests`);
		}
	});

	it("links only to articles and headings that exist", () => {
		for (const [path, md] of articles) {
			for (const [, target = "", hash] of md.matchAll(/\]\(\/wiki\/([^)#]+)(?:#([^)]+))?\)/g)) {
				expect(articles.has(target), `${path} -> ${target}`).toBe(true);
				if (hash)
					expect(anchors(articles.get(target) ?? "").has(hash), `${path} -> ${target}#${hash}`).toBe(true);
			}
		}
	});
});
