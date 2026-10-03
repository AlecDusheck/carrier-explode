/**
 * Bundles as extracted to disk, read back into memory one at a time.
 *
 * Symlinks are skipped, both a symlinked `.bundle` and a symlinked file inside
 * one. That is what v1 stored: ipsw walked the mounted image to the link
 * targets and copied those, so a link never became a copy under its own name,
 * and scripts/package_system_bundles.py skipped file links. Listed in
 * `aliases` so a run says what it left out.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { comparePaths, isJunk, type Bundle, type BundleFile } from "../shared/ipcc.ts";

export interface BundleDir {
  readonly name: string;
  readonly path: string;
}

export interface BundleListing {
  readonly bundles: readonly BundleDir[];
  /** `.bundle` entries that are symlinks, left out. */
  readonly aliases: readonly string[];
}

const SUFFIX = ".bundle";

export async function listBundles(dir: string): Promise<BundleListing> {
  const bundles: BundleDir[] = [];
  const aliases: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!e.name.endsWith(SUFFIX)) continue;
    if (e.isSymbolicLink()) aliases.push(e.name);
    else if (e.isDirectory()) bundles.push({ name: e.name.slice(0, -SUFFIX.length), path: join(dir, e.name) });
  }
  bundles.sort((a, b) => comparePaths(a.name, b.name));
  return { bundles, aliases: aliases.sort(comparePaths) };
}

async function walk(root: string, rel: string, out: BundleFile[]): Promise<void> {
  for (const e of await readdir(join(root, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(root, path, out);
    else if (e.isFile() && !isJunk(path)) out.push({ path, bytes: new Uint8Array(await readFile(join(root, path))) });
  }
}

export async function readBundle(b: BundleDir): Promise<Bundle> {
  const files: BundleFile[] = [];
  await walk(b.path, "", files);
  return { name: b.name, files: files.sort((x, y) => comparePaths(x.path, y.path)) };
}
