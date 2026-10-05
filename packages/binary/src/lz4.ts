/** The LZ4 block format (no frame): sequences of literals and back-references. */

import { byteAt, slice } from "./bounds.ts";
import { u16le } from "./endian.ts";

export class Lz4Error extends Error {
  override name = "Lz4Error";
}

/** A length nibble of 15 continues in the following bytes, each adding up to 255. */
function extended(src: Uint8Array, at: number, base: number): { readonly length: number; readonly next: number } {
  let length = base;
  let i = at;
  if (base === 15) {
    let b: number;
    do {
      b = byteAt(src, i++);
      length += b;
    } while (b === 255);
  }
  return { length, next: i };
}

/** Exactly `size` bytes from one LZ4 block. */
export function decodeLz4Block(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; ; ) {
    const token = byteAt(src, i);
    const literals = extended(src, i + 1, token >> 4);
    if (o + literals.length > size) throw new Lz4Error(`LZ4 literals run past ${size} bytes`);
    out.set(slice(src, literals.next, literals.length), o);
    o += literals.length;
    i = literals.next + literals.length;
    // The last sequence is literals alone.
    if (i === src.length) break;
    const offset = u16le(src, i);
    if (offset === 0 || offset > o) throw new Lz4Error(`LZ4 offset ${offset} at output ${o}`);
    const match = extended(src, i + 2, token & 15);
    let left = match.length + 4;
    if (o + left > size) throw new Lz4Error(`LZ4 match runs past ${size} bytes`);
    // An overlapping match repeats the last `offset` bytes; copying at most that much at a time keeps each source written.
    while (left > 0) {
      const n = Math.min(left, offset);
      out.copyWithin(o, o - offset, o - offset + n);
      o += n;
      left -= n;
    }
    i = match.next;
  }
  if (o !== size) throw new Lz4Error(`LZ4 block gives ${o} bytes, not ${size}`);
  return out;
}
