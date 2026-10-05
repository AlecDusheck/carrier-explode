/** Schema-less protobuf wire format: what any reader of a proto message needs before it knows the schema. */

import { slice } from "./bounds.ts";
import { toSafe } from "./endian.ts";
import { readVarint } from "./varint.ts";

export class ProtobufError extends Error {
  override name = "ProtobufError";
  /** Where in the message the bad tag starts. */
  readonly offset: number;
  constructor(offset: number, problem: string) {
    super(`${problem} at byte ${offset}`);
    this.offset = offset;
  }
}

type WireType = "varint" | "fixed64" | "bytes" | "fixed32";

type FieldOf<W extends WireType, V> = {
  readonly field: number;
  readonly wire: W;
  /** `<field>:<wire>`: switch on it, and a known number sent with an unexpected wire type falls through. */
  readonly key: `${number}:${W}`;
  readonly value: V;
};

/** One field as it sits on the wire. Groups (wire types 3 and 4) are not supported. */
export type WireField =
  | FieldOf<"varint", bigint>
  | FieldOf<"fixed64", Uint8Array>
  | FieldOf<"bytes", Uint8Array>
  | FieldOf<"fixed32", Uint8Array>;

const MAX_FIELD = 2 ** 29 - 1;

function field<W extends WireType, V>(field: number, wire: W, value: V): FieldOf<W, V> {
  return { field, wire, key: `${field}:${wire}`, value };
}

/** The fields of one message, in wire order. Byte values are views into `b`. */
export function* wireFields(b: Uint8Array): Generator<WireField, void, undefined> {
  for (let at = 0; at < b.length; ) {
    const tag = readVarint(b, at);
    const n = Number(tag.value >> 3n);
    if (n < 1 || n > MAX_FIELD) throw new ProtobufError(at, `field number ${tag.value >> 3n}`);
    const wire = Number(tag.value & 7n);
    let p = tag.next;
    switch (wire) {
      case 0: {
        const v = readVarint(b, p);
        yield field(n, "varint", v.value);
        p = v.next;
        break;
      }
      case 1:
        yield field(n, "fixed64", slice(b, p, 8));
        p += 8;
        break;
      case 2: {
        const len = readVarint(b, p);
        const size = toSafe(len.value, "length");
        yield field(n, "bytes", slice(b, len.next, size));
        p = len.next + size;
        break;
      }
      case 5:
        yield field(n, "fixed32", slice(b, p, 4));
        p += 4;
        break;
      default:
        throw new ProtobufError(at, `unsupported wire type ${wire}`);
    }
    at = p;
  }
}

/** A packed repeated varint field's values. */
export function packedVarints(b: Uint8Array): bigint[] {
  const out: bigint[] = [];
  for (let at = 0; at < b.length; ) {
    const v = readVarint(b, at);
    out.push(v.value);
    at = v.next;
  }
  return out;
}
