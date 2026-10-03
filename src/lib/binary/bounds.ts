/** Bounds-checked byte access: every reader in this package goes through here. */

/** A read outside the buffer: the input is truncated or an offset in it is wrong. */
export class BoundsError extends RangeError {
  override name = "BoundsError";
  constructor(readonly offset: number, readonly length: number, readonly size: number) {
    super(`read of ${length} byte(s) at ${offset} is outside a ${size}-byte buffer`);
  }
}

/** Throws unless `length` bytes at `offset` lie inside `b`. */
export function need(b: Uint8Array, offset: number, length: number): void {
  if (!Number.isInteger(offset) || offset < 0 || length < 0 || offset + length > b.length) {
    throw new BoundsError(offset, length, b.length);
  }
}

/** The byte at `offset`, or a BoundsError. */
export function byteAt(b: Uint8Array, offset: number): number {
  const v = b[offset];
  if (v === undefined) throw new BoundsError(offset, 1, b.length);
  return v;
}

/** A view of `length` bytes at `offset` (shares memory), or a BoundsError. */
export function slice(b: Uint8Array, offset: number, length: number): Uint8Array {
  need(b, offset, length);
  return b.subarray(offset, offset + length);
}
