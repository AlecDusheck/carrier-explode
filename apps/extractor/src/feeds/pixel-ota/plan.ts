/** Which Pixel builds to extract. Pure: the check fetches, this decides. */

import type * as v from "valibot";

import type { androidBuildSchema } from "../../jobs.ts";
import type { OtaBuild, OtaDevice } from "./page.ts";

/** The first Android with etc/CarrierSettings. */
const FIRST_ANDROID = 10;

type PlannedBuild = v.InferOutput<typeof androidBuildSchema>;

/** `17.0.0` -> `17`: Release.version names the Android release, not the point version. */
const androidVersion = (android: string): string => android.split(".")[0] ?? android;

const order = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/** Carrier and region variants are left out, and builds older than CarrierSettings. */
const planned = (b: OtaBuild): boolean => b.variant === undefined && Number(androidVersion(b.android)) >= FIRST_ANDROID;

/** Every build any device lists, with every device that lists it; one held with all of them is left out unless rebuilt. */
export function planBuilds(devices: readonly OtaDevice[], held: ReadonlyMap<string, ReadonlySet<string>>, rebuild: boolean): PlannedBuild[] {
  const byBuild = new Map<string, { first: OtaBuild; devices: Array<{ device: string; url: string }> }>();
  for (const d of devices) {
    for (const b of d.builds.filter(planned)) {
      const entry = byBuild.get(b.build) ?? { first: b, devices: [] };
      entry.devices.push({ device: d.device, url: b.url });
      byBuild.set(b.build, entry);
    }
  }
  const complete = (build: string, list: ReadonlyArray<{ device: string }>): boolean => {
    const has = held.get(build);
    return has !== undefined && list.every((x) => has.has(x.device));
  };
  return [...byBuild.values()]
    .filter(({ first, devices: list }) => rebuild || !complete(first.build, list))
    .map(({ first, devices: list }) => ({
      build: first.build,
      version: androidVersion(first.android),
      patch: first.patch,
      devices: list.sort((x, y) => order(x.device, y.device)),
    }))
    .sort((x, y) => order(x.patch, y.patch) || order(x.build, y.build));
}
