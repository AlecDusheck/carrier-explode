/**
 * New Pixel builds: plan, read every device's OTA of each build (light, range
 * requests; carrier settings differ per device within a build), then one
 * release per build from its device reads, then the shared tail. Like
 * ios.release, a build is released only when every one of its device jobs
 * finished: a partial release would claim a device lacks settings it has.
 */

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

    const otas = builds.flatMap((b) => b.devices.map((d) => ({ build: b, device: d.device, url: d.url })));
    const read = await fanOut(otas, MAX_INSTANCES.light, async ({ build, device, url }) => {
      const done = await runJob(c, "android.ota", `${build.build}.${device}`, { build: build.build, device, url, version: build.version, patch: build.patch });
      return { id: done.id, output: done.output };
    });

    // fanOut keeps input order, so read[i] is otas[i]'s result.
    const failedBuilds = new Set(otas.filter((_, i) => !read[i]?.ok).map((o) => o.build.build));
    const complete = builds.filter((b) => !failedBuilds.has(b.build));
    const released = await fanOut(complete, MAX_INSTANCES.light, async (b) => {
      const parts = succeeded(read).filter((r) => r.output.build === b.build);
      await runJob(c, "android.release", b.build, { build: b.build, version: b.version, patch: b.patch, parts: parts.map((p) => p.id) });
      return parts.flatMap((p) => p.output.files.map((f) => f.sha));
    });

    const normalized = await normalizeShas(c, succeeded(released).flat());
    const published = await publish(c, { force: false });
    return settle(
      { builds: builds.length, released: succeeded(released).length, profiles: normalized.written, carriers: published.index.carriers },
      [...failures(read), ...failures(released), ...normalized.failed],
    );
  }
}
