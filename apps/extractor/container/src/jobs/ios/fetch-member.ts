/** One remote zip member streamed to a file, inflated if deflated, its size and CRC-32 checked. */

import { createWriteStream } from "node:fs";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32, createInflateRaw } from "node:zlib";

import type { RemoteZip, ZipEntry } from "@carrier-explode/firmware";
import { streamRange } from "@carrier-explode/http";

class Check extends Transform {
  #size = 0;
  #crc = 0;
  override _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback): void {
    this.#size += chunk.length;
    this.#crc = crc32(chunk, this.#crc);
    done(null, chunk);
  }
  verify(entry: ZipEntry): void {
    if (this.#size !== entry.size || this.#crc >>> 0 !== entry.crc32 >>> 0) {
      throw new Error(`${entry.name}: got ${this.#size} bytes crc ${this.#crc.toString(16)}, expected ${entry.size} crc ${entry.crc32.toString(16)}`);
    }
  }
}

export async function fetchMember(zip: RemoteZip, url: string, entry: ZipEntry, dest: string): Promise<void> {
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`${entry.name}: zip method ${entry.method} is not stored or deflate`);
  const body = Readable.from(streamRange(url, await zip.dataOffset(entry), entry.compressedSize));
  const check = new Check();
  if (entry.method === 8) await pipeline(body, createInflateRaw(), check, createWriteStream(dest));
  else await pipeline(body, check, createWriteStream(dest));
  check.verify(entry);
}
