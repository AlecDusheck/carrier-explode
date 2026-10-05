/** One iOS build: every IPSW (heavy) and the build's modems, its release once all are in, then profiles and a publish. */

import * as v from "valibot";

import type { Json } from "@carrier-explode/schema/types";
import { describe } from "../errors.ts";
import { failures, fanOut, succeeded } from "../fan-out.ts";
import { PIPELINES } from "../worker/pipelines.ts";
import { runJob, type RunContext } from "../worker/run-job.ts";
import { Pipeline, settle } from "./pipeline.ts";
import { normalizeShas, requestPublish } from "./tail.ts";

export class IosBuildWorkflow extends Pipeline {
  protected async steps(c: RunContext, payload: unknown): Promise<Json> {
    const b = v.parse(PIPELINES["ios-build"].params, payload);
    // Settled: a failed IPSW must not leave the modems job running unawaited, nor the other way round.
    const [extracted, modems] = await Promise.allSettled([
      fanOut(b.ipsws, b.ipsws.length, async ({ device, url }) =>
        (await runJob(c, "ios.ipsw", device, { build: b.build, version: b.version, label: b.label, url, device })).id),
      runJob(c, "ios.modems", b.build, { build: b.build, ipsws: b.ipsws }),
    ]);
    if (extracted.status === "rejected") throw extracted.reason;
    // Each IPSW carries only its own phones' override files, so the release needs every one.
    const lost = [...failures(extracted.value), ...(modems.status === "rejected" ? [describe(modems.reason)] : [])];
    if (lost.length || modems.status === "rejected") return settle({}, lost);

    const { output } = await runJob(c, "ios.release", b.build, {
      build: b.build, version: b.version, label: b.label, prerelease: b.prerelease,
      ...(b.released !== undefined ? { released: b.released } : {}),
      parts: succeeded(extracted.value),
      modems: modems.value.id,
    });
    const normalized = await normalizeShas(c, output.shas);
    const publish = await requestPublish(c);
    return settle({ build: b.build, profiles: normalized.written, publish }, normalized.failed);
  }
}
