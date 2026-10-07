/** seek-bzip ships no types: the entry point the Pixel steps decode payload operations with. */
declare module "seek-bzip" {
	interface Bunzip {
		/** Decodes a whole .bz2 into `output`, a preallocated buffer or its size. */
		decode(input: Uint8Array, output?: Uint8Array | number): Buffer;
	}
	const Bunzip: Bunzip;
	export default Bunzip;
}
