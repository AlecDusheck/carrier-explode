/**
 * LZFSE decoder, whole-buffer: a port of Apple's reference decoder
 * (github.com/lzfse/lzfse, lzfse_decode_base.c, lzfse_fse.h, lzvn_decode_base.c),
 * using its 32-bit bit-stream variant so every value fits a JS number. AEA
 * archives compress each 1 MiB segment with it, and every iOS 18+ filesystem
 * image is such an archive.
 *
 * Handles the block kinds Apple's encoder writes: bvx2 (FSE, compressed
 * tables), bvxn (LZVN), bvx- (stored) and bvx$ (end). bvx1, the uncompressed-
 * table form, is not produced by any encoder still in use and is rejected.
 * Callers know the decoded size (AEA records it), and anything short of
 * exactly that size is an error.
 */

const MAGIC_END = 0x24787662; // bvx$
const MAGIC_RAW = 0x2d787662; // bvx-
const MAGIC_V1 = 0x31787662; // bvx1
const MAGIC_V2 = 0x32787662; // bvx2
const MAGIC_LZVN = 0x6e787662; // bvxn

const L_SYMBOLS = 20;
const M_SYMBOLS = 20;
const D_SYMBOLS = 64;
const LITERAL_SYMBOLS = 256;
const L_STATES = 64;
const M_STATES = 64;
const D_STATES = 256;
const LITERAL_STATES = 1024;
const MATCHES_PER_BLOCK = 10000;
const LITERALS_PER_BLOCK = 4 * MATCHES_PER_BLOCK;

const L_EXTRA_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 5, 8] as const;
const L_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 28, 60] as const;
const M_EXTRA_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 5, 8, 11] as const;
const M_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 24, 56, 312] as const;
const D_EXTRA_BITS = [
  0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7,
  8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12, 13, 13, 13, 13, 14, 14, 14, 14, 15, 15, 15, 15,
] as const;
const D_BASE = [
  0, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 36, 44, 52, 60, 76, 92, 108, 124, 156, 188, 220, 252, 316, 380, 444,
  508, 636, 764, 892, 1020, 1276, 1532, 1788, 2044, 2556, 3068, 3580, 4092, 5116, 6140, 7164, 8188, 10236, 12284,
  14332, 16380, 20476, 24572, 28668, 32764, 40956, 49148, 57340, 65532, 81916, 98300, 114684, 131068, 163836,
  196604, 229372,
] as const;

/** Bits and value of each 5-bit prefix of a packed frequency (lzfse_decode_v1_freq_value). */
const FREQ_NBITS = [2, 3, 2, 5, 2, 3, 2, 8, 2, 3, 2, 5, 2, 3, 2, 14, 2, 3, 2, 5, 2, 3, 2, 8, 2, 3, 2, 5, 2, 3, 2, 14] as const;
const FREQ_VALUE = [0, 2, 1, 4, 0, 3, 1, -1, 0, 2, 1, 5, 0, 3, 1, -1, 0, 2, 1, 6, 0, 3, 1, -1, 0, 2, 1, 7, 0, 3, 1, -1] as const;

export class LzfseError extends Error {
  override name = "LzfseError";
}

const fail = (why: string): never => {
  throw new LzfseError(why);
};

const at = (b: Uint8Array, i: number): number => b[i] ?? fail(`read past the end at ${i}`);
const u16 = (b: Uint8Array, i: number): number => at(b, i) | (at(b, i + 1) << 8);
const u32 = (b: Uint8Array, i: number): number => (u16(b, i) | (u16(b, i + 2) << 16)) >>> 0;
/** Bytes past the end read as zero: the bit reader loads whole words near the stream's edges and masks them. */
const u32Loose = (b: Uint8Array, i: number): number =>
  ((b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24)) >>> 0;
/** Low-bit masks, indexed by width: a table, because the bit reader masks on every pull. */
const MASKS = Uint32Array.from({ length: 33 }, (_, n) => (n >= 32 ? 0xffffffff : 2 ** n - 1));
const mask = (n: number): number => MASKS[n] ?? 0xffffffff;

/** The reference decoder's backwards bit reader, 32-bit flavour: 24..31 bits buffered after each flush. */
class BitIn {
  accum = 0;
  bits = 0;
  constructor(private readonly src: Uint8Array, public pos: number, private readonly start: number, n: number) {
    if (n !== 0) {
      if (pos < start + 4) fail("bit stream shorter than its first word");
      this.pos -= 4;
      this.accum = u32(src, this.pos);
      this.bits = n + 32;
    } else {
      if (pos < start + 3) fail("bit stream shorter than its first word");
      this.pos -= 3;
      this.accum = u32Loose(src, this.pos) & 0xffffff;
      this.bits = 24;
    }
    if (this.bits < 24 || this.bits >= 32 || this.accum >>> this.bits !== 0) fail("bad bit stream header");
  }

  flush(): void {
    const n = (31 - this.bits) & -8;
    if (n <= 0) return;
    const pos = this.pos - (n >> 3);
    if (pos < this.start) fail("bit stream underflow");
    this.pos = pos;
    let incoming = 0;
    for (let k = 0; k < n >> 3; k++) incoming |= (this.src[pos + k] ?? 0) << (8 * k);
    this.accum = ((this.accum << n) | incoming) >>> 0;
    this.bits += n;
  }

  pull(n: number): number {
    this.bits -= n;
    const out = this.accum >>> this.bits;
    this.accum = (this.accum & mask(this.bits)) >>> 0;
    return out;
  }
}

/** Index of the highest set bit's complement, as __builtin_clz for 32-bit values. */
const clz = (x: number): number => Math.clz32(x);

/** Literal decoder: per state, k | symbol << 8 | delta << 16 (fse_init_decoder_table). */
function literalTable(freq: Uint16Array): Int32Array {
  const t = new Int32Array(LITERAL_STATES);
  const nClz = clz(LITERAL_STATES);
  let i = 0;
  let sum = 0;
  for (let s = 0; s < LITERAL_SYMBOLS; s++) {
    const f = freq[s] ?? 0;
    if (f === 0) continue;
    sum += f;
    if (sum > LITERAL_STATES) fail("literal frequencies exceed the state count");
    const k = clz(f) - nClz;
    const j0 = ((2 * LITERAL_STATES) >> k) - f;
    for (let j = 0; j < f; j++, i++) {
      t[i] = j < j0 ? k | (s << 8) | ((((f + j) << k) - LITERAL_STATES) << 16) : (k - 1) | (s << 8) | (((j - j0) << (k - 1)) << 16);
    }
  }
  return t;
}

/** L, M and D decoders: per state, the bits to pull, how many are value bits, next-state base and value base. */
interface ValueTable {
  readonly total: Uint8Array;
  readonly vbits: Uint8Array;
  readonly delta: Int32Array;
  readonly vbase: Int32Array;
}

function valueTable(states: number, freq: Uint16Array, extra: readonly number[], base: readonly number[]): ValueTable {
  const t = { total: new Uint8Array(states), vbits: new Uint8Array(states), delta: new Int32Array(states), vbase: new Int32Array(states) };
  const nClz = clz(states);
  let i = 0;
  let sum = 0;
  freq.forEach((f, s) => {
    if (f === 0) return;
    sum += f;
    if (sum > states) fail("value frequencies exceed the state count");
    const k = clz(f) - nClz;
    const j0 = ((2 * states) >> k) - f;
    const vb = extra[s] ?? 0;
    for (let j = 0; j < f; j++, i++) {
      t.vbits[i] = vb;
      t.vbase[i] = base[s] ?? 0;
      t.total[i] = (j < j0 ? k : k - 1) + vb;
      t.delta[i] = j < j0 ? ((f + j) << k) - states : (j - j0) << (k - 1);
    }
  });
  return t;
}

/** Decodes one value in state `s`; returns it and leaves the next state in `next[0]`. */
function valueDecode(t: ValueTable, s: number, in_: BitIn, next: Int32Array): number {
  const bits = in_.pull(t.total[s] ?? 0);
  const vb = t.vbits[s] ?? 0;
  next[0] = ((t.delta[s] ?? 0) + (bits >>> vb)) & 0xffff;
  return (t.vbase[s] ?? 0) + (bits & mask(vb));
}

/** A bvx2 header with its frequency tables unpacked. */
interface V2Header {
  readonly size: number;
  readonly nLiterals: number;
  readonly nLiteralPayload: number;
  readonly nMatches: number;
  readonly literalBits: number;
  readonly literalState: readonly [number, number, number, number];
  readonly nLmdPayload: number;
  readonly lmdBits: number;
  readonly lState: number;
  readonly mState: number;
  readonly dState: number;
  readonly lFreq: Uint16Array;
  readonly mFreq: Uint16Array;
  readonly dFreq: Uint16Array;
  readonly literalFreq: Uint16Array;
}

function u64(b: Uint8Array, i: number): bigint {
  return BigInt(u32(b, i)) | (BigInt(u32(b, i + 4)) << 32n);
}
const field = (v: bigint, offset: number, nbits: number): number => Number((v >> BigInt(offset)) & ((1n << BigInt(nbits)) - 1n));

function v2Header(src: Uint8Array, p: number): V2Header {
  const v0 = u64(src, p + 8);
  const v1 = u64(src, p + 16);
  const v2 = u64(src, p + 24);
  const size = field(v2, 0, 32);
  const freqs = new Uint16Array(L_SYMBOLS + M_SYMBOLS + D_SYMBOLS + LITERAL_SYMBOLS);
  const end = p + size;
  let q = p + 32;
  if (q !== end) {
    let accum = 0;
    let nbits = 0;
    for (let i = 0; i < freqs.length; i++) {
      while (q < end && nbits + 8 <= 32) {
        accum = (accum | (at(src, q) << nbits)) >>> 0;
        nbits += 8;
        q++;
      }
      const low = accum & 31;
      const n = FREQ_NBITS[low] ?? 2;
      if (n > nbits) fail("frequency table truncated");
      freqs[i] = n === 8 ? 8 + ((accum >>> 4) & 0xf) : n === 14 ? 24 + ((accum >>> 4) & 0x3ff) : (FREQ_VALUE[low] ?? 0);
      accum >>>= n;
      nbits -= n;
    }
    if (nbits >= 8 || q !== end) fail("frequency table does not end at the header's end");
  }
  let o = 0;
  const take = (n: number): Uint16Array => freqs.subarray(o, (o += n));
  return {
    size,
    nLiterals: field(v0, 0, 20),
    nLiteralPayload: field(v0, 20, 20),
    nMatches: field(v0, 40, 20),
    literalBits: field(v0, 60, 3) - 7,
    literalState: [field(v1, 0, 10), field(v1, 10, 10), field(v1, 20, 10), field(v1, 30, 10)],
    nLmdPayload: field(v1, 40, 20),
    lmdBits: field(v1, 60, 3) - 7,
    lState: field(v2, 32, 10),
    mState: field(v2, 42, 10),
    dState: field(v2, 52, 10),
    lFreq: take(L_SYMBOLS),
    mFreq: take(M_SYMBOLS),
    dFreq: take(D_SYMBOLS),
    literalFreq: take(LITERAL_SYMBOLS),
  };
}

const sumOf = (f: Uint16Array): number => f.reduce((a, b) => a + b, 0);

function checkV2(h: V2Header): void {
  if (h.nLiterals > LITERALS_PER_BLOCK || h.nMatches > MATCHES_PER_BLOCK) fail("block too large");
  if (h.literalState.some((s) => s >= LITERAL_STATES)) fail("literal state out of range");
  if (h.lState >= L_STATES || h.mState >= M_STATES || h.dState >= D_STATES) fail("L/M/D state out of range");
  if (sumOf(h.lFreq) > L_STATES || sumOf(h.mFreq) > M_STATES || sumOf(h.dFreq) > D_STATES || sumOf(h.literalFreq) > LITERAL_STATES) {
    fail("frequencies exceed the state count");
  }
}

/** Below this many bytes a loop beats a typed-array call. */
const SHORT = 32;

/** Copies a match byte by byte when source and destination overlap: that overlap is how LZ repeats a run. */
function copyMatch(dst: Uint8Array, pos: number, d: number, m: number): void {
  if (d >= m && m > SHORT) dst.copyWithin(pos, pos - d, pos - d + m);
  else for (let i = 0; i < m; i++) dst[pos + i] = dst[pos + i - d] ?? 0;
}

/** Copies `n` bytes; short runs, the common case, by hand, since a subarray per run costs more than the copy. */
function copyBytes(dst: Uint8Array, pos: number, src: Uint8Array, from: number, n: number): void {
  if (n > SHORT) dst.set(src.subarray(from, from + n), pos);
  else for (let i = 0; i < n; i++) dst[pos + i] = src[from + i] ?? 0;
}

/**
 * The block's literals: four interleaved FSE states, as the encoder wrote them,
 * with a flush every two symbols. The hottest loop of the decoder, so the four
 * states live in locals and the table lookups are written out.
 */
function decodeLiterals(lt: Int32Array, h: V2Header, lin: BitIn, out: Uint8Array): void {
  let [s0, s1, s2, s3] = h.literalState;
  let e = 0;
  for (let i = 0; i < h.nLiterals; i += 4) {
    lin.flush();
    e = lt[s0] ?? 0;
    s0 = ((e >> 16) + lin.pull(e & 0xff)) & 0xffff;
    out[i] = (e >>> 8) & 0xff;
    e = lt[s1] ?? 0;
    s1 = ((e >> 16) + lin.pull(e & 0xff)) & 0xffff;
    out[i + 1] = (e >>> 8) & 0xff;
    lin.flush();
    e = lt[s2] ?? 0;
    s2 = ((e >> 16) + lin.pull(e & 0xff)) & 0xffff;
    out[i + 2] = (e >>> 8) & 0xff;
    e = lt[s3] ?? 0;
    s3 = ((e >> 16) + lin.pull(e & 0xff)) & 0xffff;
    out[i + 3] = (e >>> 8) & 0xff;
  }
}

/** One bvx2 block at `p`; returns where the next block starts and the new output position. */
function v2Block(src: Uint8Array, p: number, dst: Uint8Array, pos: number): { p: number; pos: number } {
  const h = v2Header(src, p);
  checkV2(h);
  const litStart = p + h.size;
  const lmdStart = litStart + h.nLiteralPayload;
  const end = lmdStart + h.nLmdPayload;
  if (end > src.length) fail("block payload truncated");

  const literals = new Uint8Array(LITERALS_PER_BLOCK + 64);
  const lt = literalTable(h.literalFreq);
  const lin = new BitIn(src, lmdStart, 0, h.literalBits);
  decodeLiterals(lt, h, lin, literals);

  const lTab = valueTable(L_STATES, h.lFreq, L_EXTRA_BITS, L_BASE);
  const mTab = valueTable(M_STATES, h.mFreq, M_EXTRA_BITS, M_BASE);
  const dTab = valueTable(D_STATES, h.dFreq, D_EXTRA_BITS, D_BASE);
  const lmd = new BitIn(src, end, lmdStart, h.lmdBits);
  const next = new Int32Array(1);
  let ls = h.lState;
  let ms = h.mState;
  let ds = h.dState;
  let lit = 0;
  let d = -1;
  for (let n = 0; n < h.nMatches; n++) {
    lmd.flush();
    const l = valueDecode(lTab, ls, lmd, next);
    ls = next[0] ?? 0;
    if (lit + l >= LITERALS_PER_BLOCK + 64) fail("literal run past the block's literals");
    lmd.flush();
    const m = valueDecode(mTab, ms, lmd, next);
    ms = next[0] ?? 0;
    lmd.flush();
    const nd = valueDecode(dTab, ds, lmd, next);
    ds = next[0] ?? 0;
    d = nd !== 0 ? nd : d;
    if (d < 0 || d > pos + l) fail("match distance before the start of the output");
    if (pos + l + m > dst.length) fail("block decodes past the expected size");
    copyBytes(dst, pos, literals, lit, l);
    pos += l;
    lit += l;
    copyMatch(dst, pos, d, m);
    pos += m;
  }
  return { p: end, pos };
}

/** One bvxn (LZVN) block's payload, src[p, end), into dst from pos; returns the output position. */
function lzvnBlock(src: Uint8Array, p: number, end: number, dst: Uint8Array, pos: number, limit: number): number {
  let d = 0;
  const literal = (from: number, l: number): void => {
    if (from + l > end || pos + l > limit) fail("LZVN literal overruns its block");
    copyBytes(dst, pos, src, from, l);
    pos += l;
  };
  const match = (m: number): void => {
    if (d === 0 || d > pos) fail("LZVN match distance out of range");
    if (pos + m > limit) fail("LZVN match overruns its block");
    copyMatch(dst, pos, d, m);
    pos += m;
  };
  for (;;) {
    if (p >= end) fail("LZVN block ends without an end-of-stream op");
    const op = at(src, p);
    const lo = op & 7;
    if (op === 0x06) {
      if (p + 8 > end) fail("LZVN end-of-stream truncated");
      return pos;
    }
    if (op === 0x0e || op === 0x16) {
      p += 1;
    } else if (op === 0xe0 || (op > 0xe0 && op < 0xf0)) {
      const [len, l] = op === 0xe0 ? [2, at(src, p + 1) + 16] : [1, op & 15];
      literal(p + len, l);
      p += len + l;
    } else if (op === 0xf0 || op > 0xf0) {
      const [len, m] = op === 0xf0 ? [2, at(src, p + 1) + 16] : [1, op & 15];
      p += len;
      match(m);
    } else if (op >= 0xa0 && op < 0xc0) {
      const w = u16(src, p + 1);
      const l = (op >> 3) & 3;
      literal(p + 3, l);
      p += 3 + l;
      d = w >> 2;
      match((((op & 7) << 2) | (w & 3)) + 3);
    } else if ((op >= 0x70 && op < 0x80) || (op >= 0xd0 && op < 0xe0) || (lo === 6 && op < 0x46)) {
      fail(`undefined LZVN op 0x${op.toString(16)}`);
    } else {
      const l = op >> 6;
      const m = ((op >> 3) & 7) + 3;
      const len = lo === 7 ? 3 : lo === 6 ? 1 : 2;
      literal(p + len, l);
      const dAt = p + 1;
      p += len + l;
      if (lo === 7) d = u16(src, dAt);
      else if (lo !== 6) d = (lo << 8) | at(src, dAt);
      match(m);
    }
  }
}

/** Decodes a whole LZFSE stream that must expand to exactly `size` bytes. */
export function lzfseDecode(src: Uint8Array, size: number): Uint8Array {
  const dst = new Uint8Array(size);
  let p = 0;
  let pos = 0;
  for (;;) {
    const magic = u32(src, p);
    if (magic === MAGIC_END) break;
    if (magic === MAGIC_RAW) {
      const n = u32(src, p + 4);
      if (p + 8 + n > src.length || pos + n > size) fail("stored block overruns");
      dst.set(src.subarray(p + 8, p + 8 + n), pos);
      pos += n;
      p += 8 + n;
    } else if (magic === MAGIC_LZVN) {
      const raw = u32(src, p + 4);
      const payload = u32(src, p + 8);
      const start = p + 12;
      const out = lzvnBlock(src, start, start + payload, dst, pos, Math.min(size, pos + raw));
      if (out !== pos + raw) fail(`LZVN block decoded ${out - pos} of ${raw} bytes`);
      pos = out;
      p = start + payload;
    } else if (magic === MAGIC_V2) {
      ({ p, pos } = v2Block(src, p, dst, pos));
    } else if (magic === MAGIC_V1) {
      fail("bvx1 blocks (uncompressed tables) are not supported");
    } else {
      fail(`unknown block magic 0x${magic.toString(16)} at ${p}`);
    }
  }
  if (pos !== size) fail(`decoded ${pos} bytes, expected ${size}`);
  return dst;
}
