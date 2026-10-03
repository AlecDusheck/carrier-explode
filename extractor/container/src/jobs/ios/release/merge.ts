/**
 * One bundle out of its copies in a build's IPSWs: a port of merge_images in
 * scripts/package_system_bundles.py. A bundle inside an image carries only the
 * override files of the phones that image was cut for, so the build's bundle is
 * the union of its copies, the way an OTA copy carries every phone of its day.
 * Only override files should differ between images; any other file that does
 * is reported, and the first image's copy kept (the planner puts the preferred
 * device's IPSW first). Pure.
 */

import type { Bundle, BundleFile } from "../shared/ipcc.ts";
import { comparePaths } from "../shared/ipcc.ts";

export interface Merged {
  readonly bundle: Bundle;
  /** Paths whose bytes differ between copies, as `<Name>.bundle/<path>`. */
  readonly conflicts: readonly string[];
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** `copies` in image order; all of one bundle name. */
export function mergeCopies(copies: readonly Bundle[]): Merged {
  const [first] = copies;
  if (!first) throw new Error("no copies to merge");
  const files = new Map<string, BundleFile>();
  const conflicts: string[] = [];
  for (const c of copies) {
    if (c.name !== first.name) throw new Error(`merging ${c.name}.bundle into ${first.name}.bundle`);
    for (const f of c.files) {
      const have = files.get(f.path);
      if (!have) files.set(f.path, f);
      else if (!same(have.bytes, f.bytes)) conflicts.push(`${first.name}.bundle/${f.path}`);
    }
  }
  return {
    bundle: { name: first.name, files: [...files.values()].sort((a, b) => comparePaths(a.path, b.path)) },
    conflicts,
  };
}
