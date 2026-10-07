/**
 * Bearer-authed: POST /run {run, rebuild?, only?} checks a feed now; POST /run {run: "reindex", target} starts a reindex;
 * POST /run {run: "rederive", platform}; GET /runs/:id, an instance's status.
 */

import * as v from "valibot";

import type { Env } from "./env.ts";
import { describe, RequestError } from "./errors.ts";
import { runRequestSchema, type RunRequest } from "./pipelines.ts";
import type { IndexMessage } from "./indexing.ts";
import { queueIndex } from "./queues.ts";
import { checkFeed, pipelineOfInstance, reindexRun, startRuns, workflowOf } from "./runs.ts";

/** The response for a thrown value: its own status for a RequestError, 500 (and a log line) otherwise. */
function errorResponse(e: unknown): Response {
	if (e instanceof RequestError) return Response.json({ error: e.message }, { status: e.status });
	// Unexpected: keep the stack in the Worker's logs, give the caller the message.
	console.error(e);
	return Response.json({ error: describe(e) }, { status: 500 });
}

/** Throws 401 unless the request carries `Authorization: Bearer <RUN_TOKEN>`; compared in constant time. */
function authorize(req: Request, env: Env): void {
	const given = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
	if (!env.RUN_TOKEN || given === undefined) throw new RequestError(401, "bearer token required");
	const enc = new TextEncoder();
	const a = enc.encode(given);
	const b = enc.encode(env.RUN_TOKEN);
	if (a.byteLength !== b.byteLength || !crypto.subtle.timingSafeEqual(a, b))
		throw new RequestError(401, "bad token");
}

/** A JSON request body validated against `schema`; 400 with valibot's summary otherwise. */
async function readJson<S extends v.GenericSchema>(req: Request, schema: S): Promise<v.InferOutput<S>> {
	const raw: unknown = await req.json().catch((e: unknown) => {
		throw new RequestError(400, `body is not JSON: ${describe(e)}`);
	});
	const parsed = v.safeParse(schema, raw);
	if (!parsed.success) throw new RequestError(400, v.summarize(parsed.issues));
	return parsed.output;
}

function decoded(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		throw new RequestError(400, `bad percent-encoding in ${segment}`);
	}
}

async function run(body: RunRequest, env: Env): Promise<Response> {
	switch (body.run) {
		case "reindex":
			return Response.json(
				await startRuns(env, "reindex", [await reindexRun({ target: body.target }, new Date())], false),
			);
		case "rederive": {
			const message: IndexMessage = { kind: "rederive", platform: body.platform };
			await queueIndex(env, [message]);
			return Response.json({ queued: [message] });
		}
		default:
			return Response.json({ feed: body.run, ...(await checkFeed(env, body.run, body.rebuild, body.only)) });
	}
}

async function runStatus(id: string, env: Env): Promise<Response> {
	const pipeline = pipelineOfInstance(id);
	if (!pipeline) throw new RequestError(404, `${id}: not a run id`);
	// get() throws for an instance that does not exist: the caller's 404, not a 500.
	const instance = await workflowOf(env, pipeline)
		.get(id)
		.catch((e: unknown) => {
			throw new RequestError(404, `${id}: no such run (${describe(e)})`);
		});
	return Response.json({ id, pipeline, ...(await instance.status()) });
}

export async function handleApi(req: Request, env: Env): Promise<Response> {
	try {
		authorize(req, env);
		const { pathname } = new URL(req.url);
		const [, head, id, ...rest] = pathname.split("/");
		if (rest.length) throw new RequestError(404, `${pathname}: no such route`);
		if (head === "run" && id === undefined && req.method === "POST")
			return await run(await readJson(req, runRequestSchema), env);
		if (head === "runs" && id && req.method === "GET") return await runStatus(decoded(id), env);
		throw new RequestError(404, `${req.method} ${pathname}: no such route`);
	} catch (e) {
		return errorResponse(e);
	}
}
