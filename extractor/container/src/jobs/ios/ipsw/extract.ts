/**
 * The two bundle directories out of a filesystem image, by the apfs-extract
 * helper (./apfs-extract, a Go wrapper of go-apfs built into the container
 * image). No FUSE, no mount, no privileges: it reads the image as a file.
 */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { BundleKind } from "../store-bundle.ts";

/** Where the image keeps them. The same paths since iOS 8; the root volume, not a cryptex. */
export const BUNDLE_DIRS = {
  carrier: "/System/Library/Carrier Bundles/iPhone",
  country: "/System/Library/CountryBundles/iPhone",
} as const satisfies Record<BundleKind, string>;

/** The helper's path: APFS_EXTRACT in the environment (local runs), else the image's PATH. */
const helper = (): string => process.env.APFS_EXTRACT ?? "apfs-extract";

function run(cmd: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(err).toString().trim().slice(-2000)}`));
    });
  });
}

/** Copies both directories out of `image` into `<dest>/carrier` and `<dest>/country`. */
export async function extractBundleDirs(image: string, dest: string): Promise<Record<BundleKind, string>> {
  const out = { carrier: join(dest, "carrier"), country: join(dest, "country") };
  await mkdir(out.carrier, { recursive: true });
  await mkdir(out.country, { recursive: true });
  await run(helper(), [image, BUNDLE_DIRS.carrier, out.carrier, BUNDLE_DIRS.country, out.country]);
  return out;
}
