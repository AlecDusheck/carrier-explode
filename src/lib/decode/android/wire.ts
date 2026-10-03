/**
 * Protobuf wire-format reader: just enough of the encoding to walk proto2
 * messages field by field, with no schema. The decoders in this directory
 * drive it with their own field numbers; anything they do not ask for comes
 * back as an UnknownField instead of being dropped.
 *
 *   tag = varint(field << 3 | wire);  wire 0 varint, 1 fixed64, 2 length-delimited, 5 fixed32
 */

import { bytesToBase64, bytesToHex, readVarint, slice, view } from "../../binary/index.ts";
import type { UnknownField } from "./types.ts";

export class ProtobufError extends Error {
  override name = "ProtobufError";
}

export type WireType = UnknownField["wire"];

const WIRE_TYPES = { 0: "varint", 1: "fixed64", 2: "bytes", 5: "fixed32" } as const satisfies Readonly<Record<number, WireType>>;

function wireType(n: number): WireType | undefined {
  return n === 0 || n === 1 || n === 2 || n === 5 ? WIRE_TYPES[n] : undefined;
}

export interface Tag {
  readonly field: number;
  readonly wire: WireType;
  /** `<field>:<wire>`, what decoders switch on: a known number with an unexpected wire type falls through to unknown. */
  readonly key: `${number}:${WireType}`;
}

const utf8 = new TextDecoder();

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
    const at = this.pos;
    const key = this.varint();
    const wire = wireType(Number(key & 7n));
    if (wire === undefined) throw new ProtobufError(`unsupported wire type ${key & 7n} at byte ${at}`);
    const field = Number(key >> 3n);
    if (field === 0) throw new ProtobufError(`field number 0 at byte ${at}`);
    return { field, wire, key: `${field}:${wire}` };
  }

  /** Raw varint, up to 64 bits, unsigned. */
  varint(): bigint {
    const { value, next } = readVarint(this.buf, this.pos);
    this.pos = next;
    return value;
  }

  /** int32 / enum: the low 32 bits, sign-extended (negatives travel as 10-byte varints). */
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
    return this.take(len);
  }

  string(): string {
    return utf8.decode(this.bytes());
  }

  double(): number {
    return view(this.take(8)).getFloat64(0, true);
  }

  private take(n: number): Uint8Array {
    const out = slice(this.buf, this.pos, n);
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
        return { path, field, wire, value: bytesToHex(this.take(8)) };
      case "fixed32":
        return { path, field, wire, value: bytesToHex(this.take(4)) };
      case "bytes":
        return { path, field, wire, value: bytesToBase64(this.bytes()) };
    }
  }
}
