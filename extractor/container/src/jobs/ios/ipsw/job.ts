/**
 * ios.ipsw: one IPSW's carrier and country bundles into obj/. Only the root
 * filesystem member is downloaded, decrypted on its way to disk, and read with apfs-extract.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";

import { openRemoteZip } from "../../../../../../src/lib/firmware/index.ts";
import type { JobOutput, JobRunner } from "../../../job.ts";
import { withHeartbeat } from "../heartbeat.ts";
import { parseBuildManifest } from "../shared/build-manifest.ts";
import { BUNDLE_DIRS, storeBundle, type BundleKind, type StoredBundle } from "../store-bundle.ts";
import { listBundles, readBundle } from "./bundles.ts";
import { extractBundleDirs } from "./extract.ts";
import { downloadOsImage } from "./image.ts";

const KINDS = ["carrier", "country"] as const satisfies readonly BundleKind[];

export const runIpsw: JobRunner<"ios.ipsw"> = async (ctx): Promise<JobOutput<"ios.ipsw">> => {
  const { build, url, device } = ctx.spec.params;
  const zip = await openRemoteZip(url);
  const entry = zip.entry("BuildManifest.plist");
  if (!entry) throw new Error(`${url} has no BuildManifest.plist`);
  const manifest = parseBuildManifest(await zip.read(entry));
  if (manifest.build !== build) throw new Error(`${url} is build ${manifest.build}, not ${build}`);

  const image = await downloadOsImage(zip, url, manifest, ctx.tmp, ctx);
  const dirs = await withHeartbeat(ctx, "extracting bundle directories", () => extractBundleDirs(image, join(ctx.tmp, "bundles")));
  await rm(image);

  const bundles: StoredBundle[] = [];
  for (const kind of KINDS) {
    const found = await listBundles(dirs[kind]);
    if (found.length === 0) throw new Error(`${BUNDLE_DIRS[kind]} is empty in ${url}`);
    for (const [i, b] of found.entries()) {
      bundles.push(await storeBundle(ctx.r2, kind, await readBundle(b), { release: build, device }));
      if ((i + 1) % 100 === 0) await ctx.progress(i + 1, found.length, `${kind} bundles stored`);
    }
    ctx.log(`${kind}: ${found.length} bundles stored`);
  }
  return { build, device, devices: [...manifest.devices], bundles };
};
