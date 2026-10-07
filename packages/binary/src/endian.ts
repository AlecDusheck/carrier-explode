/** Bounds-checked fixed-width integers. 64-bit reads are bigint; the `safe` variants are for sizes and offsets. */

import { byteAt, need } from "./bounds.ts";

/** A DataView over exactly `b`'s bytes (a subarray's view must not start at its buffer's 0). */
export function view(b: Uint8Array): DataView {
	return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

export function u8(b: Uint8Array, o: number): number {
	return byteAt(b, o);
}

export function u16le(b: Uint8Array, o: number): number {
	need(b, o, 2);
	return view(b).getUint16(o, true);
}

export function u16be(b: Uint8Array, o: number): number {
	need(b, o, 2);
	return view(b).getUint16(o, false);
}

export function u32le(b: Uint8Array, o: number): number {
	need(b, o, 4);
	return view(b).getUint32(o, true);
}

export function u32be(b: Uint8Array, o: number): number {
	need(b, o, 4);
	return view(b).getUint32(o, false);
}

export function u64le(b: Uint8Array, o: number): bigint {
	need(b, o, 8);
	return view(b).getBigUint64(o, true);
}

function u64be(b: Uint8Array, o: number): bigint {
	need(b, o, 8);
	return view(b).getBigUint64(o, false);
}

/** A 64-bit value that must be a safe integer (a size or an offset); larger means corrupt input. */
export function toSafe(v: bigint, what = "value"): number {
	if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${what} ${v} does not fit a safe integer`);
	return Number(v);
}

export function safeU64le(b: Uint8Array, o: number): number {
	return toSafe(u64le(b, o), `u64 at ${o}`);
}

export function safeU64be(b: Uint8Array, o: number): number {
	return toSafe(u64be(b, o), `u64 at ${o}`);
}

/** Big-endian unsigned integer of any width, exact. */
export function beBigInt(b: Uint8Array): bigint {
	let v = 0n;
	for (const x of b) v = (v << 8n) | BigInt(x);
	return v;
}

/** Little-endian unsigned integer of any width, exact. */
export function leBigInt(b: Uint8Array): bigint {
	let v = 0n;
	for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(byteAt(b, i));
	return v;
}

/** Little-endian unsigned integer of 1 to 8 bytes; undefined when empty, wider, or past 2^53. */
export function leUint(b: Uint8Array): number | undefined {
	if (!b.length || b.length > 8) return undefined;
	const n = Number(leBigInt(b));
	return Number.isSafeInteger(n) ? n : undefined;
}
