/**
 * Dynamic partitions (liblp). A retrofit OTA (Pixel 3, Android 10 on) carries the
 * super's block devices (system, vendor, product) as its payload partitions, and the
 * logical images live in extents across them, mapped by the LP metadata on the first.
 */

import { bytesToHex, latin1, safeU64le, sha256Hex, slice, u16le, u32le } from "@carrier-explode/binary";
import { partitionReader } from "./partition.ts";
import type { Payload } from "./payload.ts";
import { checkRange, type RangeSource } from "./source.ts";

export class SuperError extends Error {
  override name = "SuperError";
}

const SECTOR = 512;
/** LP_PARTITION_RESERVED_BYTES: the geometry follows, then its backup, then slot 0's metadata. */
const RESERVED = 4096;
const GEOMETRY_SIZE = 4096;
const GEOMETRY_MAGIC = 0x616c4467;
const HEADER_MAGIC = 0x414c5030;
const METADATA_MAJOR = 10;
/** A retrofit super's first block device, which holds the metadata. */
const FIRST_DEVICE = "system";

/** A run of a logical partition: sectors of a block device, or zeros. */
export type SuperExtent =
  | { readonly kind: "linear"; readonly sectors: number; readonly device: string; readonly sector: number }
  | { readonly kind: "zero"; readonly sectors: number };

export interface SuperMetadata {
  readonly devices: readonly string[];
  readonly partitions: ReadonlyMap<string, readonly SuperExtent[]>;
}

const cName = (b: Uint8Array, o: number): string => latin1(slice(b, o, 36)).replace(/\0.*$/s, "");

interface Table {
  readonly offset: number;
  readonly count: number;
  readonly size: number;
}

async function checksum(bytes: Uint8Array, at: number, want: Uint8Array, what: string): Promise<void> {
  const zeroed = bytes.slice();
  zeroed.fill(0, at, at + 32);
  if ((await sha256Hex(zeroed)) !== bytesToHex(want)) throw new SuperError(`LP ${what} checksum mismatch`);
}

/** Slot 0's metadata from the first block device; undefined when it holds no LP geometry. */
export async function readSuperMetadata(first: RangeSource): Promise<SuperMetadata | undefined> {
  const geometry = await first.read(RESERVED, GEOMETRY_SIZE);
  if (u32le(geometry, 0) !== GEOMETRY_MAGIC) return undefined;
  const geometrySize = u32le(geometry, 4);
  await checksum(slice(geometry, 0, geometrySize), 8, slice(geometry, 8, 32), "geometry");
  const maxSize = u32le(geometry, 40);
  const meta = await first.read(RESERVED + 2 * GEOMETRY_SIZE, maxSize);
  if (u32le(meta, 0) !== HEADER_MAGIC) throw new SuperError(`${first.label}: no LP metadata header after the geometry`);
  if (u16le(meta, 4) !== METADATA_MAJOR) throw new SuperError(`${first.label}: LP metadata version ${u16le(meta, 4)}`);
  const headerSize = u32le(meta, 8);
  await checksum(slice(meta, 0, headerSize), 12, slice(meta, 12, 32), "header");
  const tables = slice(meta, headerSize, u32le(meta, 44));
  if ((await sha256Hex(tables)) !== bytesToHex(slice(meta, 48, 32))) throw new SuperError("LP tables checksum mismatch");
  const table = (i: number): Table => ({ offset: u32le(meta, 80 + 12 * i), count: u32le(meta, 84 + 12 * i), size: u32le(meta, 88 + 12 * i) });
  const rows = (t: Table): number[] => Array.from({ length: t.count }, (_, i) => t.offset + i * t.size);
  const [partitions, extents, , devices] = [0, 1, 2, 3].map(table);
  if (!partitions || !extents || !devices) throw new SuperError("LP metadata without its tables");

  const deviceNames = rows(devices).map((o) => cName(tables, o + 24));
  const extent = (o: number): SuperExtent => {
    const sectors = safeU64le(tables, o);
    const type = u32le(tables, o + 8);
    if (type === 1) return { kind: "zero", sectors };
    const device = deviceNames[u32le(tables, o + 20)];
    if (type !== 0 || device === undefined) throw new SuperError(`LP extent of type ${type} on device ${u32le(tables, o + 20)}`);
    return { kind: "linear", sectors, device, sector: safeU64le(tables, o + 12) };
  };
  const extentRows = rows(extents);
  return {
    devices: deviceNames,
    partitions: new Map(rows(partitions).map((o) => {
      const first = u32le(tables, o + 40);
      return [cName(tables, o), extentRows.slice(first, first + u32le(tables, o + 44)).map(extent)];
    })),
  };
}

/** A logical partition as one source over its extents. */
function extentsSource(label: string, extents: readonly SuperExtent[], device: (name: string) => RangeSource): RangeSource {
  const runs = extents.reduce<{ start: number; extent: SuperExtent }[]>((out, extent) => {
    const last = out.at(-1);
    out.push({ start: last ? last.start + last.extent.sectors * SECTOR : 0, extent });
    return out;
  }, []);
  const src: RangeSource = {
    label,
    size: extents.reduce((n, e) => n + e.sectors * SECTOR, 0),
    read: async (offset, length) => {
      checkRange(src, offset, length);
      const out = new Uint8Array(length);
      for (const { start, extent } of runs) {
        const end = start + extent.sectors * SECTOR;
        const from = Math.max(offset, start);
        const to = Math.min(offset + length, end);
        if (from >= to || extent.kind === "zero") continue;
        out.set(await device(extent.device).read(extent.sector * SECTOR + from - start, to - from), from - offset);
      }
      return out;
    },
  };
  return src;
}

/**
 * A partition's image: the payload partition itself, or for a retrofit OTA's logical
 * partitions, the extents the super maps across its block devices.
 */
export async function openPartition(payload: Payload, name: string): Promise<RangeSource> {
  // Payloads that describe dynamic partitions carry the logical images themselves.
  if (payload.dynamicPartitions || !payload.partition(FIRST_DEVICE)) return partitionReader(payload, name);
  const readers = new Map<string, RangeSource>();
  const device = (dev: string): RangeSource => {
    const hit = readers.get(dev) ?? partitionReader(payload, dev);
    readers.set(dev, hit);
    return hit;
  };
  const metadata = await readSuperMetadata(device(FIRST_DEVICE));
  if (!metadata) return partitionReader(payload, name);
  const extents = metadata.partitions.get(name);
  if (extents) return extentsSource(`${payload.source.label}:super/${name}`, extents, device);
  // A block device's payload partition is not an image; any other (modem, boot) is.
  if (metadata.devices.includes(name)) throw new SuperError(`${payload.source.label}: ${name} is a super block device without a logical partition of its name`);
  return partitionReader(payload, name);
}
