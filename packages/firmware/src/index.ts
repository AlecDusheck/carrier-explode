/** OTA zips and payloads, partitions, ext4 / EROFS / FAT, sparse images, LZ4, LZFSE, XZ and AEA, read over HTTP Range, R2 or buffers. BZ2 and Zstandard are the caller's. */

import { isErofs, openErofs } from "./erofs.ts";
import { isExt4, openExt4 } from "./ext4.ts";
import { isFat, openFat } from "./fat.ts";
import { FsError, type Filesystem } from "./fs.ts";
import type { RangeSource } from "./source.ts";

export { bytesSource, HttpSource, SourceRangeError, type RangeSource } from "./source.ts";
export { r2Source, R2ReadError, type RangedBucket } from "./r2.ts";
export { openRemoteZip, openZip, ZipFormatError, type RemoteZip, type ZipEntry } from "./zip.ts";
export type { Decompressors } from "./codecs.ts";
export { openPayload, openPayloadSource, PayloadFormatError, type Payload } from "./payload.ts";
export { MissingPartitionError, PartitionError, partitionReader } from "./partition.ts";
export { openPartition, readSuperMetadata, SuperError } from "./super.ts";
export { ErofsCompressedError } from "./erofs-z.ts";
export { decodeLz4, decodeLz4Stream } from "./lz4.ts";
export { decodeXz, XzError } from "./xz.ts";
export { StreamEndError } from "./pull.ts";
export { LzfseError } from "./lzfse.ts";
export { isSparse, SparseError, sparseRuns, unsparse, type SparseRun } from "./sparse.ts";
export { FsError, FsNotFoundError, type DirEntry, type Filesystem } from "./fs.ts";
export { streamFat } from "./fat.ts";
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
