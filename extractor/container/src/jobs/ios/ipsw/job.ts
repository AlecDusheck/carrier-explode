/**
 * ios.ipsw: one IPSW in; its carrier and country bundles out, each packaged
 * deterministically and stored under obj/ (kind ios.ipcc). ios.release then
 * merges the build's IPSWs.
 *
 * The v1 job downloaded the whole IPSW (~12 GB) and ran `ipsw extract --files`,
 * which mounts the filesystem image with apfs-fuse. A container has neither
 * the disk for that nor FUSE, so instead:
 *
 *   1. BuildManifest.plist, over Range requests, names the root filesystem image.
 *   2. That member alone streams from Apple, through AEA decryption (iOS 18+),
 *      into one local file (./image.ts has the disk budget).
 *   3. apfs-extract copies the two bundle directories out of it (./extract.ts).
 *   4. The image is deleted; each bundle is packaged and stored.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";

import { openRemoteZip } from "../../../../../../src/lib/firmware/index.ts";
import type { JobOutput, JobRunner } from "../../../job.ts";
import { withHeartbeat } from "../heartbeat.ts";
import { parseBuildManifest } from "../shared/build-manifest.ts";
import { storeBundle, type BundleKind, type StoredBundle } from "../store-bundle.ts";
import { listBundles, readBundle } from "./bundles.ts";
import { BUNDLE_DIRS, extractBundleDirs } from "./extract.ts";
import { downloadOsImage } from "./image.ts";

const KINDS = ["carrier", "country"] as const satisfies readonly BundleKind[];

export const runIpsw: JobRunner<"ios.ipsw"> = async (ctx): Promise<JobOutput<"ios.ipsw">> => {
  const { build, url, device } = ctx.spec.params;
  const zip = await openRemoteZip(url);
  const entry = zip.entry("BuildManifest.plist");
  if (!entry) throw new Error(`${url} has no BuildManifest.plist`);
  const manifest = parseBuildManifest(await zip.read(entry));
  if (manifest.build !== build) throw new Error(`${url} is build ${manifest.build}, not ${build}`);
  ctx.log(`${device}: iOS ${manifest.version} (${manifest.build}) for ${manifest.devices.join(", ")}`);

  const image = await downloadOsImage(zip, url, manifest, ctx.tmp, ctx);
  ctx.log(`${image.member}: ${(image.size / 1e9).toFixed(2)} GB image on disk`);
  const dirs = await withHeartbeat(ctx, "extracting bundle directories", () => extractBundleDirs(image.path, join(ctx.tmp, "bundles")));
  await rm(image.path);

  const bundles: StoredBundle[] = [];
  for (const kind of KINDS) {
    const dirsOfKind = await listBundles(dirs[kind]);
    // Every iPhone image carries both directories, full; an empty one means the wrong image was read.
    if (dirsOfKind.length === 0) throw new Error(`${BUNDLE_DIRS[kind]} is empty in ${image.member}`);
    let n = 0;
    for (const b of dirsOfKind) {
      const bundle = await readBundle(b);
      const origin = { url, release: build, device, path: `${BUNDLE_DIRS[kind]}/${b.name}.bundle` };
      bundles.push(await storeBundle(ctx.r2, kind, bundle, origin));
      if (++n % 100 === 0) await ctx.progress(n, dirsOfKind.length, `${kind} bundles stored`);
    }
    ctx.log(`${kind}: ${dirsOfKind.length} bundles stored`);
  }
  return { build, device, devices: [...manifest.devices], bundles };
};
