/** Clients that do not say who they are: no User-Agent, or one that starts with an HTTP library's bare default. */

import * as v from "valibot";
import { applyPolicy, NOT_CACHED } from "@carrier-explode/storage";
import { errorBody } from "./context.ts";

/** wrangler.jsonc vars.UNIDENTIFIED_AGENTS: the product tokens of library defaults, matched without case. */
export const agentsSchema = v.pipe(
	v.array(v.pipe(v.string(), v.regex(/^[^\s/]+$/))),
	v.transform((tokens): ReadonlySet<string> => new Set(tokens.map((t) => t.toLowerCase()))),
);

export type UnidentifiedAgents = v.InferOutput<typeof agentsSchema>;

/** A refused client can still read how to call the API, and the extractor's purge stays a plain curl. */
const isOpen = (path: string): boolean =>
	path === "/" || path === "/openapi.json" || path === "/robots.txt" || path.startsWith("/internal/");

const productToken = (agent: string): string => agent.trim().split(/[\s/]/, 1)[0]?.toLowerCase() ?? "";

export function isUnidentified(agent: string | null, unidentified: UnidentifiedAgents): boolean {
	const token = productToken(agent ?? "");
	return token === "" || unidentified.has(token);
}

const message = (origin: string): string =>
	"Please name your client in its User-Agent, with a URL or email we can reach you at if anything goes wrong: " +
	"`myproject/1.0 (+https://example.com; me@example.com)` is all we need. " +
	"An AI agent: please add your model and a short name for the task, e.g. `codex-gpt-5/uscc-apn-survey (+contact)`. " +
	`Docs: ${origin}/`;

/** The answer to an unidentified client, or null to serve it. Never stored, so it cannot answer anyone else. */
export function refusal(request: Request, unidentified: UnidentifiedAgents): Response | null {
	const url = new URL(request.url);
	if (isOpen(url.pathname) || !isUnidentified(request.headers.get("user-agent"), unidentified)) return null;
	const response = Response.json(errorBody(403, message(url.origin)), { status: 403 });
	applyPolicy(response.headers, NOT_CACHED);
	return response;
}
