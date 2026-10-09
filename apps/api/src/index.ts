/**
 * The Worker. Its default entrypoint is not cached and runs on every request: it refuses unidentified clients, then
 * hands the request to Api, the cached entrypoint that serves the public API and the purge the extractor calls.
 */

import { env, WorkerEntrypoint } from "cloudflare:workers";
import * as v from "valibot";
import { agentsSchema, refusal } from "./agents.ts";
import { api } from "./api.ts";
import { purge } from "./purge.ts";

const app = api.route("/", purge);
const UNIDENTIFIED = v.parse(agentsSchema, env.UNIDENTIFIED_AGENTS);

export class Api extends WorkerEntrypoint<Env> {
	override async fetch(request: Request): Promise<Response> {
		return app.fetch(request, this.env, this.ctx);
	}
}

export default {
	async fetch(request, _env, ctx): Promise<Response> {
		return refusal(request, UNIDENTIFIED) ?? ctx.exports.Api.fetch(request);
	},
} satisfies ExportedHandler<Env>;
