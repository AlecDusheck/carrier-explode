/** ios.modem-summaries: every modem package an iOS release lists, decoded again from obj/ into the current MODEM_SUMMARY_SCHEMA. */

import type { ModemPackage } from "@carrier-explode/schema/types";
import { keys } from "@carrier-explode/storage";
import { fanOut } from "../../../src/fan-out.ts";
import type { JobContext } from "../job.ts";
import type { JobOutput } from "../../../src/jobs.ts";
import { carrierTable, modemSummary, summaryKey } from "./ios/modems/summary.ts";
import { loadCatalog } from "./shared/catalog.ts";
import { stands } from "./shared/rewrite.ts";
import { inShard } from "./shared/shard.ts";
import { tally, type Outcome } from "./shared/tally.ts";

/** A package is read whole and unzipped in memory: two at a time fit standard-1's 4 GiB. */
const DECODES = 2;

export async function modemSummaries(ctx: JobContext<"ios.modem-summaries">): Promise<JobOutput<"ios.modem-summaries">> {
  const { rewriteBefore, ...shard } = ctx.spec.params;
  const packages = new Map<string, ModemPackage>();
  for (const r of (await loadCatalog(ctx.r2)).releases) {
    if (r.platform === "ios") for (const m of r.modems) if (inShard(m.package.sha, shard)) packages.set(m.package.sha, m.package);
  }

  const mccMnc = carrierTable(ctx.r2);

  let seen = 0;
  const results = await fanOut([...packages.values()], DECODES, async (p): Promise<Outcome> => {
    const outcome = stands(await ctx.r2.head(summaryKey(p.sha)), rewriteBefore) ? "skipped" : await redecode(ctx, p, mccMnc);
    await ctx.progress(++seen, packages.size, p.name);
    return outcome;
  });
  const out = tally(results, (p) => p.sha);
  ctx.log(`${packages.size} packages, ${out.failed} failed`);
  return out;
}

async function redecode(ctx: JobContext<"ios.modem-summaries">, p: ModemPackage, mccMnc: ReturnType<typeof carrierTable>): Promise<"written"> {
  const bytes = await ctx.r2.get(keys.obj(p.sha));
  if (!bytes) throw new Error(`${keys.obj(p.sha)}: missing`);
  await ctx.r2.putJson(summaryKey(p.sha), await modemSummary(bytes, p.name, mccMnc));
  return "written";
}
