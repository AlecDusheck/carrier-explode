/** ios.release: a build's staged bundles merged per source into obj/, with its modems, as releases/ios/<build>.json; then its staging is deleted. */

import { compareProducts, unpackIpcc } from "@carrier-explode/decode-ios";
import type { AppleArtifact, AppleRelease, SourceKey } from "@carrier-explode/schema/types";
import { keys } from "@carrier-explode/storage";
import { allOrThrow, fanOut } from "../../../../../src/fan-out.ts";
import { readJobOutput } from "../../../job-records.ts";
import type { JobContext, JobRunner } from "../../../job.ts";
import type { JobOutput } from "../../../../../src/jobs.ts";
import { READ_CONCURRENCY } from "../../shared/limits.ts";
import { readRecord } from "../../shared/records.ts";
import { bundleRef, bundleSource, imageOrigin, packBundle, type BundleRef, type PackedBundle } from "../bundle-artifact.ts";
import { mergeCopies } from "./merge.ts";
import { releaseSchema } from "@carrier-explode/schema/records";

type Part = JobOutput<"ios.ipsw">;

/** One IPSW's copy of a bundle, as ios.ipsw staged it. */
interface Copy {
  readonly key: string;
  readonly device: string;
  readonly artifact: AppleArtifact;
}

interface Source {
  readonly ref: BundleRef;
  readonly copies: readonly [Copy, ...Copy[]];
}

function sourcesOf(parts: ReadonlyArray<{ readonly id: string; readonly output: Part }>): Map<SourceKey<"ios">, Source> {
  const out = new Map<SourceKey<"ios">, Source>();
  for (const { id, output } of parts) {
    for (const { source, ...artifact } of output.bundles) {
      const ref = bundleRef(source);
      const key = bundleSource(ref);
      const copy = { key: keys.staging(id, source), device: output.device, artifact };
      const had = out.get(key);
      out.set(key, { ref, copies: had ? [...had.copies, copy] : [copy] });
    }
  }
  return out;
}

async function staged(ctx: JobContext<"ios.release">, c: Copy): Promise<Uint8Array> {
  const bytes = await ctx.r2.get(c.key);
  if (!bytes) throw new Error(`${c.key} is missing`);
  return bytes;
}

/** Deterministic packaging makes copies with one sha already merged. */
async function merged(ctx: JobContext<"ios.release">, { copies: [first, ...rest] }: Source): Promise<PackedBundle> {
  if (rest.every((c) => c.artifact.sha === first.artifact.sha)) return { bytes: await staged(ctx, first), artifact: first.artifact };
  const bundles = await Promise.all([first, ...rest].map(async (c) => unpackIpcc(await staged(ctx, c))));
  return packBundle(await mergeCopies(bundles));
}

async function store(ctx: JobContext<"ios.release">, source: Source): Promise<AppleArtifact> {
  const { bytes, artifact } = await merged(ctx, source);
  const origin = imageOrigin(source.ref, ctx.spec.params.build, source.copies[0].device);
  const sha = await ctx.r2.putObj(bytes, { kind: "apple.ipcc", cid: artifact.cid, origin });
  if (sha !== artifact.sha) throw new Error(`${bundleSource(source.ref)} stored as ${sha}, expected ${artifact.sha}`);
  return artifact;
}

async function writeRelease(ctx: JobContext<"ios.release">, parts: readonly Part[], sources: ReadonlyMap<SourceKey<"ios">, Source>): Promise<AppleRelease> {
  const p = ctx.spec.params;
  const { modems } = await readJobOutput(ctx.r2, p.modems, "ios.modems");
  const stored = allOrThrow("bundles", await fanOut([...sources], READ_CONCURRENCY, async ([key, s]) => [key, await store(ctx, s)] as const));
  const release: AppleRelease = {
    platform: "ios",
    id: p.build,
    version: p.version,
    label: p.label,
    prerelease: p.prerelease,
    ...(p.released ? { released: p.released } : {}),
    devices: [...new Set(parts.flatMap((o) => o.devices))].sort(compareProducts),
    extractedAt: new Date().toISOString(),
    sources: Object.fromEntries(stored),
    modems,
  };
  await ctx.r2.putJson(keys.release("ios", p.build), release);
  ctx.log(`${p.label} (${p.build}): ${stored.length} bundles from ${parts.length} IPSWs, ${modems.length} modem packages`);
  return release;
}

/** Staging is deleted only after the release is written, so staging already gone means an earlier attempt wrote it. */
async function earlierRelease(ctx: JobContext<"ios.release">, gone: string): Promise<AppleRelease> {
  const key = keys.release("ios", ctx.spec.params.build);
  const release = await readRecord(ctx.r2, key, releaseSchema);
  if (release?.platform !== "ios") throw new Error(`${gone} is gone, and ${key} was never written`);
  ctx.log(`${gone} is gone: an earlier attempt wrote ${key}; finishing its cleanup`);
  return release;
}

export const runRelease: JobRunner<"ios.release"> = async (ctx): Promise<JobOutput<"ios.release">> => {
  const p = ctx.spec.params;
  // Every IPSW or none: a missing or failed part throws here, before anything is merged.
  const parts = await Promise.all(p.parts.map(async (id) => ({ id, output: await readJobOutput(ctx.r2, id, "ios.ipsw") })));
  if (parts.length === 0) throw new Error(`${p.build}: no ios.ipsw parts`);
  const stray = parts.filter((x) => x.output.build !== p.build);
  if (stray.length) throw new Error(`parts of other builds: ${stray.map((x) => `${x.id} (${x.output.build})`).join(", ")}`);

  const sources = sourcesOf(parts);
  const copies = [...sources.values()].flatMap((s) => s.copies);
  const present = new Set((await Promise.all(p.parts.map((id) => ctx.r2.list(keys.stagingPrefix(id))))).flat());
  const gone = copies.find((c) => !present.has(c.key));
  const release = gone ? await earlierRelease(ctx, gone.key) : await writeRelease(ctx, parts.map((x) => x.output), sources);

  allOrThrow("staging deletes", await fanOut(copies, READ_CONCURRENCY, (c) => ctx.r2.delete(c.key)));
  return { build: p.build, shas: [...new Set(Object.values(release.sources).map((a) => a.sha))].sort() };
};
