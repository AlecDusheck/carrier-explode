/**
 * normalize: artifacts → norm/v<PROFILE_SCHEMA>/<sha>.json through the platform
 * mappers. `{ shas }` must place every sha; `{ all }` walks a shard of obj/ and
 * skips what no release or ref ships (per-IPSW copies) and what is not settings.
 */

import { decodeCarrierList, decodeCarrierSettings, type CarrierList } from "../../../../src/lib/decode/android/index.ts";
import { openIpcc } from "../../../../src/lib/decode/index.ts";
import { androidProfile, iosProfile, type Profile } from "../../../../src/lib/schema/index.ts";
import { keys } from "../../../../src/lib/storage/keys.ts";
import { fanOut } from "../../../src/fan-out.ts";
import type { JobContext, JobOutput, R2Client } from "../job.ts";
import { loadCatalog, READ_CONCURRENCY, usesBySha, type Use } from "./shared/catalog.ts";
import { objMetaSchema, readRecord } from "./shared/records.ts";

/** Failures listed in the output; failedCount has them all. */
const LISTED_FAILURES = 50;

/** A deterministic slice of sha space. */
const shardOf = (sha: string, of: number): number => Number.parseInt(sha.slice(0, 8), 16) % of;

async function bytesOf(r2: R2Client, sha: string): Promise<Uint8Array> {
  const bytes = await r2.get(keys.obj(sha));
  if (!bytes) throw new Error(`${keys.obj(sha)}: missing`);
  return bytes;
}

/** Decoded once per job: every CarrierSettings of a build shares one list. */
function carrierLists(r2: R2Client): (sha: string) => Promise<CarrierList> {
  const cache = new Map<string, Promise<CarrierList>>();
  return (sha) => {
    const loading = cache.get(sha) ?? bytesOf(r2, sha).then(decodeCarrierList);
    cache.set(sha, loading);
    return loading;
  };
}

type Outcome = "written" | "skipped";

export async function normalize(ctx: JobContext<"normalize">): Promise<JobOutput<"normalize">> {
  const p = ctx.spec.params;
  const force = p.force ?? false;
  const strict = "shas" in p;
  const shas = strict
    ? p.shas
    : (await ctx.r2.list("obj/")).map((k) => k.slice("obj/".length)).filter((sha) => shardOf(sha, p.of) === p.shard);
  const uses = usesBySha(await loadCatalog(ctx.r2));
  const listOf = carrierLists(ctx.r2);

  /** null when the artifact is not its platform's settings file (a carrier list, a modem package). */
  async function profileOf(sha: string, use: Use): Promise<Profile | null> {
    const meta = await readRecord(ctx.r2, keys.meta(sha), objMetaSchema);
    if (!meta) throw new Error(`${keys.meta(sha)}: missing`);
    switch (use.family) {
      case "apple":
        return meta.kind === "apple.ipcc" ? iosProfile(openIpcc(await bytesOf(ctx.r2, sha)), use.source, sha) : null;
      case "android":
        return meta.kind === "android.carrier-settings"
          ? androidProfile(decodeCarrierSettings(await bytesOf(ctx.r2, sha)), use.source, sha, await listOf(use.carrierList))
          : null;
    }
  }

  async function one(sha: string): Promise<Outcome> {
    if (!force && (await ctx.r2.head(keys.norm(sha)))) return "skipped";
    const use = uses.get(sha);
    const profile = use ? await profileOf(sha, use) : null;
    if (profile) {
      await ctx.r2.putJson(keys.norm(sha), profile);
      return "written";
    }
    if (strict) throw new Error(use ? "not a settings artifact" : "no release or OTA ref ships it");
    return "skipped";
  }

  let seen = 0;
  const results = await fanOut(shas, READ_CONCURRENCY, async (sha) => {
    const outcome = await one(sha);
    await ctx.progress(++seen, shas.length);
    return outcome;
  });
  const failed = results.flatMap((r) => (r.ok ? [] : [{ sha: r.item, error: r.error }]));
  ctx.log(`${shas.length} artifacts, ${failed.length} failed`);
  return {
    written: results.filter((r) => r.ok && r.value === "written").length,
    skipped: results.filter((r) => r.ok && r.value === "skipped").length,
    failedCount: failed.length,
    failed: failed.slice(0, LISTED_FAILURES),
  };
}
