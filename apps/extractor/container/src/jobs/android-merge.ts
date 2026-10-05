/** Merging a build's per-device android.ota and android.modem outputs: pure, so android.release stays I/O only. */

import { compareUtf8 } from "@carrier-explode/binary";
import { parseSourceKey, sourceKey, type AndroidArtifact, type AndroidModem, type SourceKey } from "@carrier-explode/schema";
import type { JobOutput } from "../../../src/jobs.ts";

type OtaOutput = JobOutput<"android.ota">;
type ModemOutput = JobOutput<"android.modem">;

export class AndroidReleaseError extends Error {
  override name = "AndroidReleaseError";
}

/** One artifact of a source, as the devices so far ship it. */
interface Shipped {
  readonly sha: string;
  readonly version: string;
  readonly size: number;
  readonly devices: string[];
}

/** The build's carrier_list.pb, which every device with CarrierSettings must share. */
export function carrierList(parts: readonly OtaOutput[]): string {
  const shas = new Set(parts.flatMap((p) => (p.carrierList === null ? [] : [p.carrierList])));
  const [only, ...rest] = shas;
  if (only === undefined) throw new AndroidReleaseError("no device of the build has CarrierSettings");
  if (rest.length) throw new AndroidReleaseError(`carrier_list.pb differs between devices: ${parts.map((p) => `${p.device}=${p.carrierList}`).join(", ")}`);
  return only;
}

function androidSource(key: string): SourceKey<"android"> {
  const ref = parseSourceKey(key);
  if (ref?.platform !== "android") throw new AndroidReleaseError(`${key} is not an Android source key`);
  return sourceKey({ ...ref, platform: "android" });
}

/** sourceKey -> its distinct artifacts, most widely shipped first. An others.pb part takes others.pb's version, so the same bytes can ship at a different version on each device: an artifact is its bytes and version. */
export function mergeSources(parts: readonly OtaOutput[]): Record<SourceKey<"android">, AndroidArtifact[]> {
  const bySource = new Map<string, Map<string, Shipped>>();
  for (const part of parts) {
    for (const f of part.files) {
      const artifacts = bySource.get(f.source) ?? new Map<string, Shipped>();
      bySource.set(f.source, artifacts);
      const id = `${f.sha} ${f.version}`;
      const seen = artifacts.get(id);
      if (seen) seen.devices.push(part.device);
      else artifacts.set(id, { sha: f.sha, version: f.version, size: f.size, devices: [part.device] });
    }
  }
  const out: Record<SourceKey<"android">, AndroidArtifact[]> = {};
  for (const source of [...bySource.keys()].sort()) {
    out[androidSource(source)] = [...(bySource.get(source)?.values() ?? [])]
      .map((e) => ({ sha: e.sha, version: e.version, size: e.size, devices: e.devices.toSorted() }))
      .sort((a, b) => b.devices.length - a.devices.length || compareUtf8(a.sha, b.sha) || compareUtf8(a.version, b.version));
  }
  return out;
}

/** Devices with the same family, firmware and config shas share one AndroidModem; devices without a modem have none. */
export function mergeModems(parts: readonly ModemOutput[]): AndroidModem[] {
  const groups = new Map<string, { readonly modem: NonNullable<ModemOutput["modem"]>; readonly devices: string[] }>();
  for (const { device, modem } of parts) {
    if (modem === null) continue;
    const configs = Object.entries(modem.configs).sort(([a], [b]) => compareUtf8(a, b));
    const key = JSON.stringify([modem.family, modem.firmware, configs]);
    const group = groups.get(key);
    if (group) group.devices.push(device);
    else groups.set(key, { modem: { ...modem, configs: Object.fromEntries(configs) }, devices: [device] });
  }
  return [...groups.values()]
    .map(({ modem, devices }) => ({ family: modem.family, firmware: modem.firmware, devices: devices.toSorted(), configs: modem.configs }))
    .sort((a, b) => compareUtf8(a.firmware, b.firmware) || compareUtf8(a.devices.join(), b.devices.join()));
}
