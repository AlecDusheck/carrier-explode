/**
 * android.plan: which Pixel builds to extract. Carrier settings differ per
 * device generation within one build (CP3A.260905.009: 11 distinct sets
 * across 20 phones), so every build fans out to every device it ships for.
 *
 * Policy, from the OTA page alone:
 * - current devices: those whose newest general build is within
 *   CURRENT_MONTHS of the newest build on the page (drops retired Pixels);
 * - per current device, its NEWEST_BUILDS newest general builds;
 * - general builds only: carrier/region variants (`CP2A.260805.005.A1,
 *   Rogers`) are skipped (see the report's open issues);
 * - builds already in releases/android/ are skipped unless `rebuild`, or
 *   unless the page now lists a device the held release lacks.
 */

import * as v from "valibot";

import { keys } from "../../../../src/lib/storage/keys.ts";
import type { JobContext, JobOutput } from "../job.ts";
import { fetchOtaPage, type OtaBuild, type OtaDevice } from "./android-page.ts";

const NEWEST_BUILDS = 3;
const CURRENT_MONTHS = 6;

type PlannedBuild = JobOutput<"android.plan">["builds"][number];

/** YYYY-MM as a month count, for windows. */
const monthIndex = (patch: string): number => Number(patch.slice(0, 4)) * 12 + Number(patch.slice(5, 7)) - 1;

/** `17.0.0` -> `17`: Release.version names the Android release, not the point version. */
const androidVersion = (android: string): string => android.split(".")[0] ?? android;

function currentDevices(devices: readonly OtaDevice[]): OtaDevice[] {
  const newest = Math.max(...devices.flatMap((d) => d.builds.map((b) => monthIndex(b.patch))));
  return devices.filter((d) => {
    const last = d.builds.filter((b) => b.variant === undefined).at(-1);
    return last !== undefined && newest - monthIndex(last.patch) < CURRENT_MONTHS;
  });
}

/**
 * Builds by id. A build is picked by any device's newest few, then lists
 * every current device that has it: Release.devices must be complete.
 */
export function planBuilds(devices: readonly OtaDevice[], held: ReadonlyMap<string, ReadonlySet<string>>, rebuild: boolean): PlannedBuild[] {
  const current = currentDevices(devices);
  const general = (d: OtaDevice): OtaBuild[] => d.builds.filter((b) => b.variant === undefined);
  const picked = new Set(current.flatMap((d) => general(d).slice(-NEWEST_BUILDS).map((b) => b.build)));
  const byBuild = new Map<string, { first: OtaBuild; devices: Array<{ device: string; url: string }> }>();
  for (const d of current) {
    for (const b of general(d)) {
      if (!picked.has(b.build)) continue;
      const entry = byBuild.get(b.build) ?? { first: b, devices: [] };
      entry.devices.push({ device: d.device, url: b.url });
      byBuild.set(b.build, entry);
    }
  }
  const order = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
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

const heldRelease = v.object({ id: v.string(), devices: v.array(v.string()) });

/** Held releases: build id -> the devices it was extracted from. */
async function heldBuilds(ctx: JobContext<"android.plan">): Promise<Map<string, Set<string>>> {
  const held = new Map<string, Set<string>>();
  for (const key of await ctx.r2.list(keys.releasesPrefix("android"))) {
    if (!key.endsWith(".json")) continue;
    const release = v.parse(heldRelease, await ctx.r2.getJson(key));
    held.set(release.id, new Set(release.devices));
  }
  return held;
}

export async function androidPlan(ctx: JobContext<"android.plan">): Promise<JobOutput<"android.plan">> {
  const devices = await fetchOtaPage();
  const builds = planBuilds(devices, await heldBuilds(ctx), ctx.spec.params.rebuild ?? false);
  ctx.log(`${devices.length} devices on the page; ${builds.length} builds to extract, ${builds.reduce((n, b) => n + b.devices.length, 0)} device OTAs`);
  return { builds };
}
