/** normalize: artifacts → Profiles, and modem-config archives → ModemConfigs. `{shas}` must place every sha; a shard skips what no release ships and what is neither. */

import { decodeCarrierList, decodeCarrierSettings, type CarrierList } from "@carrier-explode/decode-android";
import { openIpcc } from "@carrier-explode/decode-ios";
import { androidProfile, iosProfile, modemConfig, type NormalizedModem, type Profile } from "@carrier-explode/schema";
import { keys, objMetaSchema } from "@carrier-explode/storage";
import { fanOut } from "../../../src/fan-out.ts";
import type { JobContext, R2Client } from "../job.ts";
import type { JobOutput } from "../../../src/jobs.ts";
import { loadCatalog, usesBySha, type Use } from "./shared/catalog.ts";
import { READ_CONCURRENCY } from "./shared/limits.ts";
import { readRecord } from "./shared/records.ts";
import { stands } from "./shared/rewrite.ts";
import { inShard } from "./shared/shard.ts";
import { tally, type Outcome } from "./shared/tally.ts";

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

type Stored = { readonly kind: "profile"; readonly profile: Profile } | { readonly kind: "modem"; readonly modem: NormalizedModem };

export async function normalize(ctx: JobContext<"normalize">): Promise<JobOutput<"normalize">> {
  const p = ctx.spec.params;
  const strict = "shas" in p;
  const shas = strict
    ? p.shas
    : (await ctx.r2.list(keys.objPrefix())).flatMap((k) => keys.shaOfObj(k) ?? []).filter((sha) => inShard(sha, p));
  const uses = usesBySha(await loadCatalog(ctx.r2));
  const listOf = carrierLists(ctx.r2);
  const products = new Map(Object.entries(p.boards));

  /** null when the artifact is not what its use maps (a carrier list, a modem package). */
  async function normOf(sha: string, use: Use): Promise<Stored | null> {
    const meta = await readRecord(ctx.r2, keys.meta(sha), objMetaSchema);
    if (!meta) throw new Error(`${keys.meta(sha)}: missing`);
    switch (use.kind) {
      case "apple":
        return meta.kind === "apple.ipcc" ? { kind: "profile", profile: iosProfile(openIpcc(await bytesOf(ctx.r2, sha)), use.source, sha, products) } : null;
      case "android":
        return meta.kind === "android.carrier-settings"
          ? { kind: "profile", profile: androidProfile(decodeCarrierSettings(await bytesOf(ctx.r2, sha)), use.source, sha, await listOf(use.carrierList)) }
          : null;
      case "modem":
        return meta.kind === "android.modem-config" ? { kind: "modem", modem: await modemConfig(await bytesOf(ctx.r2, sha), sha) } : null;
    }
  }

  /** A key many configs share (a base, a combination list) is content-addressed, so one already there is already right. */
  async function putShared(key: string, value: unknown): Promise<void> {
    if (!stands(await ctx.r2.head(key), p.rewriteBefore)) await ctx.r2.putJson(key, value);
  }

  async function writeModem({ config, base, combos }: NormalizedModem): Promise<void> {
    for (const [key, list] of combos) await putShared(keys.combos(key), list);
    if (base) await putShared(keys.norm(base.sha), base);
    await ctx.r2.putJson(keys.norm(config.sha), config);
  }

  async function one(sha: string): Promise<Outcome> {
    if (stands(await ctx.r2.head(keys.norm(sha)), p.rewriteBefore)) return "skipped";
    const use = uses.get(sha);
    const norm = use ? await normOf(sha, use) : null;
    if (norm?.kind === "profile") {
      await ctx.r2.putJson(keys.norm(sha), norm.profile);
      return "written";
    }
    if (norm?.kind === "modem") {
      await writeModem(norm.modem);
      return "written";
    }
    if (strict) throw new Error(use ? "not a settings or modem-config artifact" : "no release or OTA ref ships it");
    return "skipped";
  }

  let seen = 0;
  const results = await fanOut(shas, READ_CONCURRENCY, async (sha) => {
    const outcome = await one(sha);
    await ctx.progress(++seen, shas.length);
    return outcome;
  });
  const out = tally(results, (sha) => sha);
  ctx.log(`${shas.length} artifacts, ${out.failed} failed`);
  return out;
}
