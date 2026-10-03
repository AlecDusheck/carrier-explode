/** Bit-level reading, bit masks and CRC-16, for the packed formats the decoders meet. */

import { byteAt } from "./bounds.ts";

/** MSB-first bit reader over a byte array. Keeps a cursor, so it is a class. */
export class BitReader {
  readonly buf: Uint8Array;
  readonly endBit: number;
  /** Current position in bits. */
  pos: number;
  constructor(buf: Uint8Array, startBit = 0, endBit = buf.length * 8) {
    this.buf = buf;
    this.pos = startBit;
    this.endBit = endBit;
  }

  get left(): number {
    return this.endBit - this.pos;
  }

  /** Reads `n` bits (n <= 32) as an unsigned integer. */
  u(n: number): number {
    if (n > 32) throw new RangeError(`cannot read ${n} bits at once`);
    if (this.pos + n > this.endBit) throw new RangeError(`read past end at bit ${this.pos}`);
    let v = 0;
    for (let i = 0; i < n; i++, this.pos++) {
      v = v * 2 + ((byteAt(this.buf, this.pos >> 3) >> (7 - (this.pos & 7))) & 1);
    }
    return v;
  }

  flag(): boolean {
    return this.u(1) === 1;
  }

  /** Reads `n` bits as a hex string, left-aligned and zero-padded to whole nibbles. */
  hex(n: number): string {
    let s = "";
    for (let left = n; left > 0; left -= 4) {
      const take = Math.min(4, left);
      s += (this.u(take) << (4 - take)).toString(16);
    }
    return s;
  }

  skip(n: number): void {
    if (this.pos + n > this.endBit) throw new RangeError(`skip past end at bit ${this.pos}`);
    this.pos += n;
  }

  /** Skips to the next octet boundary. */
  align(): void {
    this.pos = Math.min(this.endBit, (this.pos + 7) & ~7);
  }
}

/** Set-bit indices, lowest first. Exact for any safe integer or bigint; negative values are read as 64-bit two's complement. */
export function maskBits(value: number | bigint): number[] {
  let v: bigint;
  if (typeof value === "bigint") v = value;
  else if (Number.isSafeInteger(value)) v = BigInt(value);
  else return [];
  if (v < 0n) v = BigInt.asUintN(64, v);
  const bits: number[] = [];
  for (let i = 0; v > 0n; i++, v >>= 1n) if (v & 1n) bits.push(i);
  return bits;
}

/** CRC-16/CCITT (poly 0x1021, init 0xFFFF), not reflected; `invert` gives the ones-complement form. */
export function crc16Ccitt(b: Uint8Array, invert = false): number {
  let crc = 0xffff;
  for (const x of b) {
    crc ^= x << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return invert ? ~crc & 0xffff : crc;
}
