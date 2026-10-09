import { fileURLToPath } from "node:url";

import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { experimental_readRawConfig } from "wrangler";

import { agentsSchema, isUnidentified, refusal } from "../src/agents.ts";

const { rawConfig } = experimental_readRawConfig({
	config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
});
const UNIDENTIFIED = v.parse(
	v.object({
		env: v.object({ production: v.object({ vars: v.object({ UNIDENTIFIED_AGENTS: agentsSchema }) }) }),
	}),
	rawConfig,
).env.production.vars.UNIDENTIFIED_AGENTS;

describe("isUnidentified", () => {
	it.for([
		null,
		"",
		"  ",
		"curl/8.7.1",
		"Python/3.11 aiohttp/3.14.4",
		"Go-http-client/1.1",
		"PYTHON-REQUESTS/2.34.2",
	])("refuses %j", (agent) => expect(isUnidentified(agent, UNIDENTIFIED)).toBe(true));

	it.for([
		"Codex USCellular research",
		"fold7-research/1.0",
		"CarrierFix-Research/0.1",
		"mytool/1.0 python-requests/2.31",
		"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
		"curly/1.0",
	])("serves %j", (agent) => expect(isUnidentified(agent, UNIDENTIFIED)).toBe(false));
});

const request = (path: string, agent: string): Request =>
	new Request(`https://api.example${path}`, { headers: { "user-agent": agent } });

describe("refusal", () => {
	it("answers 403 in the error shape, never stored", async () => {
		const res = refusal(request("/v1/platforms", "curl/8.7.1"), UNIDENTIFIED);
		expect(res?.status).toBe(403);
		expect(res?.headers.get("cache-control")).toBe("private, no-store");
		expect(res?.headers.has("cloudflare-cdn-cache-control")).toBe(false);
		expect(await res?.json()).toMatchObject({ error: { status: 403, code: "unidentified_client" } });
	});

	it.for(["/", "/openapi.json", "/robots.txt", "/internal/purge"])("leaves %s open", (path) =>
		expect(refusal(request(path, "curl/8.7.1"), UNIDENTIFIED)).toBeNull(),
	);
});
