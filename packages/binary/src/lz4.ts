/** The LZ4 block format (no frame): sequences of literals and back-references. */

import { byteAt } from "./bounds.ts";

export class Lz4Error extends Error {
	override name = "Lz4Error";
}

/** A length nibble of 15 continues in the following bytes, each adding up to 255. */
function extended(
	src: Uint8Array,
	at: number,
	end: number,
	base: number,
): { readonly length: number; readonly next: number } {
	let length = base;
	let i = at;
	if (base === 15) {
		let b: number;
		do {
			if (i >= end) throw new Lz4Error("an LZ4 length runs past its block");
			b = byteAt(src, i++);
			length += b;
		} while (b === 255);
	}
	return { length, next: i };
}

/**
 * One block's sequences, written to `out` from `at`; a match may reach back before `at`, into an earlier linked
 * block. `partial` stops once `out` is full (LZ4_decompress_safe_partial). Returns where the output ends.
 */
export function decodeLz4Into(src: Uint8Array, out: Uint8Array, at: number, partial = false): number {
	let o = at;
	for (let i = 0; i < src.length;) {
		const token = byteAt(src, i);
		const literals = extended(src, i + 1, src.length, token >> 4);
		i = literals.next;
		if (i + literals.length > src.length) throw new Lz4Error("LZ4 literals run past their block");
		if (o + literals.length > out.length) {
			if (!partial) throw new Lz4Error(`LZ4 literals run past ${out.length} bytes`);
			out.set(src.subarray(i, i + out.length - o), o);
			return out.length;
		}
		out.set(src.subarray(i, i + literals.length), o);
		o += literals.length;
		i += literals.length;
		// The last sequence is literals alone.
		if (i >= src.length || (partial && o === out.length)) break;
		const offset = byteAt(src, i) | (byteAt(src, i + 1) << 8);
		if (offset === 0 || offset > o) throw new Lz4Error(`LZ4 offset ${offset} at output ${o}`);
		const match = extended(src, i + 2, src.length, token & 15);
		i = match.next;
		let left = match.length + 4;
		if (o + left > out.length) {
			if (!partial) throw new Lz4Error(`LZ4 match runs past ${out.length} bytes`);
			left = out.length - o;
		}
		// An overlapping match repeats the last `offset` bytes; copying at most that much at a time keeps each source written.
		while (left > 0) {
			const n = Math.min(left, offset);
			out.copyWithin(o, o - offset, o - offset + n);
			o += n;
			left -= n;
		}
		if (partial && o === out.length) break;
	}
	return o;
}

/** Exactly `size` bytes from one LZ4 block. */
export function decodeLz4Block(src: Uint8Array, size: number): Uint8Array {
	const out = new Uint8Array(size);
	const o = decodeLz4Into(src, out, 0);
	if (o !== size) throw new Lz4Error(`LZ4 block gives ${o} bytes, not ${size}`);
	return out;
}
