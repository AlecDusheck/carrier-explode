/** android.release: a build's android.ota and android.modem outputs merged into releases/android/<build>.json. */

import type { AndroidRelease } from "@carrier-explode/schema";
import { keys } from "@carrier-explode/storage";
import { readJobOutput } from "../job-records.ts";
import type { JobContext } from "../job.ts";
import type { JobOutput } from "../../../src/jobs.ts";
import { AndroidReleaseError, carrierList, mergeModems, mergeSources } from "./android-merge.ts";

/** Another job's output for this build. */
async function partsOf<T extends "android.ota" | "android.modem">(ctx: JobContext<"android.release">, ids: readonly string[], type: T): Promise<JobOutput<T>[]> {
  const parts: JobOutput<T>[] = [];
  for (const id of ids) {
    const part = await readJobOutput(ctx.r2, id, type);
    if (part.build !== ctx.spec.params.build) throw new AndroidReleaseError(`${id} extracted ${part.build}, not ${ctx.spec.params.build}`);
    parts.push(part);
  }
  return parts;
}

export async function androidRelease(ctx: JobContext<"android.release">): Promise<JobOutput<"android.release">> {
  const { build, version, patch } = ctx.spec.params;
  const parts = await partsOf(ctx, ctx.spec.params.parts, "android.ota");
  const modems = mergeModems(await partsOf(ctx, ctx.spec.params.modems, "android.modem"));
  const sources = mergeSources(parts);
  const release: AndroidRelease = {
    platform: "android",
    id: build,
    version,
    patch,
    devices: [...new Set(parts.map((p) => p.device))].sort(),
    extractedAt: new Date().toISOString(),
    sources,
    carrierList: carrierList(parts),
    modems,
  };
  await ctx.r2.putJson(keys.release("android", build), release);
  ctx.log(`${build}: ${Object.keys(sources).length} sources across ${release.devices.length} devices, ${modems.length} modem groups`);
  return { build, sources: Object.keys(sources).length, modems: modems.length };
}
