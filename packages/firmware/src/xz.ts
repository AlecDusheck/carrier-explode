/**
 * XZ streams with the LZMA2 filter, decoded whole into a buffer of known size: payload.bin's REPLACE_XZ operations.
 * Workers cannot compile WebAssembly at run time, so the decoder is plain TypeScript (LzmaSpec.cpp, xz-file-format.txt).
 */

import { crc32, u32le } from "@carrier-explode/binary";

export class XzError extends Error {
	override name = "XzError";
}

const MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] as const;
const LZMA2_FILTER = 0x21;
/** Bytes of each check type xz defines; types 0, 1 and 4 are verified, the rest only skipped. */
const CHECK_SIZES = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64] as const;
const CHECK_NONE = 0;
const CHECK_CRC32 = 1;
const CHECK_CRC64 = 4;

const CRC64_TABLE = ((): BigUint64Array => {
	const poly = 0xc96c5795d7870f42n;
	const table = new BigUint64Array(256);
	for (let i = 0; i < 256; i++) {
		let c = BigInt(i);
		for (let k = 0; k < 8; k++) c = c & 1n ? (c >> 1n) ^ poly : c >> 1n;
		table[i] = c;
	}
	return table;
})();

function crc64(b: Uint8Array): bigint {
	let c = 0xffffffffffffffffn;
	for (const x of b) c = (CRC64_TABLE[Number((c ^ BigInt(x)) & 0xffn)] ?? 0n) ^ (c >> 8n);
	return c ^ 0xffffffffffffffffn;
}

/** Bytes read in order, with xz's multibyte integers. */
class Input {
	pos = 0;
	constructor(readonly b: Uint8Array) {}

	byte(): number {
		const x = this.b[this.pos++];
		if (x === undefined) throw new XzError("the stream ends early");
		return x;
	}

	varint(): number {
		let n = 0;
		for (let shift = 0; shift < 63; shift += 7) {
			const x = this.byte();
			n += (x & 0x7f) * 2 ** shift;
			if ((x & 0x80) === 0) return n;
		}
		throw new XzError("a multibyte integer is too long");
	}
}

const NUM_STATES = 12;
const POS_STATES_MAX = 16;
const MATCH_LEN_MIN = 2;
const END_POS_MODEL_INDEX = 14;
const FULL_DISTANCES = 128;
const ALIGN_BITS = 4;
const PROB_INIT = 1024;

/** LZMA's length coder: a choice of 8 short, 8 middle or 256 long lengths. */
class LenDecoder {
	readonly choice = new Uint16Array(2);
	readonly low = new Uint16Array(POS_STATES_MAX << 3);
	readonly mid = new Uint16Array(POS_STATES_MAX << 3);
	readonly high = new Uint16Array(256);

	reset(): void {
		for (const p of [this.choice, this.low, this.mid, this.high]) p.fill(PROB_INIT);
	}
}

/** One LZMA2 stream's decoder state: the range coder, the probabilities and the output it writes into. */
class Lzma2 {
	private range = 0;
	private code = 0;
	private input: Uint8Array = new Uint8Array();
	private inPos = 0;

	private lc = 0;
	private lp = 0;
	private pb = 0;
	private state = 0;
	private rep0 = 0;
	private rep1 = 0;
	private rep2 = 0;
	private rep3 = 0;
	private literal = new Uint16Array(0x300);
	private readonly isMatch = new Uint16Array(NUM_STATES << 4);
	private readonly isRep = new Uint16Array(NUM_STATES);
	private readonly isRepG0 = new Uint16Array(NUM_STATES);
	private readonly isRepG1 = new Uint16Array(NUM_STATES);
	private readonly isRepG2 = new Uint16Array(NUM_STATES);
	private readonly isRep0Long = new Uint16Array(NUM_STATES << 4);
	private readonly posSlot = new Uint16Array(4 << 6);
	private readonly specPos = new Uint16Array(1 + FULL_DISTANCES - END_POS_MODEL_INDEX);
	private readonly align = new Uint16Array(1 << ALIGN_BITS);
	private readonly matchLen = new LenDecoder();
	private readonly repLen = new LenDecoder();

	/** Where the dictionary was last reset: no match reaches before it. */
	private dictStart = 0;

	constructor(
		private readonly out: Uint8Array,
		public outPos: number,
	) {
		this.dictStart = outPos;
	}

	/** The LZMA2 chunks from `src`, ending at its end-of-data byte. */
	decode(src: Input): void {
		let needDictReset = true;
		let needProps = true;
		for (;;) {
			const control = src.byte();
			if (control === 0x00) return;
			if (control === 0x01 || control === 0x02) {
				if (control === 0x01) {
					this.dictStart = this.outPos;
					needDictReset = false;
				} else if (needDictReset)
					throw new XzError("LZMA2: an uncompressed chunk before the dictionary is reset");
				const size = ((src.byte() << 8) | src.byte()) + 1;
				if (src.pos + size > src.b.length || this.outPos + size > this.out.length)
					throw new XzError("LZMA2: an uncompressed chunk overruns");
				this.out.set(src.b.subarray(src.pos, src.pos + size), this.outPos);
				src.pos += size;
				this.outPos += size;
				continue;
			}
			if (control < 0x80) throw new XzError(`LZMA2: control byte ${control}`);
			const reset = (control >> 5) & 3;
			if (reset === 3) {
				this.dictStart = this.outPos;
				needDictReset = false;
			} else if (needDictReset) throw new XzError("LZMA2: a chunk before the dictionary is reset");
			const unpacked = (control & 0x1f) * 0x10000 + ((src.byte() << 8) | src.byte()) + 1;
			const packed = ((src.byte() << 8) | src.byte()) + 1;
			if (reset >= 2) {
				this.props(src.byte());
				needProps = false;
			} else if (needProps) throw new XzError("LZMA2: a chunk before its properties");
			if (reset >= 1) this.resetState();
			if (src.pos + packed > src.b.length) throw new XzError("LZMA2: a chunk overruns the stream");
			this.chunk(src.b.subarray(src.pos, src.pos + packed), unpacked);
			src.pos += packed;
		}
	}

	private props(d: number): void {
		if (d >= 9 * 5 * 5) throw new XzError(`LZMA2: properties byte ${d}`);
		this.lc = d % 9;
		this.lp = Math.floor(d / 9) % 5;
		this.pb = Math.floor(d / 45);
		if (this.lc + this.lp > 4) throw new XzError("LZMA2: lc + lp exceeds 4");
		this.literal = new Uint16Array(0x300 << (this.lc + this.lp));
	}

	private resetState(): void {
		for (const p of [
			this.literal,
			this.isMatch,
			this.isRep,
			this.isRepG0,
			this.isRepG1,
			this.isRepG2,
			this.isRep0Long,
			this.posSlot,
			this.specPos,
			this.align,
		]) {
			p.fill(PROB_INIT);
		}
		this.matchLen.reset();
		this.repLen.reset();
		this.state = 0;
		this.rep0 = this.rep1 = this.rep2 = this.rep3 = 0;
	}

	private nextIn(): number {
		const x = this.input[this.inPos++];
		if (x === undefined) throw new XzError("LZMA: a chunk's compressed data ends early");
		return x;
	}

	private bit(probs: Uint16Array, i: number): number {
		const p = probs[i] ?? 0;
		const bound = (this.range >>> 11) * p;
		let bit: number;
		if (this.code < bound) {
			this.range = bound;
			probs[i] = p + ((2048 - p) >>> 5);
			bit = 0;
		} else {
			this.range -= bound;
			this.code -= bound;
			probs[i] = p - (p >>> 5);
			bit = 1;
		}
		if (this.range < 0x1000000) {
			this.range = (this.range * 256) >>> 0;
			this.code = ((this.code * 256) >>> 0) + this.nextIn();
		}
		return bit;
	}

	private direct(count: number): number {
		let n = 0;
		for (let i = 0; i < count; i++) {
			this.range >>>= 1;
			let bit = 0;
			if (this.code >= this.range) {
				this.code -= this.range;
				bit = 1;
			}
			n = n * 2 + bit;
			if (this.range < 0x1000000) {
				this.range = (this.range * 256) >>> 0;
				this.code = ((this.code * 256) >>> 0) + this.nextIn();
			}
		}
		return n;
	}

	private tree(probs: Uint16Array, offset: number, bits: number): number {
		let m = 1;
		for (let i = 0; i < bits; i++) m = (m << 1) | this.bit(probs, offset + m);
		return m - (1 << bits);
	}

	private reverseTree(probs: Uint16Array, offset: number, bits: number): number {
		let m = 1;
		let symbol = 0;
		for (let i = 0; i < bits; i++) {
			const b = this.bit(probs, offset + m);
			m = (m << 1) | b;
			symbol |= b << i;
		}
		return symbol;
	}

	private length(d: LenDecoder, posState: number): number {
		if (this.bit(d.choice, 0) === 0) return this.tree(d.low, posState << 3, 3);
		if (this.bit(d.choice, 1) === 0) return 8 + this.tree(d.mid, posState << 3, 3);
		return 16 + this.tree(d.high, 0, 8);
	}

	private distance(len: number): number {
		const slot = this.tree(this.posSlot, Math.min(len, 3) << 6, 6);
		if (slot < 4) return slot;
		const directBits = (slot >>> 1) - 1;
		const base = (2 | (slot & 1)) * 2 ** directBits;
		if (slot < END_POS_MODEL_INDEX) return base + this.reverseTree(this.specPos, base - slot, directBits);
		return (
			base +
			this.direct(directBits - ALIGN_BITS) * (1 << ALIGN_BITS) +
			this.reverseTree(this.align, 0, ALIGN_BITS)
		);
	}

	private chunk(input: Uint8Array, unpacked: number): void {
		this.input = input;
		this.inPos = 0;
		if (this.nextIn() !== 0) throw new XzError("LZMA: a range coder that does not start with 0");
		this.range = 0xffffffff;
		this.code = 0;
		for (let i = 0; i < 4; i++) this.code = ((this.code * 256) >>> 0) + this.nextIn();
		const out = this.out;
		const end = this.outPos + unpacked;
		if (end > out.length) throw new XzError("LZMA2: a chunk overruns the output");
		const pbMask = (1 << this.pb) - 1;
		const lpMask = (1 << this.lp) - 1;
		let pos = this.outPos;
		while (pos < end) {
			const posState = pos & pbMask;
			const state = this.state;
			if (this.bit(this.isMatch, (state << 4) | posState) === 0) {
				const prev = pos > this.dictStart ? (out[pos - 1] ?? 0) : 0;
				const base = 0x300 * (((pos & lpMask) << this.lc) + (prev >>> (8 - this.lc)));
				let symbol = 1;
				if (state < 7) {
					while (symbol < 0x100) symbol = (symbol << 1) | this.bit(this.literal, base + symbol);
				} else {
					let matchByte = out[pos - this.rep0 - 1] ?? 0;
					while (symbol < 0x100) {
						const matchBit = (matchByte >>> 7) & 1;
						matchByte <<= 1;
						const b = this.bit(this.literal, base + ((1 + matchBit) << 8) + symbol);
						symbol = (symbol << 1) | b;
						if (matchBit !== b) {
							while (symbol < 0x100) symbol = (symbol << 1) | this.bit(this.literal, base + symbol);
							break;
						}
					}
				}
				out[pos++] = symbol & 0xff;
				this.state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
				continue;
			}
			let len: number;
			if (this.bit(this.isRep, state) === 1) {
				if (pos === this.dictStart) throw new XzError("LZMA: a repeated match with an empty dictionary");
				if (this.bit(this.isRepG0, state) === 0) {
					if (this.bit(this.isRep0Long, (state << 4) | posState) === 0) {
						this.state = state < 7 ? 9 : 11;
						out[pos] = out[pos - this.rep0 - 1] ?? 0;
						pos++;
						continue;
					}
				} else {
					let dist: number;
					if (this.bit(this.isRepG1, state) === 0) dist = this.rep1;
					else {
						if (this.bit(this.isRepG2, state) === 0) dist = this.rep2;
						else {
							dist = this.rep3;
							this.rep3 = this.rep2;
						}
						this.rep2 = this.rep1;
					}
					this.rep1 = this.rep0;
					this.rep0 = dist;
				}
				len = this.length(this.repLen, posState);
				this.state = state < 7 ? 8 : 11;
			} else {
				this.rep3 = this.rep2;
				this.rep2 = this.rep1;
				this.rep1 = this.rep0;
				len = this.length(this.matchLen, posState);
				this.state = state < 7 ? 7 : 10;
				this.rep0 = this.distance(len);
			}
			const count = len + MATCH_LEN_MIN;
			const from = pos - this.rep0 - 1;
			if (from < this.dictStart)
				throw new XzError(`LZMA: a match ${this.rep0 + 1} back reaches before the dictionary`);
			if (pos + count > end) throw new XzError("LZMA: a match runs past its chunk");
			// Byte by byte: a match may overlap the bytes it writes.
			for (let i = 0; i < count; i++) out[pos + i] = out[from + i] ?? 0;
			pos += count;
		}
		if (this.code !== 0) throw new XzError("LZMA: a chunk's range coder does not finish clean");
		this.outPos = pos;
	}
}

function checkBlock(type: number, data: Uint8Array, stored: Uint8Array): void {
	if (type === CHECK_CRC32 && crc32(data) !== u32le(stored, 0))
		throw new XzError("a block's CRC-32 does not match");
	if (type === CHECK_CRC64) {
		let want = 0n;
		for (let i = 7; i >= 0; i--) want = (want << 8n) | BigInt(stored[i] ?? 0);
		if (crc64(data) !== want) throw new XzError("a block's CRC-64 does not match");
	}
}

/** One block header: LZMA2 must be its only filter. */
function blockHeader(src: Input, first: number): void {
	const start = src.pos - 1;
	const size = (first + 1) * 4;
	if (start + size > src.b.length) throw new XzError("a block header overruns the stream");
	if (crc32(src.b.subarray(start, start + size - 4)) !== u32le(src.b, start + size - 4))
		throw new XzError("a block header's CRC-32 does not match");
	const flags = src.byte();
	if ((flags & 0x03) !== 0)
		throw new XzError(`a block with ${(flags & 0x03) + 1} filters; only LZMA2 alone is supported`);
	if (flags & 0x40) src.varint();
	if (flags & 0x80) src.varint();
	const filter = src.varint();
	if (filter !== LZMA2_FILTER) throw new XzError(`filter ${filter.toString(16)}; only LZMA2 is supported`);
	if (src.varint() !== 1) throw new XzError("LZMA2's properties are not one byte");
	if (src.byte() > 40) throw new XzError("LZMA2's dictionary size is out of range");
	src.pos = start + size;
}

/** An .xz stream's blocks, which must come to exactly `size` bytes. */
export function decodeXz(data: Uint8Array, size: number): Uint8Array {
	if (MAGIC.some((m, i) => data[i] !== m)) throw new XzError("not an xz stream (no magic)");
	const flags = data.subarray(6, 8);
	if (crc32(flags) !== u32le(data, 8)) throw new XzError("the stream header's CRC-32 does not match");
	const check = flags[1] ?? 0;
	if (flags[0] !== 0 || check > 0x0f) throw new XzError("unsupported stream flags");
	const checkSize = CHECK_SIZES[check] ?? 0;
	const out = new Uint8Array(size);
	const src = new Input(data);
	src.pos = 12;
	let outPos = 0;
	for (let first = src.byte(); first !== 0; first = src.byte()) {
		blockHeader(src, first);
		const lzma = new Lzma2(out, outPos);
		lzma.decode(src);
		while (src.pos % 4 !== 0) if (src.byte() !== 0) throw new XzError("a block's padding is not zero");
		if (check !== CHECK_NONE)
			checkBlock(check, out.subarray(outPos, lzma.outPos), data.subarray(src.pos, src.pos + checkSize));
		src.pos += checkSize;
		outPos = lzma.outPos;
	}
	if (outPos !== size) throw new XzError(`decoded ${outPos} bytes, expected ${size}`);
	return out;
}
