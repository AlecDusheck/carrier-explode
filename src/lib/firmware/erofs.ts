/**
 * Read-only EROFS (linux fs/erofs/erofs_fs.h), which some Android builds use
 * for read-only partitions instead of ext4. Uncompressed layouts are read:
 * FLAT_PLAIN, FLAT_INLINE (tail packed after the inode) and CHUNK_BASED.
 * Compressed files (COMPRESSED_FULL / COMPRESSED_COMPACT) are detected and
 * refused with an error naming the layout, so a caller can tell "compressed
 * EROFS" apart from corruption.
 *
 *   superblock at 1024 | inodes at meta_blkaddr * blksz + nid * 32 (32-byte compact or 64-byte extended)
 *   dirent block: n × { u64 nid, u16 nameoff, u8 type, u8 _ } then names; n = first nameoff / 12
 */

import { safeU64le, u16le, u32le, u8 } from "../binary/index.ts";
import type { BlockReader } from "./partition.ts";
import { FsError, FsNotFoundError, type DirEntry, type FileKind, type Filesystem } from "./fs.ts";

export const EROFS_MAGIC = 0xe0f5e1e2;

const LAYOUT_NAMES = ["FLAT_PLAIN", "COMPRESSED_FULL", "FLAT_INLINE", "COMPRESSED_COMPACT", "CHUNK_BASED"] as const;
type Layout = (typeof LAYOUT_NAMES)[number];

const CHUNK_BLKBITS_MASK = 0x1f;
const CHUNK_INDEXES = 0x20;
const NULL_ADDR = 0xffffffff;

/** A file that is compressed: what callers catch to report "compressed EROFS". */
export class ErofsCompressedError extends FsError {
  override name = "ErofsCompressedError";
}

interface Superblock {
  readonly blockSize: number;
  readonly rootNid: number;
  readonly metaBlock: number;
  readonly featureIncompat: number;
  readonly dirBlockSize: number;
}

interface Inode {
  readonly nid: number;
  /** Byte position of the inode in the image. */
  readonly pos: number;
  readonly mode: number;
  readonly size: number;
  readonly layout: Layout;
  /** i_u: raw block address, or chunk format. */
  readonly union: number;
  /** Inode plus its inline xattrs: where inline tails and chunk tables start. */
  readonly bodyEnd: number;
}

export function isErofs(superblock: Uint8Array): boolean {
  return superblock.length >= 4 && u32le(superblock, 0) === EROFS_MAGIC;
}

function kindOfMode(mode: number): FileKind {
  switch (mode & 0xf000) {
    case 0x8000: return "file";
    case 0x4000: return "dir";
    case 0xa000: return "symlink";
    default: return "other";
  }
}

function kindOfType(t: number): FileKind {
  return t === 1 ? "file" : t === 2 ? "dir" : t === 7 ? "symlink" : "other";
}

/** An EROFS image over a BlockReader. Holds the superblock, so it is a class. */
export class Erofs implements Filesystem {
  readonly kind = "erofs";
  private readonly r: BlockReader;
  private readonly sb: Superblock;

  private constructor(r: BlockReader, sb: Superblock) {
    this.r = r;
    this.sb = sb;
  }

  static async open(r: BlockReader): Promise<Erofs> {
    const raw = await r.read(1024, 128);
    if (!isErofs(raw)) throw new FsError(`${r.label}: no EROFS superblock`);
    const blockSize = 1 << u8(raw, 12);
    return new Erofs(r, {
      blockSize,
      rootNid: u16le(raw, 14),
      metaBlock: u32le(raw, 40),
      featureIncompat: u32le(raw, 80),
      dirBlockSize: blockSize << u8(raw, 90),
    });
  }

  /** feature_incompat, for reports (compression, chunking, 48-bit layouts...). */
  get featureIncompat(): number {
    return this.sb.featureIncompat;
  }

  private async inode(nid: number): Promise<Inode> {
    const pos = this.sb.metaBlock * this.sb.blockSize + nid * 32;
    const head = await this.r.read(pos, Math.min(64, this.r.size - pos));
    const format = u16le(head, 0);
    const extended = (format & 1) === 1;
    const layout = LAYOUT_NAMES[(format >> 1) & 7];
    if (layout === undefined) throw new FsError(`${this.r.label}: nid ${nid} has unknown data layout ${(format >> 1) & 7}`);
    const xattrCount = u16le(head, 2);
    const xattrSize = xattrCount === 0 ? 0 : 12 + (xattrCount - 1) * 4;
    const inodeSize = extended ? 64 : 32;
    return {
      nid,
      pos,
      mode: u16le(head, 4),
      size: extended ? safeU64le(head, 8) : u32le(head, 8),
      layout,
      union: u32le(head, 16),
      bodyEnd: pos + inodeSize + xattrSize,
    };
  }

  private async chunked(ino: Inode): Promise<Uint8Array> {
    const bs = this.sb.blockSize;
    const chunkSize = bs << (ino.union & CHUNK_BLKBITS_MASK);
    const indexed = (ino.union & CHUNK_INDEXES) !== 0;
    const unit = indexed ? 8 : 4;
    const count = Math.ceil(ino.size / chunkSize);
    const tableAt = Math.ceil(ino.bodyEnd / unit) * unit;
    const table = await this.r.read(tableAt, count * unit);
    const out = new Uint8Array(ino.size);
    for (let i = 0; i < count; i++) {
      if (indexed && u16le(table, i * 8 + 2) !== 0) throw new FsError(`nid ${ino.nid}: chunk ${i} is on extra device ${u16le(table, i * 8 + 2)}`);
      const lo = indexed ? u32le(table, i * 8 + 4) : u32le(table, i * 4);
      // Indexed chunks keep the high 16 bits of a 48-bit block address in the first u16.
      const block = indexed && lo !== NULL_ADDR ? u16le(table, i * 8) * 2 ** 32 + lo : lo;
      if (lo === NULL_ADDR) continue;
      const len = Math.min(chunkSize, ino.size - i * chunkSize);
      out.set(await this.r.read(block * bs, len), i * chunkSize);
    }
    return out;
  }

  private async contents(ino: Inode): Promise<Uint8Array> {
    const bs = this.sb.blockSize;
    switch (ino.layout) {
      case "FLAT_PLAIN":
        return ino.size === 0 ? new Uint8Array() : this.r.read(ino.union * bs, ino.size);
      case "FLAT_INLINE": {
        const full = Math.floor(ino.size / bs) * bs;
        const out = new Uint8Array(ino.size);
        if (full) out.set(await this.r.read(ino.union * bs, full));
        if (ino.size > full) out.set(await this.r.read(ino.bodyEnd, ino.size - full), full);
        return out;
      }
      case "CHUNK_BASED":
        return this.chunked(ino);
      case "COMPRESSED_FULL":
      case "COMPRESSED_COMPACT":
        throw new ErofsCompressedError(`${this.r.label}: nid ${ino.nid} is ${ino.layout} (compressed EROFS), which this reader does not decompress`);
    }
  }

  private async entries(ino: Inode): Promise<DirEntry[]> {
    const data = await this.contents(ino);
    const out: DirEntry[] = [];
    for (let at = 0; at < data.length; at += this.sb.dirBlockSize) {
      const block = data.subarray(at, Math.min(data.length, at + this.sb.dirBlockSize));
      const count = u16le(block, 8) / 12;
      for (let i = 0; i < count; i++) {
        const nameStart = u16le(block, i * 12 + 8);
        const nameEnd = i + 1 < count ? u16le(block, (i + 1) * 12 + 8) : block.length;
        // The last name in a block runs to the block's end, padded with NULs.
        let end = nameEnd;
        while (end > nameStart && block[end - 1] === 0) end--;
        const name = new TextDecoder().decode(block.subarray(nameStart, end));
        if (name !== "." && name !== "..") out.push({ name, inode: safeU64le(block, i * 12), kind: kindOfType(u8(block, i * 12 + 10)) });
      }
    }
    return out;
  }

  private async lookup(path: string): Promise<Inode> {
    let ino = await this.inode(this.sb.rootNid);
    for (const part of path.split("/").filter((s) => s.length > 0)) {
      if (kindOfMode(ino.mode) !== "dir") throw new FsError(`${path}: ${part} is under a non-directory`);
      const hit = (await this.entries(ino)).find((e) => e.name === part);
      if (!hit) throw new FsNotFoundError(`${path}: no ${part}`);
      ino = await this.inode(hit.inode);
    }
    return ino;
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const ino = await this.lookup(path);
    if (kindOfMode(ino.mode) !== "dir") throw new FsError(`${path} is not a directory`);
    return this.entries(ino);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const ino = await this.lookup(path);
    if (kindOfMode(ino.mode) !== "file") throw new FsError(`${path} is not a regular file`);
    return this.contents(ino);
  }
}

export function openErofs(r: BlockReader): Promise<Erofs> {
  return Erofs.open(r);
}
