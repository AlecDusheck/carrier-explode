/**
 * ios.plan: which iOS builds to extract, each with every iPhone IPSW, so the
 * Workflow can fan out one ios.ipsw per IPSW and one ios.release per build.
 * "Held" is releases/ios/<build>.json existing. Writes nothing.
 */

import * as v from "valibot";

import { keys } from "../../../../../../src/lib/storage/keys.ts";
import type { JobContext, JobOutput, JobRunner, R2Client } from "../../../job.ts";
import { appledbFirmware, appledbKeys, deviceFirmwares, iphoneCatalog, mapLimit, newestIphone, type AppleDbEntry, type IphoneCatalog } from "../catalog.ts";
import { betaCandidates, plan, planBetas, planRebuild, toBuild, type Held, type PlannedBuild } from "./plan.ts";

/**
 * The phone whose IPSW names each image (v1's DEVICE variable): an iPhone 16
 * Pro, recent enough to receive releases for years. Releases it no longer gets
 * are named by the newest iPhone instead.
 */
export const PREFERRED_DEVICE = "iPhone17,1";
const DEFAULT_MAX = 3;

const HeldRelease = v.looseObject({
  id: v.string(),
  version: v.string(),
  devices: v.array(v.string()),
  released: v.optional(v.string()),
});

/** Every image in the bucket, as the planner compares against. */
export async function heldReleases(r2: R2Client): Promise<Held[]> {
  const ids = (await r2.list(keys.releasesPrefix("ios"))).filter((k) => k.endsWith(".json"));
  return mapLimit(ids, 8, async (key) => {
    const r = v.parse(HeldRelease, await r2.getJson(key));
    return { build: r.id, version: r.version, devices: r.devices, ...(r.released ? { released: r.released } : {}) };
  });
}

/** Release days by build, from every firmware ipsw.me lists. */
function releaseDays(cat: IphoneCatalog): Map<string, string> {
  const out = new Map<string, string>();
  for (const fws of cat.byDevice.values()) for (const f of fws) if (f.released && !out.has(f.build)) out.set(f.build, f.released);
  return out;
}

async function rebuild(ctx: JobContext<"ios.plan">, held: readonly Held[]): Promise<PlannedBuild[]> {
  const cat = await iphoneCatalog();
  const days = releaseDays(cat);
  // Betas are not on ipsw.me: their IPSWs and dates come from AppleDB, fetched up front.
  const need = held.filter((h) => !cat.byBuild.has(h.build) || (!h.released && !days.has(h.build))).map((h) => h.build);
  const fromDb = new Map<string, AppleDbEntry>();
  await mapLimit(need, 4, async (build) => {
    try {
      fromDb.set(build, await appledbFirmware(build));
    } catch (e) {
      ctx.log(`AppleDB has no usable record for ${build}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  const { builds, missing } = planRebuild(
    held,
    (b) => cat.byBuild.get(b) ?? [...(fromDb.get(b)?.ipsws ?? [])].map(([device, url]) => ({ device, url })),
    (b) => days.get(b) ?? fromDb.get(b)?.released,
    PREFERRED_DEVICE,
  );
  for (const b of missing) ctx.log(`${b}: no iPhone IPSW found, not rebuilt`);
  return builds;
}

export const runPlan: JobRunner<"ios.plan"> = async (ctx): Promise<JobOutput<"ios.plan">> => {
  const p = ctx.spec.params;
  const max = p.max ?? DEFAULT_MAX;
  const held = await heldReleases(ctx.r2);
  ctx.log(`${held.length} images held`);
  if (p.rebuild) return { builds: await rebuild(ctx, held) };

  const probe = await newestIphone();
  const preferred = (await deviceFirmwares(PREFERRED_DEVICE)).firmwares;
  const fallback = probe === PREFERRED_DEVICE ? [] : (await deviceFirmwares(probe)).firmwares;
  const chosen = plan(held, preferred, fallback, { cap: max, ...(p.version ? { only: p.version } : {}), ...(p.since ? { since: p.since } : {}) });

  const builds: PlannedBuild[] = [];
  if (chosen.length) {
    const cat = await iphoneCatalog();
    for (const c of chosen) builds.push(toBuild(c, cat.byBuild.get(c.build) ?? []));
  }

  // Not when one version was asked for; `since` is only a floor for releases, and betas are above it anyway.
  if (p.version === undefined && p.betas !== false && builds.length < max) {
    // AppleDB being down must never cost a release: betas are best effort, and a failure is logged.
    try {
      const candidates = betaCandidates(await appledbKeys(), held, [...preferred, ...fallback]);
      const entries = await mapLimit(candidates, 4, appledbFirmware);
      builds.push(...planBetas(entries, PREFERRED_DEVICE, max - builds.length));
    } catch (e) {
      ctx.log(`betas skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const b of builds) ctx.log(`plan: ${b.label} (${b.build}), ${b.ipsws.length} IPSWs`);
  return { builds: builds.map((b) => ({ ...b, ipsws: [...b.ipsws] })) };
};
