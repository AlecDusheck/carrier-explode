/**
 * The few protobuf wire-format reads update_engine's manifest needs. The
 * firmware readers must not depend on a decoder package, so this is its own
 * minimal copy: a message becomes a list of fields, looked up by number.
 */

import { readVarint, slice, toSafe } from "../binary/index.ts";

export class ManifestFormatError extends Error {
  override name = "ManifestFormatError";
}

export type Field =
  | { readonly field: number; readonly kind: "varint"; readonly value: bigint }
  | { readonly field: number; readonly kind: "bytes"; readonly value: Uint8Array }
  | { readonly field: number; readonly kind: "fixed"; readonly value: Uint8Array };

export function parseMessage(b: Uint8Array): Field[] {
  const out: Field[] = [];
  for (let p = 0; p < b.length; ) {
    const key = readVarint(b, p);
    p = key.next;
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (wire === 0) {
      const v = readVarint(b, p);
      out.push({ field, kind: "varint", value: v.value });
      p = v.next;
    } else if (wire === 2) {
      const len = readVarint(b, p);
      const n = toSafe(len.value, "length");
      out.push({ field, kind: "bytes", value: slice(b, len.next, n) });
      p = len.next + n;
    } else if (wire === 1 || wire === 5) {
      const n = wire === 1 ? 8 : 4;
      out.push({ field, kind: "fixed", value: slice(b, p, n) });
      p += n;
    } else throw new ManifestFormatError(`unsupported wire type ${wire} at byte ${p}`);
  }
  return out;
}

/** The last varint for `field` (proto2 semantics for a repeated scalar read as optional), as a safe number. */
export function uint(fields: readonly Field[], field: number): number | undefined {
  const f = fields.findLast((x) => x.field === field && x.kind === "varint");
  return f?.kind === "varint" ? toSafe(f.value, `field ${field}`) : undefined;
}

export function bytes(fields: readonly Field[], field: number): Uint8Array | undefined {
  const f = fields.findLast((x) => x.field === field && x.kind === "bytes");
  return f?.kind === "bytes" ? f.value : undefined;
}

export function string(fields: readonly Field[], field: number): string | undefined {
  const b = bytes(fields, field);
  return b === undefined ? undefined : new TextDecoder().decode(b);
}

/** Every embedded message for a repeated `field`, parsed. */
export function messages(fields: readonly Field[], field: number): Field[][] {
  return fields.flatMap((x) => (x.field === field && x.kind === "bytes" ? [parseMessage(x.value)] : []));
}
