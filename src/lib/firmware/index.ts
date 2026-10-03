/**
 * Firmware readers: a remote zip over HTTP Range requests, an A/B OTA's
 * payload.bin, random access into one partition, and read-only ext4 / EROFS
 * on top. Decoder-agnostic and fetch-based, so it runs in Node 22, Workers
 * and browsers; decompressors other than deflate are injected (./codecs.ts).
 */

import { Erofs, isErofs } from "./erofs.ts";
import { Ext4, isExt4 } from "./ext4.ts";
import { FsError, type Filesystem } from "./fs.ts";
import type { BlockReader } from "./partition.ts";

export { bytesSource, HttpSource, SourceRangeError, subSource, type FetchStats, type RangeSource } from "./source.ts";
export { openRemoteZip, openZip, ZipFormatError, type RemoteZip, type ZipEntry } from "./zip.ts";
export { MissingCodecError, type Decompress, type Decompressors } from "./codecs.ts";
export {
  openPayload, openPayloadSource, PayloadFormatError,
  type Extent, type InstallOp, type OpType, type PartitionUpdate, type Payload, type PayloadOptions,
} from "./payload.ts";
export { PartitionError, PartitionReader, partitionReader, type BlockReader, type PartitionReaderOptions } from "./partition.ts";
export { Ext4, openExt4 } from "./ext4.ts";
export { Erofs, ErofsCompressedError, EROFS_MAGIC, openErofs } from "./erofs.ts";
export { FsError, type DirEntry, type FileKind, type Filesystem } from "./fs.ts";

/** ext4 or EROFS, by the superblock at 1024. */
export async function openFilesystem(r: BlockReader): Promise<Filesystem> {
  const sb = await r.read(1024, 128);
  if (isErofs(sb)) return Erofs.open(r);
  if (isExt4(sb)) return Ext4.open(r);
  throw new FsError(`${r.label}: neither ext4 nor EROFS`);
}
