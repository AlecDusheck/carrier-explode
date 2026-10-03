/**
 * Decompressors are injected, not imported: XZ and BZ2 need sizeable JS/WASM
 * decoders that only the extractor container should carry. The site imports
 * this package for the zip reader and must never pull them in.
 */

/** Whole-buffer decompression. `size` is the exact output length the payload promises. */
export type Decompress = (data: Uint8Array, size: number) => Uint8Array | Promise<Uint8Array>;

export interface Decompressors {
  readonly xz?: Decompress;
  readonly bz2?: Decompress;
  readonly zstd?: Decompress;
}

export class MissingCodecError extends Error {
  override name = "MissingCodecError";
}
