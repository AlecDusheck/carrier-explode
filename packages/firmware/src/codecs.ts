/** Injected decompressors, so a bundle that never opens a payload carries none: the extractor passes decodeXz and its BZ2 and Zstandard libraries. */

/** Whole-buffer decompression. `size` is the exact output length the payload promises. */
export type Decompress = (data: Uint8Array, size: number) => Uint8Array | Promise<Uint8Array>;

export interface Decompressors {
	readonly xz: Decompress;
	readonly bz2: Decompress;
	readonly zstd: Decompress;
}
