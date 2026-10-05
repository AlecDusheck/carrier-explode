/** Deterministic zip archives: the same files always give the same bytes, so an archive's sha names its contents. */

import { unzipSync, zipSync, type ZipOptions } from "fflate";

const utf8 = new TextEncoder();

/** Byte order of the UTF-8 strings. */
export function compareUtf8(a: string, b: string): number {
  const x = utf8.encode(a);
  const y = utf8.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** fflate writes the Date's local fields, so one built from local fields is 1980-01-01 00:00 in every time zone. */
const EPOCH = new Date(1980, 0, 1, 0, 0, 0);
const ENTRY: ZipOptions = { level: 9, mtime: EPOCH };

/** zipSync takes an object, whose integer-like keys JavaScript orders first whatever the insertion order. */
const isIndexKey = (name: string): boolean => /^(0|[1-9]\d*)$/.test(name);

/** Members in UTF-8 path order, deflated at level 9, dated 1980-01-01. */
export function packFiles(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const entries: Record<string, [Uint8Array, ZipOptions]> = {};
  for (const name of [...files.keys()].sort(compareUtf8)) {
    if (name === "" || name.endsWith("/") || isIndexKey(name)) throw new Error(`packFiles: ${JSON.stringify(name)} is not a file path it can order`);
    const bytes = files.get(name);
    if (bytes !== undefined) entries[name] = [bytes, ENTRY];
  }
  return zipSync(entries);
}

/** Every file member by path; directory entries are left out. */
export function unpackFiles(bytes: Uint8Array): ReadonlyMap<string, Uint8Array> {
  return new Map(Object.entries(unzipSync(bytes)).filter(([name]) => !name.endsWith("/")));
}
