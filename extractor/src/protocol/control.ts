/**
 * The control.internal protocol: how a running job reports back.
 *
 *   POST /progress  { done, total, note? }   keeps the container awake, shows on GET /jobs/:id
 *   POST /done      JobResult                 records the job and wakes its Workflow
 *
 * The caller's job is never named in the request: the port is already bound to
 * the calling container (the Worker resolves it from ctx.containerId), so a
 * job cannot report for another.
 */

import { jobResultSchema, progressSchema, type JobResult, type Progress } from "../jobs.ts";
import { readJson } from "./body.ts";
import { errorResponse, RequestError } from "./errors.ts";

export interface ControlPort {
  progress(p: Progress): Promise<void>;
  done(result: JobResult): Promise<void>;
}

export async function handleControl(req: Request, port: ControlPort): Promise<Response> {
  try {
    const { pathname } = new URL(req.url);
    if (req.method !== "POST") throw new RequestError(405, `${req.method} ${pathname}: POST only`);
    if (pathname === "/progress") await port.progress(await readJson(req, progressSchema));
    else if (pathname === "/done") await port.done(await readJson(req, jobResultSchema));
    else throw new RequestError(404, `${pathname}: no such route`);
    return new Response(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
}
