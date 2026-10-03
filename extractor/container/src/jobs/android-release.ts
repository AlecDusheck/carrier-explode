/** android.release: a build's android.ota outputs merged into releases/android/<build>.json. */

import type { AndroidRelease } from "../../../../src/lib/schema/index.ts";
import { keys } from "../../../../src/lib/storage/keys.ts";
import { readJobOutput } from "../job-records.ts";
import type { JobContext, JobOutput } from "../job.ts";
import { AndroidReleaseError, carrierList, mergeSources } from "./android-merge.ts";

type OtaOutput = JobOutput<"android.ota">;

export async function androidRelease(ctx: JobContext<"android.release">): Promise<JobOutput<"android.release">> {
  const { build, version, patch, released, parts: ids } = ctx.spec.params;
  const parts: OtaOutput[] = [];
  for (const id of ids) {
    const part = await readJobOutput(ctx.r2, id, "android.ota");
    if (part.build !== build) throw new AndroidReleaseError(`${id} extracted ${part.build}, not ${build}`);
    parts.push(part);
  }
  const sources = mergeSources(parts);
  const release: AndroidRelease = {
    platform: "android",
    id: build,
    version,
    patch,
    ...(released === undefined ? {} : { released }),
    prerelease: false,
    devices: [...new Set(parts.map((p) => p.device))].sort(order),
    extractedAt: new Date().toISOString(),
    sources,
    carrierList: carrierList(parts),
  };
  await ctx.r2.putJson(keys.release("android", build), release);
  ctx.log(`${build}: ${Object.keys(sources).length} sources across ${release.devices.length} devices`);
  return { build, sources: Object.keys(sources).length };
}
