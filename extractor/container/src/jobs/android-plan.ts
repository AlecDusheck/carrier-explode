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
 * - builds already in releases/android/ are skipped unless `rebuild`.
 */

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

/** Builds by id, each with every current device that has it. */
export function planBuilds(devices: readonly OtaDevice[], held: ReadonlySet<string>, rebuild: boolean): PlannedBuild[] {
  const byBuild = new Map<string, { first: OtaBuild; devices: Array<{ device: string; url: string }> }>();
  for (const d of currentDevices(devices)) {
    const general = d.builds.filter((b) => b.variant === undefined);
    for (const b of general.slice(-NEWEST_BUILDS)) {
      if (!rebuild && held.has(b.build)) continue;
      const entry = byBuild.get(b.build) ?? { first: b, devices: [] };
      entry.devices.push({ device: d.device, url: b.url });
      byBuild.set(b.build, entry);
    }
  }
  return [...byBuild.values()]
    .map(({ first, devices: list }) => ({
      build: first.build,
      version: androidVersion(first.android),
      patch: first.patch,
      devices: list.sort((a, b) => (a.device < b.device ? -1 : 1)),
    }))
    .sort((a, b) => (a.patch === b.patch ? (a.build < b.build ? -1 : 1) : a.patch < b.patch ? -1 : 1));
}

/** Build ids that already have releases/android/<id>.json. */
async function heldBuilds(ctx: JobContext<"android.plan">): Promise<Set<string>> {
  const prefix = keys.releasesPrefix("android");
  const held = await ctx.r2.list(prefix);
  return new Set(held.filter((k) => k.endsWith(".json")).map((k) => k.slice(prefix.length, -".json".length)));
}

export async function androidPlan(ctx: JobContext<"android.plan">): Promise<JobOutput<"android.plan">> {
  const devices = await fetchOtaPage();
  const builds = planBuilds(devices, await heldBuilds(ctx), ctx.spec.params.rebuild ?? false);
  ctx.log(`${devices.length} devices on the page; ${builds.length} builds to extract, ${builds.reduce((n, b) => n + b.devices.length, 0)} device OTAs`);
  return { builds };
}
