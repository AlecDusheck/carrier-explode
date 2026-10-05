/** A build's bundle is the union of its IPSWs' copies: each copy carries only its own phones' override files. */

import { sha256Hex } from "@carrier-explode/binary";
import { comparePaths, type UnpackedBundle, type UnpackedFile } from "@carrier-explode/decode-ios";

/** `overrides_D93_D94.plist`, `.der.pri`, and their `signatures/` entries. */
const isOverride = (path: string): boolean => /(^|\/)overrides_[^/]+$/.test(path);

interface Seen {
  readonly file: UnpackedFile;
  readonly sha: string;
}

/** Fails on any difference but an override file some copies lack. */
export async function mergeCopies(copies: readonly UnpackedBundle[]): Promise<UnpackedBundle> {
  const [first] = copies;
  if (!first) throw new Error("no copies to merge");
  const where = (path: string): string => `${first.name}.bundle/${path}`;
  const seen = new Map<string, Seen>();
  for (const c of copies) {
    if (c.name !== first.name) throw new Error(`merging ${c.name}.bundle into ${first.name}.bundle`);
    for (const file of c.files) {
      const sha = await sha256Hex(file.bytes);
      const have = seen.get(file.path);
      if (!have) seen.set(file.path, { file, sha });
      else if (have.sha !== sha) throw new Error(`${where(file.path)} differs between IPSWs: sha256 ${have.sha} vs ${sha}`);
    }
  }
  for (const [path, { sha }] of seen) {
    if (isOverride(path)) continue;
    const without = copies.findIndex((c) => !c.files.some((f) => f.path === path));
    if (without >= 0) throw new Error(`${where(path)} (sha256 ${sha}) is missing from IPSW ${without + 1} of ${copies.length}`);
  }
  return { name: first.name, files: [...seen.values()].map((s) => s.file).sort((a, b) => comparePaths(a.path, b.path)) };
}
