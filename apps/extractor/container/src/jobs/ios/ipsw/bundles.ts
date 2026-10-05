/** Extracted bundles, read back one at a time. Symlinks there (`202 -> Greece.bundle`) are lookup aliases, not bundles. */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { comparePaths, isJunk, type UnpackedBundle, type UnpackedFile } from "@carrier-explode/decode-ios";

export interface BundleDir {
  readonly name: string;
  readonly path: string;
}

const SUFFIX = ".bundle";

export async function listBundles(dir: string): Promise<BundleDir[]> {
  const out: BundleDir[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.endsWith(SUFFIX)) out.push({ name: e.name.slice(0, -SUFFIX.length), path: join(dir, e.name) });
  }
  return out.sort((a, b) => comparePaths(a.name, b.name));
}

async function walk(root: string, rel: string, out: UnpackedFile[]): Promise<void> {
  for (const e of await readdir(join(root, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(root, path, out);
    else if (e.isFile() && !isJunk(path)) out.push({ path, bytes: new Uint8Array(await readFile(join(root, path))) });
  }
}

export async function readBundle(b: BundleDir): Promise<UnpackedBundle> {
  const files: UnpackedFile[] = [];
  await walk(b.path, "", files);
  return { name: b.name, files: files.sort((x, y) => comparePaths(x.path, y.path)) };
}
