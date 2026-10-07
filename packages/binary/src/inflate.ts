/** zlib inflation for the modem readers: to a declared size, streamed up to a cap, or only the first output. */

import { Unzlib, unzlibSync } from "fflate";
import { concatBytes } from "./bounds.ts";

/** Inflates a zlib stream whose header declared `size` bytes; throws past `cap` or when the stream disagrees. */
export function inflateExact(src: Uint8Array, size: number, cap: number, what: string): Uint8Array {
	if (size > cap) throw new Error(`${what}: ${size} bytes is too large`);
	const out = unzlibSync(src, { out: new Uint8Array(size) });
	if (out.length !== size) throw new Error(`${what}: inflated to ${out.length}, header says ${size}`);
	return out;
}

/** Streams at most `cap` bytes out of a zlib stream at the start of `src`; trailing bytes are ignored. */
export function inflateCapped(src: Uint8Array, cap: number): Uint8Array {
	const parts: Uint8Array[] = [];
	let n = 0;
	const s = new Unzlib((c) => {
		n += c.length;
		if (n > cap) throw new Error("inflated past cap");
		parts.push(c);
	});
	s.push(src, false);
	return concatBytes(parts);
}

/** The first chunk a zlib stream at the start of `src` inflates to; undefined when `src` yields none. Throws when `src` is not zlib. */
export function inflateHead(src: Uint8Array): Uint8Array | undefined {
	let head: Uint8Array | undefined;
	const s = new Unzlib((c) => {
		head ??= c;
	});
	s.push(src, false);
	return head;
}
