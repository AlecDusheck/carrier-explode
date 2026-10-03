/**
 * seek-bzip ships no types. Only the buffer-in, buffer-out entry points the
 * android.ota job uses are declared; its stream classes are left out.
 */
declare module "seek-bzip" {
  interface Bunzip {
    /** Decodes a whole .bz2. `output` is a preallocated buffer or its size; `multistream` follows concatenated streams. */
    decode(input: Uint8Array, output?: Uint8Array | number, multistream?: boolean): Buffer;
    /** Decodes the one block starting at bit offset `pos` (from `table`). */
    decodeBlock(input: Uint8Array, pos: number, output?: Uint8Array | number): Buffer;
    /** Calls back once per block with its bit position and uncompressed size in bytes. */
    table(input: Uint8Array, callback: (position: number, size: number) => void, multistream?: boolean): void;
  }
  const Bunzip: Bunzip;
  export default Bunzip;
}
