/** Bearer-authed: POST /run {run, options? | params?}, GET /runs/:id, GET /jobs/:id. */

import { keys } from "@carrier-explode/storage";
import { describe, errorResponse, RequestError } from "../errors.ts";
import { authorize } from "./auth.ts";
import { readJson } from "./body.ts";
import type { Env } from "./env.ts";
import { checkFeed } from "./feeds.ts";
import { pipelineOfInstance, timedInstanceId } from "./ids.ts";
import { runRequestSchema, type RunRequest } from "./pipelines.ts";
import { createRun, publishRun, workflowOf, type Run } from "./workflows.ts";

export async function handleApi(req: Request, env: Env): Promise<Response> {
  try {
    authorize(req, env);
    const { pathname } = new URL(req.url);
    const [, head, id, ...rest] = pathname.split("/");
    if (rest.length) throw new RequestError(404, `${pathname}: no such route`);
    if (head === "run" && id === undefined && req.method === "POST") return await run(await readJson(req, runRequestSchema), env);
    if (head === "runs" && id && req.method === "GET") return await runStatus(decoded(id), env);
    if (head === "jobs" && id && req.method === "GET") return await jobRecord(decoded(id), env);
    throw new RequestError(404, `${req.method} ${pathname}: no such route`);
  } catch (e) {
    return errorResponse(e);
  }
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new RequestError(400, `bad percent-encoding in ${segment}`);
  }
}

/** A feed runs its check; reindex, publish and labels start at once. */
async function run(body: RunRequest, env: Env): Promise<Response> {
  const now = new Date();
  let started: Run;
  switch (body.run) {
    case "ios-images":
    case "ios-ota":
    case "android":
      return Response.json({ feed: body.run, ...(await checkFeed(env, { feed: body.run, options: body.options })) });
    case "reindex":
      started = { pipeline: "reindex", id: timedInstanceId("reindex", now), params: body.params };
      break;
    case "publish":
      started = publishRun(now, body.params.force ?? false);
      break;
    case "labels":
      started = { pipeline: "labels", id: timedInstanceId("labels", now), params: {} };
      break;
  }
  await createRun(env, started);
  return Response.json({ started: started.id }, { status: 201 });
}

async function runStatus(id: string, env: Env): Promise<Response> {
  const pipeline = pipelineOfInstance(id);
  if (!pipeline) throw new RequestError(404, `${id}: not a run id`);
  // get() throws for an instance that does not exist: the caller's 404, not a 500.
  const instance = await workflowOf(env, pipeline).get(id).catch((e: unknown) => {
    throw new RequestError(404, `${id}: no such run (${describe(e)})`);
  });
  return Response.json({ id, pipeline, ...(await instance.status()) });
}

async function jobRecord(id: string, env: Env): Promise<Response> {
  const done = await env.BUCKET.get(keys.job(id));
  if (!done) throw new RequestError(404, `${id}: no record (running, or no such job)`);
  return new Response(done.body, { headers: { "content-type": "application/json" } });
}
