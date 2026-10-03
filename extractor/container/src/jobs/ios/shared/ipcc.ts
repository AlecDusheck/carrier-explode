/** Image bundles packaged as OTA-shaped .ipcc zips, deterministically: the same files always give the same bytes. */

import { unzipSync, zipSync, type ZipOptions } from "fflate";

import { isPlistDict, parsePlist } from "../../../../../../src/lib/decode/index.ts";

/** One file of a bundle, by its path inside the .bundle directory. */
export interface BundleFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface Bundle {
  /** Without `.bundle`: `TMobile_us`, `UnitedStates`. */
  readonly name: string;
  readonly files: readonly BundleFile[];
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

/** The bundle as an .ipcc, byte-for-byte reproducible from its files. */
export function packIpcc(b: Bundle): Uint8Array {
  const files = b.files.filter((f) => !isJunk(f.path)).sort((x, y) => comparePaths(x.path, y.path));
  const seen = new Set<string>();
  const entries: Record<string, [Uint8Array, ZipOptions]> = {};
  for (const f of files) {
    if (seen.has(f.path)) throw new Error(`${b.name}.bundle: ${f.path} twice`);
    seen.add(f.path);
    entries[`Payload/${b.name}.bundle/${f.path}`] = [f.bytes, ENTRY];
  }
  return zipSync(entries);
}

/** The bundle inside an .ipcc: the first `<Name>.bundle/` directory's files, as openIpcc finds it. */
export function unpackIpcc(bytes: Uint8Array): Bundle {
  const zip = unzipSync(bytes);
  const m = Object.keys(zip)
    .map((n) => /^(.*?([^/]+)\.bundle\/)/.exec(n))
    .find((x) => x !== null);
  const root = m?.[1];
  const name = m?.[2];
  if (!root || !name) throw new Error("ipcc has no .bundle directory");
  const files = Object.entries(zip)
    .filter(([n]) => n.startsWith(root) && !n.endsWith("/"))
    .map(([n, data]) => ({ path: n.slice(root.length), bytes: data }))
    .filter((f) => !isJunk(f.path))
    .sort((x, y) => comparePaths(x.path, y.path));
  return { name, files };
}

/** CFBundleVersion from Info.plist; undefined when it has none. */
export function bundleVersion(b: Bundle): string | undefined {
  const info = b.files.find((f) => f.path === "Info.plist");
  if (!info) return undefined;
  const plist = parsePlist(info.bytes);
  const version = isPlistDict(plist) ? plist.CFBundleVersion : undefined;
  return typeof version === "string" || typeof version === "number" ? String(version) : undefined;
}
