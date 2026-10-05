/** ios.ipsw: one IPSW's carrier and country bundles, staged for ios.release. Only the root filesystem member is downloaded. */

import { rm } from "node:fs/promises";
import { join } from "node:path";

import { keys } from "@carrier-explode/storage";
import { allOrThrow, fanOut } from "../../../../../src/fan-out.ts";
import type { JobContext, JobRunner } from "../../../job.ts";
import type { JobOutput } from "../../../../../src/jobs.ts";
import { BUNDLE_DIRS, bundleSource, packBundle, type BundleKind } from "../bundle-artifact.ts";
import { openIpsw } from "../remote-ipsw.ts";
import { listBundles, readBundle, type BundleDir } from "./bundles.ts";
import { extractBundleDirs } from "./extract.ts";
import { downloadOsImage } from "./image.ts";

type Staged = JobOutput<"ios.ipsw">["bundles"][number];

const KINDS = ["carrier", "country"] as const satisfies readonly BundleKind[];
const PUT_CONCURRENCY = 8;

async function stageAll(ctx: JobContext<"ios.ipsw">, kind: BundleKind, dirs: readonly BundleDir[]): Promise<Staged[]> {
  let done = 0;
  return allOrThrow(`${kind} bundles`, await fanOut(dirs, PUT_CONCURRENCY, async (dir) => {
    const { bytes, artifact } = await packBundle(await readBundle(dir));
    const source = bundleSource({ kind, name: dir.name });
    await ctx.r2.put(keys.staging(ctx.spec.id, source), bytes, "application/zip");
    await ctx.progress(++done, dirs.length, `${kind} bundles staged`);
    return { source, ...artifact };
  }));
}

export const runIpsw: JobRunner<"ios.ipsw"> = async (ctx): Promise<JobOutput<"ios.ipsw">> => {
  const { build, url, device } = ctx.spec.params;
  const { zip, manifest } = await openIpsw(url);
  if (manifest.build !== build) throw new Error(`${url} is build ${manifest.build}, not ${build}`);

  const image = await downloadOsImage(zip, url, manifest, ctx.tmp, ctx);
  const dirs = await extractBundleDirs(image, join(ctx.tmp, "bundles"));
  await rm(image);

  const bundles: Staged[] = [];
  for (const kind of KINDS) {
    const found = await listBundles(dirs[kind]);
    if (found.length === 0) throw new Error(`${BUNDLE_DIRS[kind]} is empty in ${url}`);
    bundles.push(...(await stageAll(ctx, kind, found)));
    ctx.log(`${kind}: ${found.length} bundles staged`);
  }
  return { build, device, devices: [...manifest.devices], bundles };
};
