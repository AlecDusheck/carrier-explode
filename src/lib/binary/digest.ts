/** sha256 via WebCrypto (Node and Workers); SHA-1 synchronous so decoders can dedup without awaiting. */

import { bytesToHex } from "./text.ts";

/** Lower-case hex SHA-256. */
export async function sha256Hex(b: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(b))));
}

/** WebCrypto wants an ArrayBuffer-backed view; a SharedArrayBuffer-backed one is copied. */
function toArrayBuffer(b: Uint8Array): Uint8Array<ArrayBuffer> {
  return b.buffer instanceof ArrayBuffer ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b);
}

/** SHA-1 as lower-case hex (FIPS 180-4 §6.1). */
export function sha1Hex(b: Uint8Array): string {
  const n = b.length;
  const words = new Uint32Array((((n + 8) >> 6) + 1) * 16);
  b.forEach((x, i) => {
    words[i >> 2] = (words[i >> 2] ?? 0) | (x << (24 - (i & 3) * 8));
  });
  words[n >> 2] = (words[n >> 2] ?? 0) | (0x80 << (24 - (n & 3) * 8));
  words[words.length - 1] = n * 8;
  words[words.length - 2] = Math.floor(n / 0x20000000);
  const w = new Uint32Array(80);
  const h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  const wt = (t: number): number => w[t] ?? 0;
  for (let o = 0; o < words.length; o += 16) {
    w.set(words.subarray(o, o + 16));
    for (let t = 16; t < 80; t++) {
      const x = wt(t - 3) ^ wt(t - 8) ^ wt(t - 14) ^ wt(t - 16);
      w[t] = (x << 1) | (x >>> 31);
    }
    let [a, bb, c, d, e] = [h[0] ?? 0, h[1] ?? 0, h[2] ?? 0, h[3] ?? 0, h[4] ?? 0];
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (bb & c) | (~bb & d) : t < 40 ? bb ^ c ^ d : t < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + wt(t)) >>> 0;
      e = d;
      d = c;
      c = (bb << 30) | (bb >>> 2);
      bb = a;
      a = tmp;
    }
    // Uint32Array stores mod 2^32, which is exactly SHA-1's addition.
    h[0] = (h[0] ?? 0) + a;
    h[1] = (h[1] ?? 0) + bb;
    h[2] = (h[2] ?? 0) + c;
    h[3] = (h[3] ?? 0) + d;
    h[4] = (h[4] ?? 0) + e;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}
