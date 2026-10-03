/**
 * The manual interface, all bearer-authed:
 *   POST /run       { pipeline, params? }  → 201 { id, pipeline }
 *   GET  /runs/:id                          → the Workflow instance's status
 *   GET  /jobs/:id                          → jobs/<id>.json once done, else the live record (spec, progress)
 */

import { getContainer } from "@cloudflare/containers";

import { keys } from "../../../src/lib/storage/keys.ts";
import { isJobType, JOBS } from "../jobs.ts";
import { readJson } from "../protocol/body.ts";
import { errorResponse, RequestError } from "../protocol/errors.ts";
import { authorize } from "./auth.ts";
import type { Env } from "./env.ts";
import { manualInstanceId, pipelineOfInstance, typeOfJobId } from "./ids.ts";
import { PIPELINE_NAMES, runRequestSchema } from "./pipelines.ts";
import { createRun, workflowOf } from "./workflows.ts";

export async function handleApi(req: Request, env: Env): Promise<Response> {
  try {
    authorize(req, env);
    const { pathname } = new URL(req.url);
    const [, head, id, ...rest] = pathname.split("/");
    if (rest.length) throw new RequestError(404, `${pathname}: no such route`);
    if (head === "run" && id === undefined && req.method === "POST") return await run(req, env);
    if (head === "runs" && id && req.method === "GET") return await runStatus(decodeURIComponent(id), env);
    if (head === "jobs" && id && req.method === "GET") return await jobStatus(decodeURIComponent(id), env);
    throw new RequestError(404, `${req.method} ${pathname}: no such route`);
  } catch (e) {
    return errorResponse(e);
  }
}

async function run(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req, runRequestSchema);
  const instance = await createRun(env, body, manualInstanceId(body.pipeline, new Date()));
  return Response.json({ id: instance.id, pipeline: body.pipeline }, { status: 201 });
}

async function runStatus(id: string, env: Env): Promise<Response> {
  const pipeline = pipelineOfInstance(id, PIPELINE_NAMES);
  if (!pipeline) throw new RequestError(404, `${id}: not a run id`);
  const instance = await workflowOf(env, pipeline).get(id);
  return Response.json({ id, pipeline, ...(await instance.status()) });
}

async function jobStatus(id: string, env: Env): Promise<Response> {
  const done = await env.BUCKET.get(keys.job(id));
  if (done) return new Response(done.body, { headers: { "content-type": "application/json" } });
  const type = typeOfJobId(id);
  if (type === undefined || !isJobType(type)) throw new RequestError(404, `${id}: not a job id`);
  const ns = JOBS[type].size === "heavy" ? env.HEAVY : env.LIGHT;
  const live = await getContainer(ns, id).record();
  if (!live) throw new RequestError(404, `${id}: no such job`);
  return Response.json({ live: true, ...live });
}
