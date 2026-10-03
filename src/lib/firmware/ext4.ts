/**
 * Read-only ext4: extents and inline data. Directories are read linearly: htree index
 * blocks look like one empty dirent spanning the block, so a linear walk skips them.
 */

import { asciiAt, u16le, u32le, u8 } from "../binary/index.ts";
import type { BlockReader } from "./partition.ts";
import { FsError, FsNotFoundError, type DirEntry, type FileKind, type Filesystem } from "./fs.ts";

const MAGIC = 0xef53;
const ROOT = 2;
const EXTENTS_FL = 0x80000;
const INLINE_DATA_FL = 0x10000000;
const INCOMPAT_FILETYPE = 0x2;
const INCOMPAT_64BIT = 0x80;
const EXTENT_MAGIC = 0xf30a;
/** An extent's length above this marks it uninitialized (reads as zeros), length - 32768. */
const EXT_INIT_MAX_LEN = 32768;

interface Superblock {
  readonly blockSize: number;
  readonly inodesPerGroup: number;
  readonly inodeSize: number;
  readonly descSize: number;
  readonly firstDataBlock: number;
  readonly incompat: number;
}

interface Inode {
  readonly number: number;
  readonly mode: number;
  readonly size: number;
  readonly flags: number;
  /** i_block, 60 bytes: extent root, block map, or inline data. */
  readonly block: Uint8Array;
  /** The whole on-disk inode, for in-inode xattrs. */
  readonly raw: Uint8Array;
}

function kindOfMode(mode: number): FileKind {
  switch (mode & 0xf000) {
    case 0x8000: return "file";
    case 0x4000: return "dir";
    case 0xa000: return "symlink";
    default: return "other";
  }
}

/** Dirent file_type byte (with INCOMPAT_FILETYPE). */
function kindOfDirent(t: number): FileKind | undefined {
  return t === 1 ? "file" : t === 2 ? "dir" : t === 7 ? "symlink" : t === 0 ? undefined : "other";
}

export function isExt4(superblock: Uint8Array): boolean {
  return superblock.length >= 58 && u16le(superblock, 56) === MAGIC;
}

/** Extents of a file, logical block -> physical block, with uninitialized ones flagged. */
interface Extent {
  readonly logical: number;
  readonly physical: number;
  readonly length: number;
  readonly zero: boolean;
}

/** An ext4 image over a BlockReader. Holds the superblock and an inode lookup, so it is a class. */
export class Ext4 implements Filesystem {
  readonly kind = "ext4";
  private readonly r: BlockReader;
  private readonly sb: Superblock;

  private constructor(r: BlockReader, sb: Superblock) {
    this.r = r;
    this.sb = sb;
  }

  static async open(r: BlockReader): Promise<Ext4> {
    const raw = await r.read(1024, 1024);
    if (!isExt4(raw)) throw new FsError(`${r.label}: no ext4 superblock`);
    const incompat = u32le(raw, 96);
    return new Ext4(r, {
      blockSize: 1024 << u32le(raw, 24),
      inodesPerGroup: u32le(raw, 40),
      inodeSize: u16le(raw, 88),
      descSize: incompat & INCOMPAT_64BIT ? u16le(raw, 254) : 32,
      firstDataBlock: u32le(raw, 20),
      incompat,
    });
  }

  private async inode(n: number): Promise<Inode> {
    const { blockSize, inodesPerGroup, inodeSize, descSize, firstDataBlock, incompat } = this.sb;
    const group = Math.floor((n - 1) / inodesPerGroup);
    const index = (n - 1) % inodesPerGroup;
    const desc = await this.r.read((firstDataBlock + 1) * blockSize + group * descSize, descSize);
    const tableHi = incompat & INCOMPAT_64BIT && descSize >= 64 ? u32le(desc, 0x28) : 0;
    const table = u32le(desc, 8) + tableHi * 2 ** 32;
    const raw = await this.r.read(table * blockSize + index * inodeSize, inodeSize);
    return {
      number: n,
      mode: u16le(raw, 0),
      size: u32le(raw, 4) + u32le(raw, 108) * 2 ** 32,
      flags: u32le(raw, 32),
      block: raw.subarray(40, 100),
      raw,
    };
  }

  /** Walks an extent tree node (the 60-byte root in the inode, or a full block below it). */
  private async extents(node: Uint8Array): Promise<Extent[]> {
    if (u16le(node, 0) !== EXTENT_MAGIC) throw new FsError(`${this.r.label}: bad extent header`);
    const entries = u16le(node, 2);
    const depth = u16le(node, 6);
    const out: Extent[] = [];
    for (let i = 0; i < entries; i++) {
      const e = 12 + i * 12;
      if (depth === 0) {
        const len = u16le(node, e + 4);
        out.push({
          logical: u32le(node, e),
          physical: u16le(node, e + 6) * 2 ** 32 + u32le(node, e + 8),
          length: len > EXT_INIT_MAX_LEN ? len - EXT_INIT_MAX_LEN : len,
          zero: len > EXT_INIT_MAX_LEN,
        });
      } else {
        const child = u16le(node, e + 8) * 2 ** 32 + u32le(node, e + 4);
        out.push(...(await this.extents(await this.r.read(child * this.sb.blockSize, this.sb.blockSize))));
      }
    }
    return out;
  }

  /**
   * Inline data: the first 60 bytes live in i_block, the rest in the
   * in-inode xattr `system.data` (name index 7, name "data").
   */
  private inlineData(ino: Inode): Uint8Array {
    const head = ino.block.subarray(0, Math.min(60, ino.size));
    if (ino.size <= 60) return head;
    const extra = u16le(ino.raw, 128);
    let p = 128 + extra;
    if (p + 4 > ino.raw.length || u32le(ino.raw, p) !== 0xea020000) throw new FsError(`inode ${ino.number}: inline data past 60 bytes but no xattrs`);
    const base = p + 4;
    for (p = base; p + 16 <= ino.raw.length && u32le(ino.raw, p) !== 0; ) {
      const nameLen = u8(ino.raw, p);
      const nameIndex = u8(ino.raw, p + 1);
      const valueOffset = u16le(ino.raw, p + 2);
      const valueSize = u32le(ino.raw, p + 8);
      if (nameIndex === 7 && asciiAt(ino.raw, p + 16, "data") && nameLen === 4) {
        const out = new Uint8Array(ino.size);
        out.set(head);
        out.set(ino.raw.subarray(base + valueOffset, base + valueOffset + valueSize), 60);
        return out;
      }
      p += (16 + nameLen + 3) & ~3;
    }
    throw new FsError(`inode ${ino.number}: inline data past 60 bytes but no system.data xattr`);
  }

  private async contents(ino: Inode): Promise<Uint8Array> {
    if (ino.flags & INLINE_DATA_FL) return this.inlineData(ino);
    // Android's image builders (make_ext4fs, mke2fs + e2fsdroid) always use extents.
    if (!(ino.flags & EXTENTS_FL)) throw new FsError(`${this.r.label}: inode ${ino.number} uses a block map, not extents`);
    const bs = this.sb.blockSize;
    const extents = await this.extents(ino.block);
    const out = new Uint8Array(ino.size);
    for (const e of extents) {
      const at = e.logical * bs;
      if (at >= ino.size || e.zero) continue;
      const len = Math.min(e.length * bs, ino.size - at);
      out.set(await this.r.read(e.physical * bs, len), at);
    }
    return out;
  }

  private async entries(ino: Inode): Promise<DirEntry[]> {
    const data = await this.contents(ino);
    const inline = (ino.flags & INLINE_DATA_FL) !== 0;
    const out: DirEntry[] = [];
    const typed = (this.sb.incompat & INCOMPAT_FILETYPE) !== 0;
    // Inline directories start with the parent's inode number, then dirents.
    for (let p = inline ? 4 : 0; p + 8 <= data.length; ) {
      const inode = u32le(data, p);
      const recLen = u16le(data, p + 4);
      const nameLen = u8(data, p + 6);
      if (recLen < 8) throw new FsError(`inode ${ino.number}: corrupt dirent at ${p}`);
      if (inode !== 0) {
        const name = new TextDecoder().decode(data.subarray(p + 8, p + 8 + nameLen));
        const kind = typed ? kindOfDirent(u8(data, p + 7)) : undefined;
        if (name !== "." && name !== "..") out.push({ name, inode, kind: kind ?? kindOfMode((await this.inode(inode)).mode) });
      }
      p += recLen;
    }
    return out;
  }

  private async lookup(path: string): Promise<Inode> {
    let ino = await this.inode(ROOT);
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

export function openExt4(r: BlockReader): Promise<Ext4> {
  return Ext4.open(r);
}
