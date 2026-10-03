/**
 * One zip member of a remote IPSW onto local disk: only its bytes are
 * downloaded, inflated on the way, and its size and CRC32 checked against the
 * zip directory before anything trusts the file. Modem packages run to 200 MB,
 * which is why this streams rather than buffering (RemoteZip.read would).
 */

import { createWriteStream } from "node:fs";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32, createInflateRaw } from "node:zlib";

import type { RemoteZip, ZipEntry } from "../../../../../../src/lib/firmware/index.ts";
import { streamRange } from "../range-stream.ts";

/** Counts and CRCs what passes through. */
class Check extends Transform {
  size = 0;
  crc = 0;
  override _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback): void {
    this.size += chunk.length;
    this.crc = crc32(chunk, this.crc);
    done(null, chunk);
  }
}

export async function fetchMember(zip: RemoteZip, url: string, entry: ZipEntry, dest: string): Promise<void> {
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`${entry.name}: zip method ${entry.method} is not stored or deflate`);
  const start = await zip.dataOffset(entry);
  const check = new Check();
  const body = Readable.from(streamRange(url, start, entry.compressedSize));
  if (entry.method === 8) await pipeline(body, createInflateRaw(), check, createWriteStream(dest));
  else await pipeline(body, check, createWriteStream(dest));
  if (check.size !== entry.size || check.crc >>> 0 !== entry.crc32 >>> 0) {
    throw new Error(`${entry.name}: got ${check.size} bytes crc ${check.crc.toString(16)}, expected ${entry.size} crc ${entry.crc32.toString(16)}`);
  }
}
