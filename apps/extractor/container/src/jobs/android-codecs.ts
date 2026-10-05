/** payload.bin decompressors (xz-decompress, seek-bzip, fzstd), injected into firmware. */

import { decompress as zstdDecompress } from "fzstd";
import Bunzip from "seek-bzip";
import * as xzModule from "xz-decompress";

import type { Decompressors } from "@carrier-explode/firmware";

type XzStreamClass = typeof xzModule.XzReadableStream;

/** Node ESM sees this UMD bundle only as `default`; bundlers see the named export. */
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
