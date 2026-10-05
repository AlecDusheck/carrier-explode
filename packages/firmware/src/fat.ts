/** Read-only FAT12/16/32 with VFAT long names: the Qualcomm modem partition (NON-HLOS) of the Pixel 1 and 2. */

import { asciiAt, latin1, slice, u16le, u32le, u8 } from "@carrier-explode/binary";
import { FsError, FsNotFoundError, type DirEntry, type Filesystem } from "./fs.ts";
import type { RangeSource } from "./source.ts";

const BOOT_SIZE = 512;
const DIRENT = 32;
const ATTR_DIR = 0x10;
const ATTR_VOLUME = 0x08;
const ATTR_LFN = 0x0f;
const DELETED = 0xe5;
/** Byte 12 (NT reserved): Windows' lower-case flags for an 8.3 base and extension. */
const LOWER_BASE = 0x08;
const LOWER_EXT = 0x10;
/** UTF-16 code unit offsets of the 13 characters a long-name entry holds. */
const LFN_CHARS = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30] as const;
/** Cluster counts below these make FAT12 and FAT16 (the Microsoft specification's rule). */
const FAT12_BELOW = 4085;
const FAT16_BELOW = 65525;

type FatType = 12 | 16 | 32;

interface Geometry {
  readonly type: FatType;
  readonly bytesPerSector: number;
  readonly clusterSize: number;
  readonly fatAt: number;
  readonly fatBytes: number;
  /** FAT12/16: the fixed root directory region. */
  readonly rootAt: number;
  readonly rootBytes: number;
  readonly rootCluster: number;
  readonly dataAt: number;
  readonly clusters: number;
}

/** A directory entry with what reading it needs; `cluster` is the DirEntry inode. */
interface Node {
  readonly name: string;
  readonly dir: boolean;
  readonly cluster: number;
  readonly size: number;
}

const isPow2 = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

/** A boot sector with the 0x55AA signature, a sane BPB and a FAT type label. */
export function isFat(boot: Uint8Array): boolean {
  if (boot.length < BOOT_SIZE || u8(boot, 510) !== 0x55 || u8(boot, 511) !== 0xaa) return false;
  const bps = u16le(boot, 11);
  return bps >= 512 && bps <= 4096 && isPow2(bps) && isPow2(u8(boot, 13)) && u8(boot, 16) >= 1 && u16le(boot, 14) >= 1
    && (asciiAt(boot, 54, "FAT") || asciiAt(boot, 82, "FAT32"));
}

function geometry(boot: Uint8Array, size: number, label: string): Geometry {
  const bytesPerSector = u16le(boot, 11);
  const sectorsPerCluster = u8(boot, 13);
  const reserved = u16le(boot, 14);
  const fats = u8(boot, 16);
  const rootEntries = u16le(boot, 17);
  const totalSectors = u16le(boot, 19) || u32le(boot, 32);
  const fatSectors = u16le(boot, 22) || u32le(boot, 36);
  const rootSectors = Math.ceil((rootEntries * DIRENT) / bytesPerSector);
  const dataSector = reserved + fats * fatSectors + rootSectors;
  const clusters = Math.floor((totalSectors - dataSector) / sectorsPerCluster);
  // Pixel 1's modem image declares 84 MB but ships 58.5 MB: images end after their last used cluster.
  if (clusters < 1 || dataSector * bytesPerSector >= size) throw new FsError(`${label}: FAT geometry outside the partition`);
  const type: FatType = clusters < FAT12_BELOW ? 12 : clusters < FAT16_BELOW ? 16 : 32;
  return {
    type,
    bytesPerSector,
    clusterSize: sectorsPerCluster * bytesPerSector,
    fatAt: reserved * bytesPerSector,
    fatBytes: fatSectors * bytesPerSector,
    rootAt: (reserved + fats * fatSectors) * bytesPerSector,
    rootBytes: rootSectors * bytesPerSector,
    rootCluster: type === 32 ? u32le(boot, 44) : 0,
    dataAt: dataSector * bytesPerSector,
    clusters,
  };
}

/** The next cluster of a chain, as the FAT of each width stores it. */
function nextOf(fat: Uint8Array, type: FatType): (cluster: number) => number {
  switch (type) {
    case 12: return (c) => {
      const v = u16le(fat, Math.floor(c * 1.5));
      return c & 1 ? v >> 4 : v & 0xfff;
    };
    case 16: return (c) => u16le(fat, c * 2);
    case 32: return (c) => u32le(fat, c * 4) & 0x0fffffff;
  }
}

/** The short name's checksum, which each of its long-name entries repeats. */
function shortChecksum(e: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < 11; i++) sum = (((sum & 1) << 7) + (sum >> 1) + u8(e, i)) & 0xff;
  return sum;
}

function shortName(e: Uint8Array): string {
  const flags = u8(e, 12);
  const base = latin1(slice(e, 0, 8)).trimEnd();
  const ext = latin1(slice(e, 8, 3)).trimEnd();
  // 0x05 stands for a leading 0xE5, which marks deleted entries.
  const b = (base.startsWith("\x05") ? `\xe5${base.slice(1)}` : base);
  const name = flags & LOWER_BASE ? b.toLowerCase() : b;
  const x = flags & LOWER_EXT ? ext.toLowerCase() : ext;
  return x ? `${name}.${x}` : name;
}

function lfnPart(e: Uint8Array): string {
  const units = LFN_CHARS.map((o) => u16le(e, o));
  const end = units.findIndex((u) => u === 0 || u === 0xffff);
  return String.fromCharCode(...(end < 0 ? units : units.slice(0, end)));
}

/** A directory's entries; long names whose checksum does not match their short entry are orphans and ignored, as FAT specifies. */
function entries(buf: Uint8Array): Node[] {
  const out: Node[] = [];
  let lfn: { parts: string[]; sum: number } | undefined;
  for (let at = 0; at + DIRENT <= buf.length; at += DIRENT) {
    const e = slice(buf, at, DIRENT);
    const first = u8(e, 0);
    if (first === 0) break;
    const attr = u8(e, 11);
    if (first === DELETED) {
      lfn = undefined;
      continue;
    }
    if (attr === ATTR_LFN) {
      const sum = u8(e, 13);
      lfn = first & 0x40 || lfn?.sum !== sum ? { parts: [lfnPart(e)], sum } : { parts: [lfnPart(e), ...lfn.parts], sum };
      continue;
    }
    const long = lfn?.sum === shortChecksum(e) ? lfn.parts.join("") : undefined;
    lfn = undefined;
    if (attr & ATTR_VOLUME) continue;
    const name = long ?? shortName(e);
    if (name === "." || name === "..") continue;
    out.push({ name, dir: (attr & ATTR_DIR) !== 0, cluster: (u16le(e, 20) << 16) | u16le(e, 26), size: u32le(e, 28) });
  }
  return out;
}

export async function openFat(r: RangeSource): Promise<Filesystem> {
  const boot = await r.read(0, BOOT_SIZE);
  if (!isFat(boot)) throw new FsError(`${r.label}: no FAT boot sector`);
  const g = geometry(boot, r.size, r.label);
  const next = nextOf(await r.read(g.fatAt, g.fatBytes), g.type);
  const end = g.type === 12 ? 0xff8 : g.type === 16 ? 0xfff8 : 0x0ffffff8;

  /** A chain's bytes, contiguous runs read at once; `size` stops it early for files. */
  async function chain(start: number, size?: number): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    let got = 0;
    const seen = new Set<number>();
    for (let c = start; c < end && (size === undefined || got < size); ) {
      if (c < 2 || c >= g.clusters + 2) throw new FsError(`${r.label}: cluster ${c} is outside the data area`);
      let n = 1;
      while (next(c + n - 1) === c + n) n++;
      for (let k = c; k < c + n; k++) {
        if (seen.has(k)) throw new FsError(`${r.label}: cluster chain from ${start} loops`);
        seen.add(k);
      }
      parts.push(await r.read(g.dataAt + (c - 2) * g.clusterSize, n * g.clusterSize));
      got += n * g.clusterSize;
      c = next(c + n - 1);
    }
    const out = new Uint8Array(got);
    parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
    if (size === undefined) return out;
    if (got < size) throw new FsError(`${r.label}: file chain from ${start} holds ${got} of its ${size} bytes`);
    return out.subarray(0, size);
  }

  const root = async (): Promise<Uint8Array> => (g.type === 32 ? chain(g.rootCluster) : r.read(g.rootAt, g.rootBytes));

  async function lookup(path: string): Promise<Node | undefined> {
    let node: Node | undefined;
    for (const part of path.split("/").filter((s) => s.length > 0)) {
      if (node && !node.dir) throw new FsError(`${path}: ${part} is under a non-directory`);
      const listed = entries(node ? await chain(node.cluster) : await root());
      // FAT names are case-insensitive.
      const want = part.toLowerCase();
      node = listed.find((e) => e.name.toLowerCase() === want);
      if (!node) throw new FsNotFoundError(path, part);
    }
    return node;
  }

  return {
    kind: "fat",
    async readdir(path): Promise<readonly DirEntry[]> {
      const node = await lookup(path);
      if (node && !node.dir) throw new FsError(`${path} is not a directory`);
      return entries(node ? await chain(node.cluster) : await root()).map((e) => ({ name: e.name, inode: e.cluster, kind: e.dir ? "dir" : "file" }));
    },
    async readFile(path): Promise<Uint8Array> {
      const node = await lookup(path);
      if (!node || node.dir) throw new FsError(`${path} is not a regular file`);
      return node.size === 0 ? new Uint8Array() : chain(node.cluster, node.size);
    },
    async readlink(path): Promise<string> {
      await lookup(path);
      throw new FsError(`${path} is not a symbolic link: FAT has none`);
    },
  };
}
