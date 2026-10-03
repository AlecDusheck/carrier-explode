/**
 * android.release: one build's device outputs (android.ota) merged into
 * releases/android/<build>.json. Devices that ship the same bytes for a
 * source share one ReleaseSource; carrier_list.pb must be the same for every
 * device of a build, which was observed (CP3A.260905.009, 20 phones) and is
 * checked here, not assumed.
 */

import type { Release, ReleaseSource } from "../../../../src/lib/schema/index.ts";
import { keys } from "../../../../src/lib/storage/keys.ts";
import { readJobOutput } from "../job-records.ts";
import type { JobContext, JobOutput } from "../job.ts";

type OtaOutput = JobOutput<"android.ota">;

export class AndroidReleaseError extends Error {
  override name = "AndroidReleaseError";
}

const order = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/** The one carrier list every device with CarrierSettings agrees on. */
function carrierList(parts: readonly OtaOutput[]): string | undefined {
  const shas = new Set(parts.flatMap((p) => (p.carrierList === null ? [] : [p.carrierList])));
  if (shas.size > 1) {
    const by = parts.map((p) => `${p.device}=${p.carrierList ?? "none"}`).join(", ");
    throw new AndroidReleaseError(`carrier_list.pb differs between devices of one build: ${by}`);
  }
  return [...shas][0];
}

/** sourceKey -> one entry per distinct artifact, with the devices carrying it; most widely shipped first. */
export function mergeSources(parts: readonly OtaOutput[]): Record<string, ReleaseSource[]> {
  const bySource = new Map<string, Map<string, { version: string; size: number; devices: string[] }>>();
  for (const part of parts) {
    for (const f of part.files) {
      const shas = bySource.get(f.source) ?? new Map<string, { version: string; size: number; devices: string[] }>();
      const entry = shas.get(f.sha);
      if (entry && (entry.version !== f.version || entry.size !== f.size)) {
        throw new AndroidReleaseError(`${f.source} ${f.sha}: devices disagree on version or size for the same bytes`);
      }
      shas.set(f.sha, { version: f.version, size: f.size, devices: [...(entry?.devices ?? []), part.device] });
      bySource.set(f.source, shas);
    }
  }
  const out: Record<string, ReleaseSource[]> = {};
  for (const source of [...bySource.keys()].sort(order)) {
    const shas = bySource.get(source);
    if (!shas) continue;
    out[source] = [...shas]
      .map(([sha, e]) => ({ sha, version: e.version, size: e.size, devices: e.devices.sort(order) }))
      .sort((a, b) => b.devices.length - a.devices.length || order(a.sha, b.sha));
  }
  return out;
}

export async function androidRelease(ctx: JobContext<"android.release">): Promise<JobOutput<"android.release">> {
  const { build, version, patch, released, parts: ids } = ctx.spec.params;
  const parts: OtaOutput[] = [];
  for (const id of ids) {
    const part = await readJobOutput(ctx.r2, id, "android.ota");
    if (part.build !== build) throw new AndroidReleaseError(`${id} extracted ${part.build}, not ${build}`);
    parts.push(part);
  }
  const list = carrierList(parts);
  const sources = mergeSources(parts);
  const release: Release = {
    platform: "android",
    id: build,
    version,
    patch,
    ...(released === undefined ? {} : { released }),
    devices: [...new Set(parts.map((p) => p.device))].sort(order),
    extractedAt: new Date().toISOString(),
    sources,
    ...(list === undefined ? {} : { carrierList: list }),
  };
  await ctx.r2.putJson(keys.release("android", build), release);
  const count = Object.keys(sources).length;
  ctx.log(`${build}: ${count} sources across ${release.devices.length} devices`);
  return { build, sources: count };
}
