/**
 * Protobuf wire-format reader: just enough of the encoding to walk proto2
 * messages field by field, with no schema and no dependencies. The decoders
 * in this directory drive it with their own field numbers; anything they do
 * not ask for is handed back as an UnknownField instead of being dropped.
 *
 *   tag = varint(field << 3 | wire);  wire 0 varint, 1 fixed64, 2 length-delimited, 5 fixed32
 */

import type { UnknownField } from "./types.ts";

export class ProtobufError extends Error {
  override name = "ProtobufError";
}

export type WireType = UnknownField["wire"];

const WIRE_NAMES: Readonly<Record<number, WireType>> = { 0: "varint", 1: "fixed64", 2: "bytes", 5: "fixed32" };

export interface Tag {
  readonly field: number;
  readonly wire: WireType;
}

const latin = new TextDecoder("utf-8", { fatal: false });

/** Sequential reader over one message's bytes. Owns a cursor, so it is a class. */
export class WireReader {
  private pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  /** The next field's tag, or undefined at the end of the message. */
  tag(): Tag | undefined {
    if (this.done) return undefined;
    const key = this.varint();
    const wire = WIRE_NAMES[Number(key & 7n)];
    if (wire === undefined) throw new ProtobufError(`unsupported wire type ${key & 7n} at byte ${this.pos}`);
    const field = Number(key >> 3n);
    if (field === 0) throw new ProtobufError(`field number 0 at byte ${this.pos}`);
    return { field, wire };
  }

  /** Raw varint, up to 64 bits, unsigned. */
  varint(): bigint {
    let v = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (this.pos >= this.buf.length) throw new ProtobufError("varint runs past the end");
      const b = this.buf[this.pos++];
      v |= BigInt(b & 0x7f) << shift;
      if (b < 0x80) return v & 0xffff_ffff_ffff_ffffn;
    }
    throw new ProtobufError(`varint longer than 10 bytes at byte ${this.pos}`);
  }

  /** int32 / enum: the low 32 bits, sign-extended (negatives are sent as 10-byte varints). */
  int32(): number {
    return Number(BigInt.asIntN(32, this.varint()));
  }

  /** int64 as a decimal string, since it may not fit a double. */
  int64(): string {
    return BigInt.asIntN(64, this.varint()).toString();
  }

  bool(): boolean {
    return this.varint() !== 0n;
  }

  bytes(): Uint8Array {
    const len = Number(this.varint());
    const end = this.pos + len;
    if (end > this.buf.length) throw new ProtobufError(`length ${len} at byte ${this.pos} runs past the end`);
    const out = this.buf.subarray(this.pos, end);
    this.pos = end;
    return out;
  }

  string(): string {
    return latin.decode(this.bytes());
  }

  double(): number {
    return new DataView(this.fixed(8).buffer, this.fixed.length).getFloat64(0, true);
  }

  /** Exactly `n` bytes, copied so the DataView over them starts at 0. */
  private fixed(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new ProtobufError(`fixed${n * 8} runs past the end`);
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /**
   * A repeated int32 / enum field. proto2 writers may pack it (one
   * length-delimited run) or not (one varint per tag); both are accepted.
   */
  int32s(wire: WireType): number[] {
    if (wire === "varint") return [this.int32()];
    if (wire !== "bytes") throw new ProtobufError(`repeated int32 sent as ${wire}`);
    const inner = new WireReader(this.bytes());
    const out: number[] = [];
    while (!inner.done) out.push(inner.int32());
    return out;
  }

  /** Reads a field nobody asked for, in the UnknownField encoding. */
  unknown(tag: Tag, path: string): UnknownField {
    const { field, wire } = tag;
    switch (wire) {
      case "varint":
        return { path, field, wire, value: this.varint().toString() };
      case "fixed64":
        return { path, field, wire, value: hex(this.fixed(8)) };
      case "fixed32":
        return { path, field, wire, value: hex(this.fixed(4)) };
      case "bytes":
        return { path, field, wire, value: base64(this.bytes()) };
    }
  }

  /** Checks a known field arrived with the wire type its proto declares. */
  expect(tag: Tag, wire: WireType, what: string): void {
    if (tag.wire !== wire) throw new ProtobufError(`${what} (field ${tag.field}) sent as ${tag.wire}, expected ${wire}`);
  }
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** btoa exists in browsers, Workers and Node 16+; it wants a binary string. */
export function base64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
