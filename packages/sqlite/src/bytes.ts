/** SQLite's own integer encodings, over binary's bounds-checked reads. */

import { byteAt, slice } from "@carrier-explode/binary";

export class SqliteError extends Error {
	override name = "SqliteError";
}

/** A big-endian two's-complement integer of 1 to 8 bytes, as a number when safe. */
export function signedBE(b: Uint8Array, o: number, width: number): number | bigint {
	let v = 0n;
	for (const x of slice(b, o, width)) v = (v << 8n) | BigInt(x);
	const n = BigInt.asIntN(width * 8, v);
	return n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n;
}

interface Varint {
	readonly value: bigint;
	readonly next: number;
}

/** SQLite's varint: 1 to 9 bytes, big-endian groups of 7 bits, the ninth byte contributing all 8. */
export function varint(b: Uint8Array, o: number): Varint {
	let v = 0n;
	for (let i = 0; i < 8; i++) {
		const x = byteAt(b, o + i);
		v = (v << 7n) | BigInt(x & 0x7f);
		if (x < 0x80) return { value: v, next: o + i + 1 };
	}
	return { value: (v << 8n) | BigInt(byteAt(b, o + 8)), next: o + 9 };
}

/** A varint that is a size or a count, so it must fit a safe integer. */
export function sizeVarint(b: Uint8Array, o: number): { readonly value: number; readonly next: number } {
	const v = varint(b, o);
	if (v.value > BigInt(Number.MAX_SAFE_INTEGER))
		throw new SqliteError(`varint ${v.value} at ${o} is too large for a size`);
	return { value: Number(v.value), next: v.next };
}
