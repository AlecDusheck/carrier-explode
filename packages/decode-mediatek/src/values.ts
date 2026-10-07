/** A record value read by its item's shape: little-endian unsigned numbers, or the bytes kept with why. */

import { leUint, u16le, u32le, u8 } from "@carrier-explode/binary";
import type { ItemShape } from "./shapes.ts";

/** The table records widths, not signedness, so numbers are read unsigned. */
export type McfValue =
	| { readonly kind: "number"; readonly value: number }
	/** A run of consecutive 2- or 4-byte elements from the value's array index on. */
	| { readonly kind: "numbers"; readonly values: readonly number[] }
	/**
	 * A run of byte elements. The table does not say whether they are characters, so `text` is only their reading as
	 * printable ASCII up to a NUL, null when they do not read so.
	 */
	| { readonly kind: "chars"; readonly values: readonly number[]; readonly text: string | null }
	/** Elements of a width read as no number (5 or 8 bytes). */
	| { readonly kind: "bytes"; readonly bytes: Uint8Array }
	/** The value does not fit the item's shape (or the table lacks the item): kept as written. */
	| { readonly kind: "unknown"; readonly reason: string; readonly bytes: Uint8Array };

const READERS: ReadonlyMap<number, (b: Uint8Array, at: number) => number> = new Map([
	[1, u8],
	[2, u16le],
	[4, u32le],
]);

/** Printable ASCII, then one or more NULs to the end. */
function cString(b: Uint8Array): string | null {
	const end = b.indexOf(0);
	if (end <= 0 || b.subarray(end).some((x) => x !== 0)) return null;
	const head = b.subarray(0, end);
	return head.every((x) => x >= 0x20 && x < 0x7f) ? String.fromCharCode(...head) : null;
}

function bitValue(bytes: Uint8Array, bits: number): McfValue {
	const n = bytes.length === Math.ceil(bits / 8) ? leUint(bytes) : undefined;
	if (n === undefined)
		return { kind: "unknown", reason: `${bytes.length} bytes for a ${bits}-bit field`, bytes };
	return n < 2 ** bits
		? { kind: "number", value: n }
		: { kind: "unknown", reason: `${n} does not fit ${bits} bits`, bytes };
}

function elements(bytes: Uint8Array, size: number, depth: number): McfValue {
	const count = bytes.length / size;
	if (!Number.isInteger(count) || count === 0)
		return {
			kind: "unknown",
			reason: `${bytes.length} bytes is not a whole number of ${size}-byte elements`,
			bytes,
		};
	if (count > 1 && depth === 0) return { kind: "unknown", reason: `${count} elements for a scalar`, bytes };
	const read = READERS.get(size);
	if (read === undefined) return { kind: "bytes", bytes };
	const values = Array.from({ length: count }, (_, i) => read(bytes, i * size));
	const [only] = values;
	if (count === 1 && only !== undefined) return { kind: "number", value: only };
	return size === 1 ? { kind: "chars", values, text: cString(bytes) } : { kind: "numbers", values };
}

/** `path`: the value's array indices, as many as the item has dimensions. */
export function readValue(
	shape: ItemShape | undefined,
	path: readonly number[],
	bytes: Uint8Array,
): McfValue {
	if (shape === undefined) return { kind: "unknown", reason: "item not in the modem's item table", bytes };
	const [, size, unit, depth] = shape;
	if (path.length !== depth)
		return { kind: "unknown", reason: `${path.length} array indices for an item with ${depth}`, bytes };
	return unit === "bit" ? bitValue(bytes, size) : elements(bytes, size, depth);
}
