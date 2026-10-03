/**
 * Image bundles as .ipcc files. Apple ships carrier bundles over the air as
 * .ipcc (a zip of `Payload/<Name>.bundle/...`); bundles cut out of an OS image
 * are packaged the same way, so one reader serves both. The packaging is
 * deterministic: entries in byte order of path, a fixed timestamp, deflate
 * level 9. The same files therefore give the same bytes, hence the same
 * sha256 and R2 key, on every run and every machine.
 *
 * Pure (fflate and the plist decoder), for the iOS decoder package.
 */

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

/**
 * DOS timestamps are local time, and fflate reads the Date's local fields; a
 * Date built from local fields gives 1980-01-01 00:00 in every time zone.
 */
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

/**
 * The bundle's own version, CFBundleVersion in its Info.plist: what the phone
 * compares to pick between an image copy and an OTA copy. Undefined when the
 * bundle has no readable Info.plist, which callers report.
 */
export function bundleVersion(b: Bundle): string | undefined {
  const info = b.files.find((f) => f.path === "Info.plist");
  if (!info) return undefined;
  const plist = parsePlist(info.bytes);
  const version = isPlistDict(plist) ? plist.CFBundleVersion : undefined;
  return typeof version === "string" || typeof version === "number" ? String(version) : undefined;
}
