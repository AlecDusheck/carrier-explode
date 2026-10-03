/**
 * New iOS images: plan, extract every IPSW of every new build (heavy, one
 * container each), the build's modem packages alongside, then one release per
 * build from its IPSWs, then the shared tail. A build is released only when
 * every one of its IPSWs extracted: each IPSW carries only its own phones'
 * override files, so a partial merge would silently lose some.
 */

import * as v from "valibot";

import type { Json } from "../../../src/lib/schema/index.ts";
import { fanOut, failures } from "../fan-out.ts";
import { MAX_INSTANCES } from "../worker/instances.ts";
import { PIPELINES } from "../worker/pipelines.ts";
import { runJob, type RunContext } from "../worker/run-job.ts";
import { Pipeline, settle } from "./pipeline.ts";
import { normalizeShas, publish } from "./publish.ts";

export class IosImagesPipeline extends Pipeline {
  protected readonly pipeline = "ios-images";

  protected async steps(c: RunContext, payload: unknown): Promise<Json> {
    const plan = await runJob(c, "ios.plan", "plan", v.parse(PIPELINES["ios-images"].params, payload));
    const builds = plan.output.builds;
    if (!builds.length) return { builds: 0 };

    const ipsws = builds.flatMap((b) => b.ipsws.map((i) => ({ build: b, device: i.device, url: i.url })));
    const [extracted, modems] = await Promise.all([
      fanOut(ipsws, MAX_INSTANCES.heavy, async ({ build, device, url }) => ({
        build: build.build,
        id: (await runJob(c, "ios.ipsw", `${build.build}.${device}`, { build: build.build, version: build.version, label: build.label, url, device })).id,
      })),
      fanOut(builds, MAX_INSTANCES.light, async (b) => ({
        build: b.build,
        id: (await runJob(c, "ios.modems", b.build, { build: b.build, ipsws: b.ipsws })).id,
      })),
    ]);

    const failedBuilds = new Set(extracted.flatMap((r) => (r.ok ? [] : [r.item.build.build])));
    const complete = builds.filter((b) => !failedBuilds.has(b.build));
    const released = await fanOut(complete, MAX_INSTANCES.light, async (b) => {
      const parts = extracted.flatMap((r) => (r.ok && r.value.build === b.build ? [r.value.id] : []));
      const modemJob = modems.find((r) => r.ok && r.value.build === b.build);
      const done = await runJob(c, "ios.release", b.build, {
        build: b.build, version: b.version, label: b.label,
        ...(b.released !== undefined ? { released: b.released } : {}),
        ...(b.prerelease !== undefined ? { prerelease: b.prerelease } : {}),
        parts,
        modems: modemJob?.ok ? modemJob.value.id : null,
      });
      return done.output;
    });

    const shas = released.flatMap((r) => (r.ok ? r.value.shas : []));
    const normalized = await normalizeShas(c, shas);
    const published = await publish(c, { force: false });
    return settle(
      { builds: builds.length, released: released.filter((r) => r.ok).length, profiles: normalized.written, carriers: published.index.carriers },
      [...failures(extracted), ...failures(modems), ...failures(released), ...normalized.failed],
    );
  }
}
