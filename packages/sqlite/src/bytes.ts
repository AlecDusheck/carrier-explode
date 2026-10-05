/** Bounds-checked big-endian reads and SQLite's varint. This package has no dependencies, so it keeps its own. */

export class SqliteError extends Error {
  override name = "SqliteError";
}

export function need(b: Uint8Array, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > b.length) {
    throw new SqliteError(`read of ${length} byte(s) at ${offset} is outside a ${b.length}-byte buffer`);
  }
}

export function u8(b: Uint8Array, o: number): number {
  const v = b[o];
  if (v === undefined) throw new SqliteError(`read of 1 byte(s) at ${o} is outside a ${b.length}-byte buffer`);
  return v;
}

export function u16(b: Uint8Array, o: number): number {
  return (u8(b, o) << 8) | u8(b, o + 1);
}

export function u32(b: Uint8Array, o: number): number {
  return u16(b, o) * 0x10000 + u16(b, o + 2);
}

export function slice(b: Uint8Array, offset: number, length: number): Uint8Array {
  need(b, offset, length);
  return b.subarray(offset, offset + length);
}

export function view(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

/** A big-endian two's-complement integer of 1 to 8 bytes, as a number when safe. */
export function signedBE(b: Uint8Array, o: number, width: number): number | bigint {
  need(b, o, width);
  let v = 0n;
  for (let i = 0; i < width; i++) v = (v << 8n) | BigInt(u8(b, o + i));
  const n = BigInt.asIntN(width * 8, v);
  return n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n;
}

export interface Varint {
  readonly value: bigint;
  readonly next: number;
}

/** SQLite's varint: 1 to 9 bytes, big-endian groups of 7 bits, the ninth byte contributing all 8. */
export function varint(b: Uint8Array, o: number): Varint {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    const x = u8(b, o + i);
    v = (v << 7n) | BigInt(x & 0x7f);
    if (x < 0x80) return { value: v, next: o + i + 1 };
  }
  return { value: (v << 8n) | BigInt(u8(b, o + 8)), next: o + 9 };
}

/** A varint that is a size or a count, so it must fit a safe integer. */
export function sizeVarint(b: Uint8Array, o: number): { readonly value: number; readonly next: number } {
  const v = varint(b, o);
  if (v.value > BigInt(Number.MAX_SAFE_INTEGER)) throw new SqliteError(`varint ${v.value} at ${o} is too large for a size`);
  return { value: Number(v.value), next: v.next };
}
