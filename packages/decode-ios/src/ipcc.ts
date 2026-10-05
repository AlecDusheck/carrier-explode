/** Image bundles packaged as OTA-shaped .ipcc zips, deterministically: the same files always give the same bytes. */

import { unzipSync, zipSync, type ZipOptions } from "fflate";

import { isPlistDict, parsePlist } from "./plist.ts";

/** One file, by its path inside the .bundle directory. */
export interface UnpackedFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface UnpackedBundle {
  /** Without `.bundle`: `TMobile_us`, `UnitedStates`. */
  readonly name: string;
  readonly files: readonly UnpackedFile[];
}

const utf8 = new TextEncoder();

/** Byte order of the UTF-8 path, as content ids and the v1 packager sort. */
export function comparePaths(a: string, b: string): number {
  const x = utf8.encode(a);
  const y = utf8.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** Files Finder leaves behind, which neither the packager nor content ids count. */
export const isJunk = (path: string): boolean => path === ".DS_Store" || path.endsWith("/.DS_Store");

/** fflate writes the Date's local fields, so one built from local fields is 1980-01-01 00:00 in every time zone. */
const EPOCH = new Date(1980, 0, 1, 0, 0, 0);
const ENTRY: ZipOptions = { level: 9, mtime: EPOCH };

export function packIpcc(b: UnpackedBundle): Uint8Array {
  const files = b.files.filter((f) => !isJunk(f.path)).sort((x, y) => comparePaths(x.path, y.path));
  const entries: Record<string, [Uint8Array, ZipOptions]> = {};
  for (const f of files) {
    const name = `Payload/${b.name}.bundle/${f.path}`;
    if (name in entries) throw new Error(`${b.name}.bundle: ${f.path} twice`);
    entries[name] = [f.bytes, ENTRY];
  }
  return zipSync(entries);
}

/** The first `<Name>.bundle/` directory's files, as openIpcc finds it. */
export function unpackIpcc(bytes: Uint8Array): UnpackedBundle {
  const zip = unzipSync(bytes);
  const [, root, name] = Object.keys(zip).map((n) => /^(.*?([^/]+)\.bundle\/)/.exec(n)).find((m) => m !== null) ?? [];
  if (root === undefined || name === undefined) throw new Error("ipcc has no .bundle directory");
  const files = Object.entries(zip)
    .filter(([n]) => n.startsWith(root) && !n.endsWith("/") && !isJunk(n.slice(root.length)))
    .map(([n, data]) => ({ path: n.slice(root.length), bytes: data }))
    .sort((x, y) => comparePaths(x.path, y.path));
  return { name, files };
}

/** CFBundleVersion from Info.plist; undefined when it has none. */
export function bundleVersion(b: UnpackedBundle): string | undefined {
  const info = b.files.find((f) => f.path === "Info.plist");
  if (!info) return undefined;
  const plist = parsePlist(info.bytes);
  const version = isPlistDict(plist) ? plist.CFBundleVersion : undefined;
  return typeof version === "string" || typeof version === "number" ? String(version) : undefined;
}
