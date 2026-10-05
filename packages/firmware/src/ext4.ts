/**
 * Read-only ext4: extents and inline data. Directories are read linearly: htree index
 * blocks look like one empty dirent spanning the block, so a linear walk skips them.
 */

import { asciiAt, slice, u16le, u32le, u8 } from "@carrier-explode/binary";
import { FsError, kindOfDirent, pathFilesystem, type DirEntry, type Filesystem, type InodeStore } from "./fs.ts";
import type { RangeSource } from "./source.ts";

const SUPERBLOCK_AT = 1024;
const SUPERBLOCK_SIZE = 1024;
const MAGIC = 0xef53;
const ROOT = 2;
/** 1 KiB << 6: ext4's largest block size. */
const MAX_LOG_BLOCK = 6;
const EXTENTS_FL = 0x80000;
const INLINE_DATA_FL = 0x10000000;
const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;
const INCOMPAT_FILETYPE = 0x2;
const INCOMPAT_64BIT = 0x80;
const EXTENT_MAGIC = 0xf30a;
const MAX_EXTENT_DEPTH = 5;
const EXTENT_HEADER = 12;
const EXTENT_ENTRY = 12;
/** Extent lengths above this mark uninitialized extents, which read as zeros. */
const EXT_INIT_MAX_LEN = 32768;
/** i_block: the extent root, or the first 60 bytes of inline data. */
const I_BLOCK_AT = 40;
const I_BLOCK_SIZE = 60;
const GOOD_OLD_INODE_SIZE = 128;
/** In-inode xattr header magic, and the index of the `system.` namespace that holds inline data. */
const XATTR_MAGIC = 0xea020000;
const XATTR_SYSTEM = 7;
const XATTR_ENTRY = 16;
const DIRENT_HEADER = 8;

interface Superblock {
  readonly blockSize: number;
  readonly inodes: number;
  readonly inodesPerGroup: number;
  readonly inodeSize: number;
  readonly descSize: number;
  readonly descTableAt: number;
  readonly wideTables: boolean;
}

interface Inode {
  readonly number: number;
  readonly mode: number;
  readonly size: number;
  readonly flags: number;
  readonly raw: Uint8Array;
}

interface Extent {
  readonly logical: number;
  readonly physical: number;
  readonly length: number;
  readonly uninitialized: boolean;
}

export function isExt4(superblock: Uint8Array): boolean {
  return superblock.length >= 58 && u16le(superblock, 56) === MAGIC;
}

const iBlock = (ino: Inode): Uint8Array => slice(ino.raw, I_BLOCK_AT, I_BLOCK_SIZE);

/** Inline data past i_block's 60 bytes continues in the in-inode xattr `system.data`. */
function inlineData(ino: Inode): Uint8Array {
  const head = iBlock(ino).subarray(0, Math.min(I_BLOCK_SIZE, ino.size));
  if (ino.size <= I_BLOCK_SIZE) return head;
  const fail = (why: string): FsError => new FsError(`inode ${ino.number}: inline data past ${I_BLOCK_SIZE} bytes but ${why}`);
  if (ino.raw.length <= GOOD_OLD_INODE_SIZE) throw fail("no room for xattrs");
  const header = GOOD_OLD_INODE_SIZE + u16le(ino.raw, GOOD_OLD_INODE_SIZE);
  if (u32le(ino.raw, header) !== XATTR_MAGIC) throw fail("no xattrs");
  const first = header + 4;
  for (let p = first; p + XATTR_ENTRY <= ino.raw.length && u32le(ino.raw, p) !== 0; p += (XATTR_ENTRY + u8(ino.raw, p) + 3) & ~3) {
    if (u8(ino.raw, p) !== 4 || u8(ino.raw, p + 1) !== XATTR_SYSTEM || !asciiAt(ino.raw, p + XATTR_ENTRY, "data")) continue;
    const rest = slice(ino.raw, first + u16le(ino.raw, p + 2), u32le(ino.raw, p + 8));
    if (rest.length !== ino.size - I_BLOCK_SIZE) throw fail(`system.data holds ${rest.length} bytes`);
    const out = new Uint8Array(ino.size);
    out.set(head);
    out.set(rest, I_BLOCK_SIZE);
    return out;
  }
  throw fail("no system.data xattr");
}

class Ext4Store implements InodeStore<Inode> {
  private readonly r: RangeSource;
  private readonly sb: Superblock;

  constructor(r: RangeSource, sb: Superblock) {
    this.r = r;
    this.sb = sb;
  }

  root(): Promise<Inode> {
    return this.node(ROOT);
  }

  mode(ino: Inode): number {
    return ino.mode;
  }

  async node(n: number): Promise<Inode> {
    const { blockSize, inodes, inodesPerGroup, inodeSize, descSize, descTableAt, wideTables } = this.sb;
    if (!Number.isSafeInteger(n) || n < 1 || n > inodes) throw new FsError(`${this.r.label}: inode ${n} is outside 1..${inodes}`);
    const group = Math.floor((n - 1) / inodesPerGroup);
    const desc = await this.r.read(descTableAt + group * descSize, descSize);
    const table = u32le(desc, 8) + (wideTables ? u32le(desc, 0x28) * 2 ** 32 : 0);
    const raw = await this.r.read(table * blockSize + ((n - 1) % inodesPerGroup) * inodeSize, inodeSize);
    const size = u32le(raw, 4) + u32le(raw, 108) * 2 ** 32;
    return { number: n, mode: u16le(raw, 0), size, flags: u32le(raw, 32), raw };
  }

  /** The leaf extents under one tree node, whose header must say `depth`. */
  private async extents(node: Uint8Array, depth: number, inode: number): Promise<Extent[]> {
    const bad = (why: string): FsError => new FsError(`${this.r.label}: inode ${inode}: ${why}`);
    if (u16le(node, 0) !== EXTENT_MAGIC) throw bad("bad extent header");
    if (u16le(node, 6) !== depth) throw bad(`extent node at depth ${u16le(node, 6)}, expected ${depth}`);
    const count = u16le(node, 2);
    if (EXTENT_HEADER + count * EXTENT_ENTRY > node.length) throw bad(`${count} extents overflow their node`);
    const out: Extent[] = [];
    for (let i = 0; i < count; i++) {
      const e = EXTENT_HEADER + i * EXTENT_ENTRY;
      if (depth > 0) {
        const child = u16le(node, e + 8) * 2 ** 32 + u32le(node, e + 4);
        out.push(...(await this.extents(await this.r.read(child * this.sb.blockSize, this.sb.blockSize), depth - 1, inode)));
        continue;
      }
      const len = u16le(node, e + 4);
      const uninitialized = len > EXT_INIT_MAX_LEN;
      out.push({
        logical: u32le(node, e),
        physical: u16le(node, e + 6) * 2 ** 32 + u32le(node, e + 8),
        length: uninitialized ? len - EXT_INIT_MAX_LEN : len,
        uninitialized,
      });
    }
    return out;
  }

  async contents(ino: Inode): Promise<Uint8Array> {
    if (ino.flags & INLINE_DATA_FL) return inlineData(ino);
    // A fast symlink keeps its target in i_block.
    if ((ino.mode & S_IFMT) === S_IFLNK && !(ino.flags & EXTENTS_FL) && ino.size < I_BLOCK_SIZE) return iBlock(ino).subarray(0, ino.size);
    // Android's image builders always use extents; a block map means something else entirely.
    if (!(ino.flags & EXTENTS_FL)) throw new FsError(`${this.r.label}: inode ${ino.number} uses a block map, not extents`);
    const root = iBlock(ino);
    const depth = u16le(root, 6);
    if (depth > MAX_EXTENT_DEPTH) throw new FsError(`${this.r.label}: inode ${ino.number}: extent tree depth ${depth}`);
    const bs = this.sb.blockSize;
    const out = new Uint8Array(ino.size);
    for (const e of await this.extents(root, depth, ino.number)) {
      const at = e.logical * bs;
      if (at >= ino.size || e.uninitialized) continue;
      out.set(await this.r.read(e.physical * bs, Math.min(e.length * bs, ino.size - at)), at);
    }
    return out;
  }

  async entries(dir: Inode): Promise<DirEntry[]> {
    const data = await this.contents(dir);
    const out: DirEntry[] = [];
    // An inline directory starts with its parent's inode number.
    for (let p = dir.flags & INLINE_DATA_FL ? 4 : 0; p + DIRENT_HEADER <= data.length; ) {
      const inode = u32le(data, p);
      const recLen = u16le(data, p + 4);
      const nameLen = u8(data, p + 6);
      if (recLen < DIRENT_HEADER + nameLen) throw new FsError(`${this.r.label}: inode ${dir.number}: corrupt dirent at ${p}`);
      const name = new TextDecoder().decode(slice(data, p + DIRENT_HEADER, nameLen));
      if (inode !== 0 && name !== "." && name !== "..") out.push({ name, inode, kind: kindOfDirent(u8(data, p + 7)) });
      p += recLen;
    }
    return out;
  }
}

export async function openExt4(r: RangeSource): Promise<Filesystem> {
  const raw = await r.read(SUPERBLOCK_AT, SUPERBLOCK_SIZE);
  const bad = (why: string): FsError => new FsError(`${r.label}: ${why}`);
  if (!isExt4(raw)) throw bad("no ext4 superblock");
  const incompat = u32le(raw, 96);
  // Dirents carry their file type with this feature, which every Android image has.
  if (!(incompat & INCOMPAT_FILETYPE)) throw bad("ext4 without the filetype feature");
  const logBlock = u32le(raw, 24);
  if (logBlock > MAX_LOG_BLOCK) throw bad(`block size 1 KiB << ${logBlock}`);
  const blockSize = 1024 << logBlock;
  const inodesPerGroup = u32le(raw, 40);
  const inodeSize = u16le(raw, 88);
  if (inodesPerGroup === 0 || inodeSize < GOOD_OLD_INODE_SIZE) throw bad(`${inodesPerGroup} inodes per group of ${inodeSize} bytes`);
  const wide = (incompat & INCOMPAT_64BIT) !== 0;
  const descSize = wide ? u16le(raw, 254) : 32;
  if (descSize < 32) throw bad(`group descriptors of ${descSize} bytes`);
  return pathFilesystem("ext4", new Ext4Store(r, {
    blockSize,
    inodes: u32le(raw, 0),
    inodesPerGroup,
    inodeSize,
    descSize,
    descTableAt: (u32le(raw, 20) + 1) * blockSize,
    wideTables: wide && descSize >= 64,
  }));
}
