/** The IPSW feed: iPhone builds no release holds, each with every iPhone IPSW. */

import { allOrThrow, fanOut } from "../../fan-out.ts";
import { describe } from "../../errors.ts";
import type { Env } from "../../worker/env.ts";
import type { FeedOptions } from "../../worker/pipelines.ts";
import { indexDb } from "@carrier-explode/db/d1";
import { syncFeedDevices } from "../devices.ts";
import { heldIos } from "../held.ts";
import {
  appleDbDevices, appleDevices, appledbFirmware, appledbKeys, CATALOG_CONCURRENCY, deviceFirmwares, iphoneCatalog, newestIphone, type AppleDbEntry, type IpswRef,
} from "./catalog.ts";
import { betaCandidates, plan, planBetas, planRebuild, toBuild, type Held, type PlannedBuild } from "./plan.ts";

/** The phone whose IPSW names each image. */
const PREFERRED_DEVICE = "iPhone17,1";

const appledbAll = async (builds: readonly string[]): Promise<AppleDbEntry[]> =>
  allOrThrow("AppleDB records", await fanOut(builds, CATALOG_CONCURRENCY, appledbFirmware));

async function rebuild(held: readonly Held[]): Promise<PlannedBuild[]> {
  const cat = await iphoneCatalog();
  // ipsw.me lists no betas; AppleDB has their IPSWs.
  const betas = new Map((await appledbAll(held.map((h) => h.id).filter((b) => !cat.byBuild.has(b)))).map((e) => [e.build, e]));
  const ipswsOf = (b: string): readonly IpswRef[] =>
    cat.byBuild.get(b) ?? [...(betas.get(b)?.ipsws ?? [])].map(([device, url]) => ({ device, url }));
  const { builds, missing } = planRebuild(held, ipswsOf, PREFERRED_DEVICE);
  for (const b of missing) console.warn(`${b}: no iPhone IPSW listed any more, not rebuilt`);
  return builds;
}

async function newBuilds(held: readonly Held[], p: FeedOptions<"ios-images">): Promise<PlannedBuild[]> {
  const probe = await newestIphone();
  const preferred = (await deviceFirmwares(PREFERRED_DEVICE)).firmwares;
  const fallback = probe === PREFERRED_DEVICE ? [] : (await deviceFirmwares(probe)).firmwares;
  const chosen = plan(held, preferred, fallback, { only: p.version, since: p.since });

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
  if (p.version !== undefined || p.betas === false) return builds;
  // AppleDB being down must not cost the releases already planned.
  try {
    const candidates = betaCandidates(await appledbKeys(), held, [...preferred, ...fallback]);
    builds.push(...planBetas(await appledbAll(candidates), PREFERRED_DEVICE));
  } catch (e) {
    console.warn(`betas skipped: ${describe(e)}`);
  }
  return builds;
}

/** Oldest first, so history fills in order. */
export async function checkIpsw(env: Env, o: FeedOptions<"ios-images">): Promise<PlannedBuild[]> {
  // Apple's device names, boards and release days, so pages name, match and order phones from the feeds rather than tables in code.
  const [names, records] = await Promise.all([appleDevices(), appleDbDevices()]);
  await syncFeedDevices(env, { ...names, records });
  const held = await heldIos(indexDb(env.DB));
  return o.rebuild ? rebuild(held) : newBuilds(held, o);
}
