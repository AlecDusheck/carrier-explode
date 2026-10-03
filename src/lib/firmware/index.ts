/**
 * Remote zip, A/B OTA payload, partition access, and read-only ext4 / EROFS.
 * fetch-based for Node and Workers; decompressors beyond deflate are injected.
 */

import { Erofs, isErofs } from "./erofs.ts";
import { Ext4, isExt4 } from "./ext4.ts";
import { FsError, type Filesystem } from "./fs.ts";
import type { BlockReader } from "./partition.ts";

export { bytesSource, HttpSource, SourceRangeError, subSource, type FetchStats, type RangeSource } from "./source.ts";
export { openRemoteZip, openZip, ZipFormatError, type RemoteZip, type ZipEntry } from "./zip.ts";
export type { Decompress, Decompressors } from "./codecs.ts";
export {
  openPayload, openPayloadSource, PayloadFormatError,
  type Extent, type InstallOp, type OpType, type PartitionUpdate, type Payload, type PayloadOptions,
} from "./payload.ts";
export { PartitionError, PartitionReader, partitionReader, type BlockReader, type PartitionReaderOptions } from "./partition.ts";
export { Ext4, openExt4 } from "./ext4.ts";
export { Erofs, ErofsCompressedError, EROFS_MAGIC, openErofs } from "./erofs.ts";
export { FsError, FsNotFoundError, type DirEntry, type FileKind, type Filesystem } from "./fs.ts";

/** ext4 or EROFS, by the superblock at 1024. */
export async function openFilesystem(r: BlockReader): Promise<Filesystem> {
  const sb = await r.read(1024, 128);
  if (isErofs(sb)) return Erofs.open(r);
  if (isExt4(sb)) return Ext4.open(r);
  throw new FsError(`${r.label}: neither ext4 nor EROFS`);
}
