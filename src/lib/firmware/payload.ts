/**
 * payload.bin, the A/B OTA image update_engine applies (system/update_engine
 * update_metadata.proto). A full OTA writes every partition with independent
 * operations, each producing whole blocks from its own compressed blob, so
 * any block can be had by fetching one blob.
 *
 *   "CrAU" | u64be version (2) | u64be manifest size | u32be metadata signature size
 *   | DeltaArchiveManifest | metadata signature | blobs (op.data_offset is relative to here)
 */

import { asciiAt, safeU64be, u32be } from "../binary/index.ts";
import type { Decompressors } from "./codecs.ts";
import { bytes, messages, parseMessage, string, uint, type Field } from "./protobuf.ts";
import type { RangeSource } from "./source.ts";
import type { RemoteZip } from "./zip.ts";

export class PayloadFormatError extends Error {
  override name = "PayloadFormatError";
}

/** InstallOperation.Type by number. The ones after DISCARD that are not REPLACE_* read a source image: incremental OTAs. */
const OP_TYPES = [
  "REPLACE", "REPLACE_BZ", "MOVE", "BSDIFF", "SOURCE_COPY", "SOURCE_BSDIFF", "ZERO", "DISCARD", "REPLACE_XZ",
  "PUFFDIFF", "BROTLI_BSDIFF", "ZUCCHINI", "LZ4DIFF_BSDIFF", "LZ4DIFF_PUFFDIFF", "REPLACE_ZSTD",
] as const;
export type OpType = (typeof OP_TYPES)[number] | `UNKNOWN_${number}`;

export interface Extent {
  readonly startBlock: number;
  readonly numBlocks: number;
}

export interface InstallOp {
  readonly type: OpType;
  /** Blob offset, relative to Payload.dataOffset. */
  readonly dataOffset: number;
  readonly dataLength: number;
  readonly dstExtents: readonly Extent[];
  readonly dataSha256?: Uint8Array;
}

export interface PartitionUpdate {
  readonly name: string;
  /** new_partition_info.size. */
  readonly size: number;
  readonly operations: readonly InstallOp[];
  readonly version?: string;
}

export interface Payload {
  readonly source: RangeSource;
  readonly blockSize: number;
  /** Absolute offset of the blob area in `source`. */
  readonly dataOffset: number;
  readonly partitions: readonly PartitionUpdate[];
  /** 0 for a full payload; incremental payloads carry their delta format version. */
  readonly minorVersion: number;
  /** YYYY-MM-DD, when the manifest says. */
  readonly securityPatchLevel?: string;
  /** Build time, seconds since the epoch. */
  readonly maxTimestamp?: number;
  readonly decompressors: Decompressors;
  partition(name: string): PartitionUpdate | undefined;
}

export interface PayloadOptions {
  readonly decompressors?: Decompressors;
}

function opType(n: number): OpType {
  return OP_TYPES[n] ?? `UNKNOWN_${n}`;
}

function extent(f: readonly Field[]): Extent {
  return { startBlock: uint(f, 1) ?? 0, numBlocks: uint(f, 2) ?? 0 };
}

function operation(f: readonly Field[]): InstallOp {
  const hash = bytes(f, 8);
  return {
    type: opType(uint(f, 1) ?? -1),
    dataOffset: uint(f, 2) ?? 0,
    dataLength: uint(f, 3) ?? 0,
    dstExtents: messages(f, 6).map(extent),
    ...(hash === undefined ? {} : { dataSha256: hash }),
  };
}

function partitionUpdate(f: readonly Field[]): PartitionUpdate {
  const name = string(f, 1);
  if (name === undefined) throw new PayloadFormatError("partition without a name");
  const info = messages(f, 7)[0];
  const size = info && uint(info, 1);
  if (size === undefined) throw new PayloadFormatError(`partition ${name} has no new_partition_info.size`);
  const version = string(f, 17);
  return {
    name,
    size,
    operations: messages(f, 8).map(operation),
    ...(version === undefined ? {} : { version }),
  };
}

/** Header and manifest of a payload.bin held in `src`. Version 2 is the only one A/B devices have shipped since Android 8. */
export async function openPayloadSource(src: RangeSource, opts: PayloadOptions = {}): Promise<Payload> {
  const head = await src.read(0, 24);
  if (!asciiAt(head, 0, "CrAU")) throw new PayloadFormatError(`${src.label}: not a payload (no CrAU magic)`);
  const version = safeU64be(head, 4);
  if (version !== 2) throw new PayloadFormatError(`${src.label}: payload version ${version} is not supported`);
  const manifestSize = safeU64be(head, 12);
  const signatureSize = u32be(head, 20);
  const headerSize = 24;
  const manifest = parseMessage(await src.read(headerSize, manifestSize));
  const blockSize = uint(manifest, 3) ?? 4096;
  const partitions = messages(manifest, 13).map(partitionUpdate);
  const byName = new Map(partitions.map((p) => [p.name, p]));
  const spl = string(manifest, 18);
  const maxTimestamp = uint(manifest, 14);
  return {
    source: src,
    blockSize,
    dataOffset: headerSize + manifestSize + signatureSize,
    partitions,
    minorVersion: uint(manifest, 12) ?? 0,
    ...(spl === undefined || spl === "" ? {} : { securityPatchLevel: spl }),
    ...(maxTimestamp === undefined ? {} : { maxTimestamp }),
    decompressors: opts.decompressors ?? {},
    partition: (name) => byName.get(name),
  };
}

/** payload.bin inside an OTA zip, where it is stored uncompressed and read in place. */
export async function openPayload(zip: RemoteZip, opts: PayloadOptions = {}): Promise<Payload> {
  const entry = zip.entry("payload.bin");
  if (!entry) throw new PayloadFormatError(`${zip.source.label}: no payload.bin (not an A/B OTA)`);
  return openPayloadSource(await zip.storedSource(entry), opts);
}
