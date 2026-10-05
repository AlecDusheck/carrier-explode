/** Proto scalar values as the decoded JSON holds them, over binary's schema-less wire reader. */

import { bytesToBase64, bytesToHex, packedVarints, view, type WireField } from "@carrier-explode/binary";
import type { UnknownField } from "./types.ts";

const utf8 = new TextDecoder();

export const text = (b: Uint8Array): string => utf8.decode(b);

/** int32 and enums: the low 32 bits, sign-extended (negatives travel as 10-byte varints). */
export const int32 = (v: bigint): number => Number(BigInt.asIntN(32, v));

/** int64 as a decimal string, since it may not fit a double. */
export const int64 = (v: bigint): string => BigInt.asIntN(64, v).toString();

export const double = (b: Uint8Array): number => view(b).getFloat64(0, true);

type VarintField = Extract<WireField, { readonly wire: "varint" }>;
type BytesField = Extract<WireField, { readonly wire: "bytes" }>;

/** One occurrence of a repeated int32 or enum, packed or not: proto2 writers may do either. */
export function int32s(f: VarintField | BytesField): number[] {
  return f.wire === "varint" ? [int32(f.value)] : packedVarints(f.value).map(int32);
}

/** A field the decoder has no name for, kept in the UnknownField encoding. */
export function unknownField(f: WireField, path: string): UnknownField {
  const { field, wire } = f;
  switch (f.wire) {
    case "varint": return { path, field, wire, value: f.value.toString() };
    case "fixed64":
    case "fixed32": return { path, field, wire, value: bytesToHex(f.value) };
    case "bytes": return { path, field, wire, value: bytesToBase64(f.value) };
  }
}
