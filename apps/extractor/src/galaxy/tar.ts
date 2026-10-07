/** A tar read as it streams: each entry's name, size and body, the body never held whole unless its reader collects it. */

import { concatBytes } from "@carrier-explode/binary";
import { DataError } from "../errors.ts";

class TarError extends DataError {
	override name = "TarError";
}

const RECORD = 512;
const latin1 = new TextDecoder("latin1");

const cstr = (b: Uint8Array, at: number, len: number): string =>
	latin1.decode(b.subarray(at, at + len)).replace(/\0.*$/, "");

/** A tar size: octal text, or (GNU, past 8 GiB) a big-endian number after a 0x80 byte. */
function tarSize(h: Uint8Array): number {
	if ((h[124] ?? 0) & 0x80) return h.subarray(125, 136).reduce((n, b) => n * 256 + b, 0);
	return parseInt(cstr(h, 124, 12).trim() || "0", 8);
}

/** One tar entry: its name and size, and its body as it streams, which must be read or skipped before the next entry. */
export interface TarEntry {
	readonly name: string;
	readonly size: number;
	readonly body: AsyncIterable<Uint8Array>;
}

/** A tar's entries as they stream. A body the caller leaves unread is skipped. */
export async function* tarEntries(input: AsyncIterable<Uint8Array>): AsyncGenerator<TarEntry> {
	const it = input[Symbol.asyncIterator]();
	let buf: Uint8Array = new Uint8Array(0);
	const fill = async (n: number): Promise<boolean> => {
		while (buf.length < n) {
			const next = await it.next();
			if (next.done) return false;
			buf = buf.length ? concatBytes([buf, next.value]) : next.value;
		}
		return true;
	};
	for (;;) {
		if (!(await fill(RECORD))) return;
		const header = buf.subarray(0, RECORD);
		buf = buf.subarray(RECORD);
		if (header.every((x) => x === 0)) return;
		const prefix = cstr(header, 345, 155);
		const name = `${prefix ? `${prefix}/` : ""}${cstr(header, 0, 100)}`;
		const size = tarSize(header);
		let left = size;
		async function* body(): AsyncGenerator<Uint8Array> {
			while (left > 0) {
				if (buf.length === 0) {
					const next = await it.next();
					if (next.done) throw new TarError(`${name}: the tar ended ${left} bytes into its body`);
					buf = next.value;
				}
				const take = Math.min(left, buf.length);
				const piece = buf.subarray(0, take);
				buf = buf.subarray(take);
				left -= take;
				yield piece;
			}
		}
		const entry = body();
		yield { name, size, body: entry };
		// Whatever the caller left unread, then the padding to the next record.
		while (!(await entry.next()).done) continue;
		const pad = (RECORD - (size % RECORD)) % RECORD;
		if (!(await fill(pad))) return;
		buf = buf.subarray(pad);
	}
}

/** A tar entry's body, held whole. */
export async function collect(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
	const parts: Uint8Array[] = [];
	for await (const p of body) parts.push(p);
	return concatBytes(parts);
}
