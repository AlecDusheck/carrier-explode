/** The modem image's `md/modem-bundle.img`: an `HBLR` header listing named segments (`md1rom`, `md1dsp`, …). */

import { asciiAt, concatBytes, latin1, slice, u32le } from "@carrier-explode/binary";
import { McfError } from "./errors.ts";

const COUNT_AT = 0x30;
const TABLE_AT = 0x40;
const ENTRY = 0x30;
const NAME_LENGTH = 32;

interface Segment {
	readonly name: string;
	readonly offset: number;
	readonly length: number;
}

/** The segment table, from a header holding at least its first `TABLE_AT + count * ENTRY` bytes. */
function segments(head: Uint8Array): Segment[] {
	if (!asciiAt(head, 0, "HBLR")) throw new McfError("magic", 0, "not a modem bundle");
	return Array.from({ length: u32le(head, COUNT_AT) }, (_, i) => {
		const at = TABLE_AT + i * ENTRY;
		if (!asciiAt(head, at, "SEGM")) throw new McfError("magic", at, "not a bundle segment entry");
		const name = latin1(slice(head, at + 4, NAME_LENGTH)).replace(/\0+$/, "");
		const length = u32le(head, at + 8 + NAME_LENGTH);
		// The third word equals the second in every bundle read; a difference would mean a packed segment.
		if (u32le(head, at + 12 + NAME_LENGTH) !== length)
			throw new McfError("layout", at, `segment ${name} is not stored whole`);
		return { name, offset: u32le(head, at + 4 + NAME_LENGTH), length };
	});
}

/** A stream read at increasing offsets, holding one of its pieces at a time. */
class Reader {
	private readonly it: AsyncIterator<Uint8Array>;
	private pending: Uint8Array = new Uint8Array();
	/** Stream offset of `pending[0]`. */
	private at = 0;

	constructor(stream: AsyncIterable<Uint8Array>) {
		this.it = stream[Symbol.asyncIterator]();
	}

	/** `length` bytes at stream offset `offset`, at or past the end of the last read; short when the stream ends. */
	async read(offset: number, length: number): Promise<Uint8Array> {
		const out = new Uint8Array(length);
		let filled = 0;
		while (filled < length) {
			const from = Math.max(0, offset + filled - this.at);
			if (from < this.pending.length) {
				const take = this.pending.subarray(from, from + length - filled);
				out.set(take, filled);
				filled += take.length;
				continue;
			}
			this.at += this.pending.length;
			const next = await this.it.next();
			if (next.done) return out.subarray(0, filled);
			this.pending = next.value;
		}
		return out;
	}

	/** Stops the stream: what follows is never read. */
	async close(): Promise<void> {
		await this.it.return?.();
	}
}

/** One named segment of a bundle as it streams, read no further than the segment's end. */
export async function bundleSegment(bundle: AsyncIterable<Uint8Array>, name: string): Promise<Uint8Array> {
	const reader = new Reader(bundle);
	try {
		const top = await reader.read(0, TABLE_AT);
		const head = concatBytes([top, await reader.read(TABLE_AT, u32le(top, COUNT_AT) * ENTRY)]);
		const segment = segments(head).find((s) => s.name === name);
		if (segment === undefined) throw new McfError("layout", 0, `the modem bundle has no ${name}`);
		if (segment.offset < head.length)
			throw new McfError("layout", TABLE_AT, `segment ${name} overlaps the segment table`);
		const bytes = await reader.read(segment.offset, segment.length);
		if (bytes.length !== segment.length)
			throw new McfError("layout", segment.offset, `segment ${name} runs past the bundle`);
		return bytes;
	} finally {
		await reader.close();
	}
}
