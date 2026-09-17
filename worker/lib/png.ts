/**
 * Apple "CgBI" PNG normaliser.
 *
 * Status-bar carrier logos are stored in the -iphone-optimized PNG variant
 * Xcode's pngcrush produces: a private `CgBI` chunk precedes `IHDR`, the IDAT
 * payload is raw DEFLATE with no zlib wrapper, and the pixels are premultiplied
 * BGRA rather than RGBA. No browser will render that, so the bytes are turned
 * back into a standard PNG before they are served.
 */

import { inflateSync, zlibSync } from "fflate";

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let CRC_TABLE: Uint32Array | null = null;
function crc32(buf: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(b: Uint8Array): boolean {
  return b.length > 8 && SIG.every((v, i) => b[i] === v);
}

interface Chunk { type: string; data: Uint8Array }

function readChunks(b: Uint8Array): Chunk[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Chunk[] = [];
  let i = 8;
  while (i + 8 <= b.length) {
    const len = dv.getUint32(i);
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const start = i + 8;
    if (start + len > b.length) break;
    out.push({ type, data: b.subarray(start, start + len) });
    i = start + len + 4; // skip the CRC
    if (type === "IEND") break;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reverse the per-scanline PNG filters in place, returning the raw pixels. */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      const v = line[x];
      switch (filter) {
        case 0: cur[x] = v; break;
        case 1: cur[x] = (v + a) & 0xff; break;
        case 2: cur[x] = (v + b) & 0xff; break;
        case 3: cur[x] = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: cur[x] = (v + paeth(a, b, c)) & 0xff; break;
        default: cur[x] = v; break;
      }
    }
  }
  return out;
}

/**
 * Converts an Apple CgBI PNG to a standard one. Returns null when the input is
 * already a normal PNG, or when it is in a form this cannot handle, in which
 * case the caller should serve the original bytes unchanged.
 */
export function normalizeApplePng(b: Uint8Array): Uint8Array | null {
  if (!isPng(b)) return null;
  const chunks = readChunks(b);
  if (!chunks.some((c) => c.type === "CgBI")) return null;

  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr || ihdr.data.length < 13) return null;
  const hv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = hv.getUint32(0);
  const height = hv.getUint32(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  // Only the shape pngcrush actually emits for these logos.
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) return null;
  if (width === 0 || height === 0 || width * height > 16_000_000) return null;

  const idat = chunks.filter((c) => c.type === "IDAT");
  if (!idat.length) return null;
  let total = 0;
  for (const c of idat) total += c.data.length;
  const compressed = new Uint8Array(total);
  let at = 0;
  for (const c of idat) { compressed.set(c.data, at); at += c.data.length; }

  let raw: Uint8Array;
  try {
    // CgBI strips the two-byte zlib header, so this is bare DEFLATE.
    raw = inflateSync(compressed);
  } catch {
    return null;
  }
  const bpp = 4;
  if (raw.length < (width * bpp + 1) * height) return null;

  const pixels = unfilter(raw, width, height, bpp);

  // BGRA premultiplied -> RGBA straight.
  for (let i = 0; i < pixels.length; i += 4) {
    const blue = pixels[i], green = pixels[i + 1], red = pixels[i + 2], alpha = pixels[i + 3];
    if (alpha === 0) {
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
    } else if (alpha === 255) {
      pixels[i] = red; pixels[i + 1] = green; pixels[i + 2] = blue;
    } else {
      pixels[i] = Math.min(255, Math.round((red * 255) / alpha));
      pixels[i + 1] = Math.min(255, Math.round((green * 255) / alpha));
      pixels[i + 2] = Math.min(255, Math.round((blue * 255) / alpha));
    }
  }

  // Re-add a filter byte per scanline (None) and recompress with a zlib wrapper.
  const stride = width * bpp;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    filtered.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const newIhdr = new Uint8Array(13);
  const nv = new DataView(newIhdr.buffer);
  nv.setUint32(0, width);
  nv.setUint32(4, height);
  newIhdr[8] = 8;   // bit depth
  newIhdr[9] = 6;   // RGBA
  newIhdr[10] = 0;  // deflate
  newIhdr[11] = 0;  // adaptive filtering
  newIhdr[12] = 0;  // no interlace

  const parts = [
    new Uint8Array(SIG),
    chunk("IHDR", newIhdr),
    chunk("IDAT", zlibSync(filtered, { level: 6 })),
    chunk("IEND", new Uint8Array()),
  ];
  let size = 0;
  for (const p of parts) size += p.length;
  const out = new Uint8Array(size);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** Width and height of any PNG, walking past a CgBI chunk if present. */
export function pngDimensions(b: Uint8Array): { width: number; height: number } | null {
  if (!isPng(b)) return null;
  const ihdr = readChunks(b).find((c) => c.type === "IHDR");
  if (!ihdr || ihdr.data.length < 8) return null;
  const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  return { width: dv.getUint32(0), height: dv.getUint32(4) };
}

export function isCgBI(b: Uint8Array): boolean {
  return isPng(b) && readChunks(b).some((c) => c.type === "CgBI");
}
