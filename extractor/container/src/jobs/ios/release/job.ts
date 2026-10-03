/**
 * ios.release: a build's ios.ipsw outputs merged into one copy per bundle
 * (./merge.ts), packaged and stored, then releases/ios/<build>.json written
 * last, so the site never lists a half-stored image. Every IPSW or none: a
 * partial merge would quietly drop phones, so a missing or failed part fails
 * the job. Modem packages come from the build's ios.modems job, already run;
 * when that failed the Workflow passes null and the release ships without
 * them (v1's "best effort" step), which is logged.
 *
 * v1 also wrote system/<build>/countries.json (every country carrier.plist,
 * decoded). v2 drops it: each country bundle's Profile (norm/) carries its
 * ISO codes and settings, and the index job builds the country tables from
 * those, so nothing needs a per-build side file.
 */

import { keys } from "../../../../../../src/lib/storage/keys.ts";
import type { Release, ReleaseSource } from "../../../../../../src/lib/schema/types.ts";
import { compareProducts } from "../../../../../../src/lib/decode/index.ts";
import { readJobOutput } from "../../../job-records.ts";
import type { JobContext, JobOutput, JobRunner } from "../../../job.ts";
import { mapLimit } from "../catalog.ts";
import { unpackIpcc, type Bundle } from "../shared/ipcc.ts";
import { storeBundle, type BundleKind } from "../store-bundle.ts";
import { mergeCopies } from "./merge.ts";

type IpswOutput = JobOutput<"ios.ipsw">;
type Part = IpswOutput["bundles"][number];

/** R2 reads at once: small objects, and R2 prefers them in moderation. */
const CONCURRENCY = 8;

/** sourceKey -> its copies, in part order (the planner's: preferred device first). */
function bySource(parts: readonly IpswOutput[]): Map<string, Part[]> {
  const out = new Map<string, Part[]>();
  for (const p of parts) {
    for (const b of p.bundles) {
      const copies = out.get(b.source) ?? [];
      copies.push(b);
      out.set(b.source, copies);
    }
  }
  return out;
}

const kindOf = (source: string): BundleKind => {
  const kind = source.split(":")[1];
  if (kind === "carrier" || kind === "country") return kind;
  throw new Error(`${source} is not an iOS carrier or country bundle`);
};

async function loadCopy(ctx: JobContext<"ios.release">, sha: string): Promise<Bundle> {
  const bytes = await ctx.r2.get(keys.obj(sha));
  if (!bytes) throw new Error(`${keys.obj(sha)} is missing; its ios.ipsw output points at it`);
  return unpackIpcc(bytes);
}

/** One source's merged copy. Identical copies (one sha) are already the merge, and stay as stored. */
async function mergeSource(ctx: JobContext<"ios.release">, source: string, copies: readonly Part[], device: string): Promise<ReleaseSource> {
  const [first] = copies;
  if (!first) throw new Error(`${source}: no copies`);
  if (copies.every((c) => c.sha === first.sha)) {
    return { sha: first.sha, version: first.version, size: first.size, ...(first.cid ? { cid: first.cid } : {}) };
  }
  const bundles = await Promise.all(copies.map((c) => loadCopy(ctx, c.sha)));
  const { bundle, conflicts } = mergeCopies(bundles);
  for (const c of conflicts) ctx.log(`differs between images, kept the first: ${c}`);
  const stored = await storeBundle(ctx.r2, kindOf(source), bundle, { release: ctx.spec.params.build, device, path: "merged" }, ctx.log);
  return { sha: stored.sha, version: stored.version, size: stored.size, cid: stored.cid };
}

export const runRelease: JobRunner<"ios.release"> = async (ctx): Promise<JobOutput<"ios.release">> => {
  const p = ctx.spec.params;
  if (p.parts.length === 0) throw new Error(`${p.build}: no ios.ipsw parts`);
  const parts = await Promise.all(p.parts.map((id) => readJobOutput(ctx.r2, id, "ios.ipsw")));
  const stray = parts.filter((o) => o.build !== p.build);
  if (stray.length) throw new Error(`parts of other builds: ${stray.map((o) => `${o.device} ${o.build}`).join(", ")}`);
  const lead = parts[0]?.device ?? "";

  const sources = bySource(parts);
  let done = 0;
  const merged = await mapLimit([...sources], CONCURRENCY, async ([source, copies]) => {
    const r = await mergeSource(ctx, source, copies, lead);
    if (++done % 200 === 0) await ctx.progress(done, sources.size, "bundles merged");
    return [source, r] as const;
  });

  let modems: unknown[] | undefined;
  if (p.modems === null) ctx.log(`${p.build}: ios.modems failed, the release ships without modem packages`);
  else modems = (await readJobOutput(ctx.r2, p.modems, "ios.modems")).modems;

  const release: Release = {
    platform: "ios",
    id: p.build,
    version: p.label,
    ...(p.released ? { released: p.released } : {}),
    ...(p.prerelease ? { prerelease: true } : {}),
    devices: [...new Set(parts.flatMap((o) => o.devices))].sort(compareProducts),
    extractedAt: new Date().toISOString(),
    sources: Object.fromEntries([...merged].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    ...(modems ? { modems } : {}),
  };
  await ctx.r2.putJson(keys.release("ios", p.build), release);
  ctx.log(`${p.label} (${p.build}): ${sources.size} bundles from ${parts.length} IPSWs, ${modems?.length ?? 0} modem packages`);
  return { build: p.build, shas: [...new Set(merged.map(([, r]) => r.sha))].sort() };
};
