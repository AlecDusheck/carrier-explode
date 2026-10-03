/** Merging a build's per-device android.ota outputs: pure, so android.release stays I/O only. */

import type { AndroidArtifact } from "../../../../src/lib/schema/index.ts";
import type { JobOutput } from "../job.ts";

type OtaOutput = JobOutput<"android.ota">;

export class AndroidReleaseError extends Error {
  override name = "AndroidReleaseError";
}

const order = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/** The build's carrier_list.pb, which every device with CarrierSettings must share. */
export function carrierList(parts: readonly OtaOutput[]): string {
  const shas = new Set(parts.flatMap((p) => (p.carrierList === null ? [] : [p.carrierList])));
  const [only, ...rest] = shas;
  if (only === undefined) throw new AndroidReleaseError("no device of the build has CarrierSettings");
  if (rest.length) throw new AndroidReleaseError(`carrier_list.pb differs between devices: ${parts.map((p) => `${p.device}=${p.carrierList}`).join(", ")}`);
  return only;
}

/** sourceKey -> its distinct artifacts, most widely shipped first. */
export function mergeSources(parts: readonly OtaOutput[]): Record<string, AndroidArtifact[]> {
  const bySource = new Map<string, Map<string, { version: string; size: number; devices: string[] }>>();
  for (const part of parts) {
    for (const f of part.files) {
      const shas = bySource.get(f.source) ?? new Map<string, { version: string; size: number; devices: string[] }>();
      bySource.set(f.source, shas);
      const seen = shas.get(f.sha);
      if (!seen) shas.set(f.sha, { version: f.version, size: f.size, devices: [part.device] });
      else if (seen.version !== f.version || seen.size !== f.size) throw new AndroidReleaseError(`${f.source} ${f.sha}: devices disagree on its version or size`);
      else seen.devices.push(part.device);
    }
  }
  const out: Record<string, AndroidArtifact[]> = {};
  for (const [source, shas] of [...bySource].sort(([a], [b]) => order(a, b))) {
    out[source] = [...shas]
      .map(([sha, e]) => ({ sha, version: e.version, size: e.size, devices: e.devices.sort(order) }))
      .sort((a, b) => b.devices.length - a.devices.length || order(a.sha, b.sha));
  }
  return out;
}
