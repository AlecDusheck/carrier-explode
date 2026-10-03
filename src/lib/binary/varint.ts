/** LEB128 unsigned varints, as protobuf and many container formats write them. */

import { BoundsError, byteAt } from "./bounds.ts";

export class VarintError extends Error {
  override name = "VarintError";
}

export interface Varint {
  readonly value: bigint;
  /** Offset of the first byte after the varint. */
  readonly next: number;
}

/** At most 10 bytes (64 bits); bits past 64 are dropped, as protobuf does. */
export function readVarint(b: Uint8Array, offset: number): Varint {
  let value = 0n;
  for (let i = 0; i < 10; i++) {
    if (offset + i >= b.length) throw new BoundsError(offset + i, 1, b.length);
    const x = byteAt(b, offset + i);
    value |= BigInt(x & 0x7f) << BigInt(7 * i);
    if (x < 0x80) return { value: BigInt.asUintN(64, value), next: offset + i + 1 };
  }
  throw new VarintError(`varint at ${offset} is longer than 10 bytes`);
}
