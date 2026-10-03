/** ios.plan: the builds to extract, each with every iPhone IPSW. "Held" means releases/ios/<build>.json exists. */

import * as v from "valibot";

import { keys } from "../../../../../../src/lib/storage/keys.ts";
import type { JobContext, JobOutput, JobRunner, R2Client } from "../../../job.ts";
import { appledbFirmware, appledbKeys, deviceFirmwares, iphoneCatalog, newestIphone, type AppleDbEntry } from "../catalog.ts";
import { mapLimit } from "../map-limit.ts";
import { betaCandidates, plan, planBetas, planRebuild, toBuild, type Held, type PlannedBuild } from "./plan.ts";

/** The phone whose IPSW names each image (v1's DEVICE). */
export const PREFERRED_DEVICE = "iPhone17,1";
const DEFAULT_MAX = 3;

const HeldRelease = v.looseObject({
  id: v.string(),
  version: v.string(),
  devices: v.array(v.string()),
  released: v.exactOptional(v.string()),
  prerelease: v.boolean(),
});

export async function heldReleases(r2: R2Client): Promise<Held[]> {
  const ids = (await r2.list(keys.releases("ios"))).filter((k) => k.endsWith(".json"));
  return mapLimit(ids, 8, async (key) => {
    const r = v.parse(HeldRelease, await r2.getJson(key));
    return { build: r.id, version: r.version, devices: r.devices, prerelease: r.prerelease, ...(r.released ? { released: r.released } : {}) };
  });
}

/** valibot's inferred output is mutable; PlannedBuild is readonly. */
const toOutput = (b: PlannedBuild): JobOutput<"ios.plan">["builds"][number] => ({ ...b, ipsws: [...b.ipsws] });

async function rebuild(ctx: JobContext<"ios.plan">, held: readonly Held[]): Promise<PlannedBuild[]> {
  const cat = await iphoneCatalog();
  // ipsw.me lists no betas; AppleDB has their IPSWs.
  const betas = new Map<string, AppleDbEntry>();
  await mapLimit(held.filter((h) => !cat.byBuild.has(h.build)), 4, async (h) => {
    betas.set(h.build, await appledbFirmware(h.build));
  });
  const { builds, missing } = planRebuild(
    held,
    (b) => cat.byBuild.get(b) ?? [...(betas.get(b)?.ipsws ?? [])].map(([device, url]) => ({ device, url })),
    PREFERRED_DEVICE,
  );
  for (const b of missing) ctx.log(`${b}: no iPhone IPSW listed any more, not rebuilt`);
  return builds;
}

async function newBuilds(ctx: JobContext<"ios.plan">, held: readonly Held[], max: number): Promise<PlannedBuild[]> {
  const p = ctx.spec.params;
  const probe = await newestIphone();
  const preferred = (await deviceFirmwares(PREFERRED_DEVICE)).firmwares;
  const fallback = probe === PREFERRED_DEVICE ? [] : (await deviceFirmwares(probe)).firmwares;
  const chosen = plan(held, preferred, fallback, { cap: max, ...(p.version ? { only: p.version } : {}), ...(p.since ? { since: p.since } : {}) });

  const builds: PlannedBuild[] = [];
  if (chosen.length) {
    const cat = await iphoneCatalog();
    for (const fw of chosen) {
      const pairs = cat.byBuild.get(fw.build);
      if (!pairs) throw new Error(`${fw.build}: in ${fw.device}'s firmware list but not in the catalogue`);
      builds.push(toBuild(fw, pairs));
    }
  }
  // Not for one asked-for version; `since` floors releases only.
  if (p.version !== undefined || p.betas === false || builds.length >= max) return builds;
  // AppleDB being down must not cost the releases already planned.
  try {
    const candidates = betaCandidates(await appledbKeys(), held, [...preferred, ...fallback]);
    builds.push(...planBetas(await mapLimit(candidates, 4, appledbFirmware), PREFERRED_DEVICE, max - builds.length));
  } catch (e) {
    ctx.log(`betas skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
  return builds;
}

export const runPlan: JobRunner<"ios.plan"> = async (ctx): Promise<JobOutput<"ios.plan">> => {
  const held = await heldReleases(ctx.r2);
  const builds = ctx.spec.params.rebuild ? await rebuild(ctx, held) : await newBuilds(ctx, held, ctx.spec.params.max ?? DEFAULT_MAX);
  for (const b of builds) ctx.log(`${b.label} (${b.build}): ${b.ipsws.length} IPSWs`);
  return { builds: builds.map(toOutput) };
};
