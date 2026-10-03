/**
 * normalize: artifacts → Profiles at norm/v<PROFILE_SCHEMA>/<sha>.json,
 * through the platform mappers. Which source an artifact is comes from the
 * releases and OTA refs that ship it (the bytes alone do not say).
 *
 * `{ shas }` maps exactly those and reports any it cannot place. `{ all, shard,
 * of }` walks obj/ (a deterministic slice by sha prefix) and skips what is not
 * a settings artifact, or not shipped by any source (ios.ipsw's per-IPSW
 * copies, before ios.release merges them).
 */

import { decodeCarrierList, decodeCarrierSettings, type CarrierList } from "../../../../src/lib/decode/android/index.ts";
import { openIpcc } from "../../../../src/lib/decode/index.ts";
import { androidProfile, decoderFamily, iosProfile, type Profile } from "../../../../src/lib/schema/index.ts";
import { keys } from "../../../../src/lib/storage/keys.ts";
import { fanOut } from "../../../src/fan-out.ts";
import type { JobContext, JobOutput, R2Client } from "../job.ts";
import { loadCatalog, READ_CONCURRENCY, usesBySha, type Use } from "./shared/catalog.ts";
import { objMetaSchema, readRecord } from "./shared/records.ts";

/** Failures listed in the output; failedCount has them all. */
const LISTED_FAILURES = 50;

/** A deterministic shard of sha space: the first 8 hex digits, mod `of`. */
const shardOf = (sha: string, of: number): number => Number.parseInt(sha.slice(0, 8), 16) % of;

type Outcome = "written" | "skipped";

async function bytesOf(r2: R2Client, sha: string): Promise<Uint8Array> {
  const bytes = await r2.get(keys.obj(sha));
  if (!bytes) throw new Error(`${keys.obj(sha)}: missing`);
  return bytes;
}

/** carrier_list.pb files, decoded once per job: every CarrierSettings of a release shares one. */
function carrierLists(r2: R2Client): (sha: string) => Promise<CarrierList> {
  const cache = new Map<string, Promise<CarrierList>>();
  return (sha) => {
    const hit = cache.get(sha);
    if (hit) return hit;
    const loading = bytesOf(r2, sha).then(decodeCarrierList);
    cache.set(sha, loading);
    return loading;
  };
}

export async function normalize(ctx: JobContext<"normalize">): Promise<JobOutput<"normalize">> {
  const p = ctx.spec.params;
  const force = p.force ?? false;
  const strict = "shas" in p;
  const shas = strict
    ? p.shas
    : (await ctx.r2.list("obj/")).map((k) => k.slice("obj/".length)).filter((sha) => shardOf(sha, p.of) === p.shard);
  const uses = usesBySha(await loadCatalog(ctx.r2));
  const listOf = carrierLists(ctx.r2);

  /** The mapper is the source's platform's; an artifact of another kind under it is not a settings file. */
  async function profileOf(sha: string, use: Use): Promise<Profile | null> {
    const meta = await readRecord(ctx.r2, keys.meta(sha), objMetaSchema);
    if (!meta) throw new Error(`${keys.meta(sha)}: missing`);
    switch (decoderFamily(use.source.platform)) {
      case "apple":
        if (meta.kind !== "ios.ipcc") return null;
        return iosProfile(openIpcc(await bytesOf(ctx.r2, sha)), use.source, sha);
      case "android": {
        if (meta.kind !== "android.carrier_settings") return null;
        const list = use.carrierList ? await listOf(use.carrierList) : undefined;
        return androidProfile(decodeCarrierSettings(await bytesOf(ctx.r2, sha)), use.source, sha, list);
      }
    }
  }

  async function one(sha: string): Promise<Outcome> {
    if (!force && (await ctx.r2.head(keys.norm(sha)))) return "skipped";
    const use = uses.get(sha);
    if (!use) {
      if (strict) throw new Error("no release or OTA ref ships it");
      return "skipped";
    }
    const profile = await profileOf(sha, use);
    if (!profile) {
      if (strict) throw new Error("not a settings artifact");
      return "skipped";
    }
    await ctx.r2.putJson(keys.norm(sha), profile);
    return "written";
  }

  let seen = 0;
  const results = await fanOut(shas, READ_CONCURRENCY, async (sha) => {
    const outcome = await one(sha);
    await ctx.progress(++seen, shas.length);
    return outcome;
  });

  const failed = shas.flatMap((sha, i) => {
    const r = results[i];
    return r && !r.ok ? [{ sha, error: r.error }] : [];
  });
  ctx.log(`${shas.length} artifacts, ${failed.length} failed`);
  return {
    written: results.filter((r) => r.ok && r.value === "written").length,
    skipped: results.filter((r) => r.ok && r.value === "skipped").length,
    failedCount: failed.length,
    failed: failed.slice(0, LISTED_FAILURES),
  };
}
