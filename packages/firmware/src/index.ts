/** Remote zip, A/B OTA payload, partition access (retrofit supers included), read-only ext4 / EROFS / FAT, LZFSE and Apple Encrypted Archives. fetch-based; decompressors beyond deflate are injected. */

import { isErofs, openErofs } from "./erofs.ts";
import { isExt4, openExt4 } from "./ext4.ts";
import { isFat, openFat } from "./fat.ts";
import { FsError, type Filesystem } from "./fs.ts";
import type { RangeSource } from "./source.ts";

export { bytesSource, HttpSource, SourceRangeError, type RangeSource } from "./source.ts";
export { openRemoteZip, openZip, ZipFormatError, type RemoteZip, type ZipEntry } from "./zip.ts";
export type { Decompressors } from "./codecs.ts";
export { openPayload, openPayloadSource, type Payload } from "./payload.ts";
export { MissingPartitionError, partitionReader } from "./partition.ts";
export { openPartition, readSuperMetadata, SuperError } from "./super.ts";
export { ErofsCompressedError } from "./erofs.ts";
export { FsError, FsNotFoundError, type DirEntry, type Filesystem } from "./fs.ts";
export { openAea, type PlainStream } from "./aea/aea.ts";
export { fcsKey } from "./aea/fcs-key.ts";

/** ext4 or EROFS by their superblocks, which both start 1024 bytes in, or FAT by its boot sector. */
export async function openFilesystem(r: RangeSource): Promise<Filesystem> {
  const head = await r.read(0, 1024 + 128);
  const sb = head.subarray(1024);
  if (isErofs(sb)) return openErofs(r);
  if (isExt4(sb)) return openExt4(r);
  if (isFat(head)) return openFat(r);
  throw new FsError(`${r.label}: neither ext4, EROFS nor FAT`);
}
