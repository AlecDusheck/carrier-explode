/** LEB128 unsigned varints, as protobuf and many container formats write them. */

import { byteAt } from "./bounds.ts";

const MAX_BYTES = 10;

export class VarintError extends Error {
  override name = "VarintError";
  readonly offset: number;
  constructor(offset: number) {
    super(`varint at ${offset} is longer than ${MAX_BYTES} bytes`);
    this.offset = offset;
  }
}

export interface Varint {
  readonly value: bigint;
  /** Offset of the first byte after the varint. */
  readonly next: number;
}

/** Bits past 64 are dropped, as protobuf does. A truncated varint is a BoundsError. */
export function readVarint(b: Uint8Array, offset: number): Varint {
  let value = 0n;
  for (let i = 0; i < MAX_BYTES; i++) {
    const x = byteAt(b, offset + i);
    value |= BigInt(x & 0x7f) << BigInt(7 * i);
    if (x < 0x80) return { value: BigInt.asUintN(64, value), next: offset + i + 1 };
  }
  throw new VarintError(offset);
}
