/**
 * The decompressors payload.bin operations need, for src/lib/firmware's
 * injectable Decompressors. They live here, not in firmware, so the site
 * (which imports firmware for zips) never bundles them.
 *
 *   REPLACE_XZ    xz-decompress (xz-embedded compiled to WASM)
 *   REPLACE_BZ    seek-bzip (pure JS)
 *   REPLACE_ZSTD  fzstd (pure JS)
 */

import { decompress as zstdDecompress } from "fzstd";
import Bunzip from "seek-bzip";
import * as xzModule from "xz-decompress";

import type { Decompressors } from "../../../../src/lib/firmware/index.ts";

type XzStreamClass = typeof xzModule.XzReadableStream;

/**
 * xz-decompress is a webpack UMD bundle: bundlers (esbuild) see its named
 * export, but Node's own ESM loader cannot detect it and exposes the bundle
 * only as `default`. Either way the class is checked before use.
 */
function xzStreamClass(): XzStreamClass {
  if (typeof xzModule.XzReadableStream === "function") return xzModule.XzReadableStream;
  const bundle: unknown = Reflect.get(xzModule, "default");
  const ctor: unknown = typeof bundle === "object" && bundle !== null ? Reflect.get(bundle, "XzReadableStream") : undefined;
  if (typeof ctor !== "function") throw new Error("xz-decompress exports no XzReadableStream");
  // Checked above to be the package's own export; its type is the one the package declares.
  return ctor as XzStreamClass;
}

async function xz(data: Uint8Array): Promise<Uint8Array> {
  const XzReadableStream = xzStreamClass();
  const input = new Blob([new Uint8Array(data)]).stream();
  return new Uint8Array(await new Response(new XzReadableStream(input)).arrayBuffer());
}

/** The output size is known up front, so seek-bzip writes into one preallocated buffer. */
function bz2(data: Uint8Array, size: number): Uint8Array {
  const out = Bunzip.decode(data, new Uint8Array(size));
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

function zstd(data: Uint8Array, size: number): Uint8Array {
  return zstdDecompress(data, new Uint8Array(size));
}

export const payloadCodecs: Decompressors = { xz, bz2, zstd };
