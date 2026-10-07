/** Bounds-checked byte access, which every reader in this package goes through, and joining buffers. */

/** A read outside the buffer: the input is truncated or an offset in it is wrong. */
export class BoundsError extends RangeError {
	override name = "BoundsError";
	readonly offset: number;
	readonly length: number;
	readonly size: number;
	constructor(offset: number, length: number, size: number) {
		super(`read of ${length} byte(s) at ${offset} is outside a ${size}-byte buffer`);
		this.offset = offset;
		this.length = length;
		this.size = size;
	}
}

/** Throws unless `length` bytes at `offset` lie inside `b`. */
export function need(b: Uint8Array, offset: number, length: number): void {
	if (
		!Number.isInteger(offset) ||
		!Number.isInteger(length) ||
		offset < 0 ||
		length < 0 ||
		offset + length > b.length
	) {
		throw new BoundsError(offset, length, b.length);
	}
}

export function byteAt(b: Uint8Array, offset: number): number {
	const v = b[offset];
	if (v === undefined) throw new BoundsError(offset, 1, b.length);
	return v;
}

/** A view of `length` bytes at `offset` (shares memory), or a BoundsError. */
export function slice(b: Uint8Array, offset: number, length: number): Uint8Array {
	need(b, offset, length);
	return b.subarray(offset, offset + length);
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
