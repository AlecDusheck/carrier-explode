/** New Pixel builds: plan, read each OTA's CarrierSettings over range requests (light), then the shared tail. */

import * as v from "valibot";

import type { Json } from "../../../src/lib/schema/types.ts";
import { fanOut, failures, succeeded } from "../fan-out.ts";
import { MAX_INSTANCES } from "../worker/instances.ts";
import { PIPELINES } from "../worker/pipelines.ts";
import { runJob, type RunContext } from "../worker/run-job.ts";
import { Pipeline, settle } from "./pipeline.ts";
import { normalizeShas, publish } from "./publish.ts";

export class AndroidPipeline extends Pipeline {
  protected readonly pipeline = "android";

  protected async steps(c: RunContext, payload: unknown): Promise<Json> {
    const plan = await runJob(c, "android.plan", "plan", v.parse(PIPELINES.android.params, payload));
    const builds = plan.output.builds;
    if (!builds.length) return { builds: 0 };
    const otas = await fanOut(builds, MAX_INSTANCES.light, async (b) =>
      (await runJob(c, "android.ota", `${b.device}.${b.build}`, b)).output);
    const normalized = await normalizeShas(c, succeeded(otas).flatMap((o) => o.shas));
    const published = await publish(c, { force: false });
    return settle(
      { builds: builds.length, profiles: normalized.written, carriers: published.index.carriers },
      [...failures(otas), ...normalized.failed],
    );
  }
}
