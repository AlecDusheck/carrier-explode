/** Injected decompressors: the XZ and BZ2 decoders belong to the extractor, never the site bundle. */

/** Whole-buffer decompression. `size` is the exact output length the payload promises. */
export type Decompress = (data: Uint8Array, size: number) => Uint8Array | Promise<Uint8Array>;

export interface Decompressors {
  readonly xz: Decompress;
  readonly bz2: Decompress;
  readonly zstd: Decompress;
}
