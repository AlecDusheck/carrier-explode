/** A zip read in place: the central directory from the tail (zip64 too), then members by offset. */

import { latin1, safeU64le, u16le, u32le } from "../binary/index.ts";
import type { RetryOptions } from "../http/index.ts";
import { HttpSource, subSource, type RangeSource } from "./source.ts";

export class ZipFormatError extends Error {
  override name = "ZipFormatError";
}

export interface ZipEntry {
  readonly name: string;
  /** 0 stored, 8 deflate; others are listed but not readable here. */
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly crc32: number;
  readonly localHeaderOffset: number;
}

export interface RemoteZip {
  readonly source: RangeSource;
  readonly entries: readonly ZipEntry[];
  entry(name: string): ZipEntry | undefined;
  /** Where the member's (possibly compressed) bytes start. */
  dataOffset(entry: ZipEntry): Promise<number>;
  /** The member's bytes as stored. */
  readRaw(entry: ZipEntry): Promise<Uint8Array>;
  /** The member's bytes, inflated if deflated. */
  read(entry: ZipEntry): Promise<Uint8Array>;
  /** A stored member as a source of its own, read in place (payload.bin inside an OTA). */
  storedSource(entry: ZipEntry): Promise<RangeSource>;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** EOCD is 22 bytes plus a comment of up to 65535; the zip64 locator sits right before it. */
const TAIL = 22 + 0xffff + 20;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

interface Directory {
  readonly offset: number;
  readonly size: number;
  readonly count: number;
}

/** The last EOCD whose comment length reaches exactly to the end of the file. */
function findEocd(tail: Uint8Array): number {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32le(tail, i) === EOCD && i + 22 + u16le(tail, i + 20) === tail.length) return i;
  }
  throw new ZipFormatError("no end-of-central-directory record: not a zip, or truncated");
}

async function directory(src: RangeSource): Promise<Directory> {
  const tailStart = Math.max(0, src.size - TAIL);
  const tail = await src.read(tailStart, src.size - tailStart);
  const at = findEocd(tail);
  const count = u16le(tail, at + 10);
  const size = u32le(tail, at + 12);
  const offset = u32le(tail, at + 16);
  if (count !== U16_MAX && size !== U32_MAX && offset !== U32_MAX) return { offset, size, count };
  const loc = at - 20;
  if (loc < 0 || u32le(tail, loc) !== ZIP64_LOCATOR) throw new ZipFormatError("EOCD says zip64 but there is no zip64 locator");
  const recordAt = safeU64le(tail, loc + 8);
  const record = recordAt >= tailStart ? tail.subarray(recordAt - tailStart) : await src.read(recordAt, 56);
  if (u32le(record, 0) !== ZIP64_EOCD) throw new ZipFormatError(`no zip64 EOCD at ${recordAt}`);
  return { count: safeU64le(record, 32), size: safeU64le(record, 40), offset: safeU64le(record, 48) };
}

/** The u64 values of the zip64 extra field (id 1): the saturated CD fields, in size, compressed, offset order. */
function zip64Extra(extra: Uint8Array): number[] {
  for (let p = 0; p + 4 <= extra.length; p += 4 + u16le(extra, p + 2)) {
    if (u16le(extra, p) !== 1) continue;
    const count = Math.floor(u16le(extra, p + 2) / 8);
    return Array.from({ length: count }, (_, i) => safeU64le(extra, p + 4 + i * 8));
  }
  throw new ZipFormatError("entry needs zip64 values but has no zip64 extra field");
}

const utf8 = new TextDecoder();

function parseEntries(cd: Uint8Array, count: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (u32le(cd, p) !== CENTRAL) throw new ZipFormatError(`central directory entry ${i} at ${p} has a bad signature`);
    const flags = u16le(cd, p + 8);
    const nameLen = u16le(cd, p + 28);
    const extraLen = u16le(cd, p + 30);
    const commentLen = u16le(cd, p + 32);
    const rawName = cd.subarray(p + 46, p + 46 + nameLen);
    // Bit 11: UTF-8 names; otherwise CP437, which matches Latin-1 for the ASCII names firmware uses.
    const name = flags & 0x800 ? utf8.decode(rawName) : latin1(rawName);
    let wide: number[] | undefined;
    const widen = (v: number): number => {
      if (v !== U32_MAX) return v;
      wide ??= zip64Extra(cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen));
      const value = wide.shift();
      if (value === undefined) throw new ZipFormatError(`${name}: zip64 extra field is too short`);
      return value;
    };
    const size = widen(u32le(cd, p + 24));
    const compressedSize = widen(u32le(cd, p + 20));
    const localHeaderOffset = widen(u32le(cd, p + 42));
    entries.push({ name, method: u16le(cd, p + 10), compressedSize, size, crc32: u32le(cd, p + 16), localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Raw deflate through DecompressionStream, which Node 22, Workers and browsers all have. */
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A zip over any RangeSource. */
export async function openZip(src: RangeSource): Promise<RemoteZip> {
  const dir = await directory(src);
  const entries = parseEntries(await src.read(dir.offset, dir.size), dir.count);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const offsets = new Map<ZipEntry, Promise<number>>();

  const dataOffset = (e: ZipEntry): Promise<number> => {
    let found = offsets.get(e);
    if (!found) {
      found = src.read(e.localHeaderOffset, 30).then((h) => {
        if (u32le(h, 0) !== LOCAL) throw new ZipFormatError(`${e.name}: no local header at ${e.localHeaderOffset}`);
        return e.localHeaderOffset + 30 + u16le(h, 26) + u16le(h, 28);
      });
      offsets.set(e, found);
    }
    return found;
  };
  const readRaw = async (e: ZipEntry): Promise<Uint8Array> => src.read(await dataOffset(e), e.compressedSize);

  return {
    source: src,
    entries,
    entry: (name) => byName.get(name),
    dataOffset,
    readRaw,
    read: async (e) => {
      if (e.method === 0) return readRaw(e);
      if (e.method === 8) return inflateRaw(await readRaw(e));
      throw new ZipFormatError(`${e.name}: compression method ${e.method} is not supported`);
    },
    storedSource: async (e) => {
      if (e.method !== 0) throw new ZipFormatError(`${e.name} is compressed (method ${e.method}), so it cannot be read in place`);
      return subSource(src, await dataOffset(e), e.size, `${src.label}!${e.name}`);
    },
  };
}

/** A zip at a URL, read over HTTP Range requests. The source's `stats` say what it cost. */
export async function openRemoteZip(url: string, opts: RetryOptions = {}): Promise<RemoteZip & { readonly source: HttpSource }> {
  const source = await HttpSource.open(url, opts);
  return { ...(await openZip(source)), source };
}
