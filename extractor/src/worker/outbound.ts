/**
 * The container's way back into the Worker. The container calls plain
 * http://r2.internal and http://control.internal; the Containers runtime
 * routes those hosts here (outboundByHost), with ctx.containerId naming the
 * calling container's Durable Object. Everything else the container fetches
 * goes straight to the internet.
 */

import type { OutboundHandler, OutboundHandlerContext } from "@cloudflare/containers";

import { JOBS } from "../jobs.ts";
import { handleControl } from "../protocol/control.ts";
import { errorResponse, RequestError } from "../protocol/errors.ts";
import { handleR2 } from "../protocol/r2.ts";
import type { Env } from "./env.ts";
import { finishJob } from "./finish.ts";
import { r2Store } from "./r2-store.ts";

/** The calling container's Durable Object. */
function callerOf(env: Env, ctx: OutboundHandlerContext) {
  switch (ctx.className) {
    case "HeavyExtractor": return env.HEAVY.get(env.HEAVY.idFromString(ctx.containerId));
    case "LightExtractor": return env.LIGHT.get(env.LIGHT.idFromString(ctx.containerId));
    default: throw new RequestError(403, `unknown container class ${ctx.className}`);
  }
}

async function r2(req: Request, env: Env, ctx: OutboundHandlerContext): Promise<Response> {
  try {
    const launch = await callerOf(env, ctx).checkIn();
    if (!launch) throw new RequestError(403, "this container has no job");
    return await handleR2(req, r2Store(env.BUCKET), { writes: JOBS[launch.spec.type].writes });
  } catch (e) {
    return errorResponse(e);
  }
}

async function control(req: Request, env: Env, ctx: OutboundHandlerContext): Promise<Response> {
  try {
    const caller = callerOf(env, ctx);
    const launch = await caller.checkIn();
    if (!launch) throw new RequestError(403, "this container has no job");
    return await handleControl(req, {
      progress: (p) => caller.heartbeat(p),
      async done(result) {
        await finishJob(env, launch, result);
        await caller.finished();
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export const OUTBOUND: Record<string, OutboundHandler<Env>> = {
  "r2.internal": r2,
  "control.internal": control,
};
