/** Bit- and byte-level helpers shared by the binary decoders. */

/** MSB-first bit reader over a byte array. */
export class BitReader {
  /** Current position in bits. */
  pos: number;
  constructor(readonly buf: Uint8Array, startBit = 0, readonly endBit = buf.length * 8) {
    this.pos = startBit;
  }

  get left(): number {
    return this.endBit - this.pos;
  }

  /** Reads `n` bits (n <= 32) as an unsigned integer. */
  u(n: number): number {
    if (n > 32) throw new Error(`cannot read ${n} bits at once`);
    if (this.pos + n > this.endBit) throw new Error(`read past end at bit ${this.pos}`);
    let v = 0;
    for (let i = 0; i < n; i++, this.pos++) {
      v = v * 2 + ((this.buf[this.pos >> 3] >> (7 - (this.pos & 7))) & 1);
    }
    return v;
  }

  flag(): boolean {
    return this.u(1) === 1;
  }

  /** Reads `n` bits as a hex string, left-aligned and zero-padded to whole nibbles. */
  hex(n: number): string {
    let s = "";
    for (let left = n; left > 0; left -= 4) {
      const take = Math.min(4, left);
      s += (this.u(take) << (4 - take)).toString(16);
    }
    return s;
  }

  skip(n: number): void {
    if (this.pos + n > this.endBit) throw new Error(`skip past end at bit ${this.pos}`);
    this.pos += n;
  }

  /** Skips to the next octet boundary. */
  align(): void {
    this.pos = Math.min(this.endBit, (this.pos + 7) & ~7);
  }
}

/** CRC-16/CCITT (poly 0x1021, init 0xFFFF), not reflected; `invert` gives the ones-complement form. */
export function crc16Ccitt(b: Uint8Array, invert = false): number {
  let crc = 0xffff;
  for (let i = 0; i < b.length; i++) {
    crc ^= b[i] << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return invert ? ~crc & 0xffff : crc;
}

/** Big-endian unsigned integer of any width, exact. */
export function beBigInt(b: Uint8Array): bigint {
  let v = 0n;
  for (let i = 0; i < b.length; i++) v = (v << 8n) | BigInt(b[i]);
  return v;
}

/** Little-endian unsigned integer of 1 to 8 bytes; undefined when empty, wider, or past 2^53. */
export function leUint(b: Uint8Array): number | undefined {
  if (!b.length || b.length > 8) return undefined;
  let v = 0n;
  for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Bytes as upper-case colon-separated hex, the way certificate tools print serials and digests. */
export function colonHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0").toUpperCase()).join(":");
}

/** SHA-1 as lower-case hex; synchronous so decoders can dedup content without WebCrypto. */ // FIPS 180-4 §6.1
export function sha1Hex(b: Uint8Array): string {
  const n = b.length;
  const words = new Uint32Array((((n + 8) >> 6) + 1) * 16);
  for (let i = 0; i < n; i++) words[i >> 2] |= b[i] << (24 - (i & 3) * 8);
  words[n >> 2] |= 0x80 << (24 - (n & 3) * 8);
  words[words.length - 1] = n * 8;
  words[words.length - 2] = Math.floor(n / 0x20000000);
  const w = new Uint32Array(80);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  for (let o = 0; o < words.length; o += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[o + t];
    for (let t = 16; t < 80; t++) { const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]; w[t] = (x << 1) | (x >>> 31); }
    let a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (bb & c) | (~bb & d) : t < 40 ? bb ^ c ^ d : t < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0;
      e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + bb) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
}
