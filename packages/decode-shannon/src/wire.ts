/** Strict reading of the Shannon protobufs, whose layouts were read from the files themselves. */

import type { WireField } from "@carrier-explode/binary";

/**
 * A field outside the layout seen in the corpus, or a value that breaks it: the
 * meaning read from the files does not hold for this message.
 */
export class ShannonFormatError extends Error {
  override name = "ShannonFormatError";
}

export function unexpected(f: WireField, where: string): never {
  throw new ShannonFormatError(`${where}: unexpected field ${f.key}`);
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

export const text = (b: Uint8Array): string => utf8.decode(b);

/** A varint that must fit a safe integer. */
export function int(v: bigint, what: string): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ShannonFormatError(`${what} ${v} is too large`);
  return Number(v);
}

/** The value at `at`, 1-based, of a proto enum read as a table index. */
export function enumOf<const T extends readonly unknown[]>(table: T, at: number, what: string): T[number] {
  const v = table[at - 1];
  if (v === undefined) throw new ShannonFormatError(`${what} ${at}`);
  return v;
}

export function required<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new ShannonFormatError(`missing ${what}`);
  return v;
}
