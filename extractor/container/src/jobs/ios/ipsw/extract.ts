/** The bundle directories out of a filesystem image, by ./apfs-extract (no FUSE or mount needed). */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { BUNDLE_DIRS, type BundleKind } from "../store-bundle.ts";

/** APFS_EXTRACT points local runs at a built helper; the container image has it on PATH. */
const helper = (): string => process.env["APFS_EXTRACT"] ?? "apfs-extract";

function run(cmd: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // stdout is go-apfs progress bars; stderr carries the errors.
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(err).toString().trim().slice(-2000)}`));
    });
  });
}

export async function extractBundleDirs(image: string, dest: string): Promise<Record<BundleKind, string>> {
  const out = { carrier: join(dest, "carrier"), country: join(dest, "country") };
  await mkdir(out.carrier, { recursive: true });
  await mkdir(out.country, { recursive: true });
  await run(helper(), [image, BUNDLE_DIRS.carrier, out.carrier, BUNDLE_DIRS.country, out.country]);
  return out;
}
