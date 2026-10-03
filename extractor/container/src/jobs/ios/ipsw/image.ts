/**
 * The IPSW's root filesystem image, onto local disk and nothing more: the
 * member's bytes go by Range request straight from Apple's CDN, through AEA
 * decryption when the member is a .dmg.aea, into one file. Neither the IPSW
 * nor the encrypted member is ever stored.
 *
 * Disk budget on the heavy container (20 GB, the container image included),
 * measured on iOS 27.0.1 for iPhone17,1 (IPSW 12.3 GB):
 *
 *   OS member 043-70165-666.dmg.aea      8.86 GB   streamed, never on disk
 *   plain image (raw APFS container)    10.24 GB   on disk until the bundles are out
 *   both bundle directories              0.05 GB   on disk; packaged in memory, one bundle at a time
 *
 * so the peak is ~10.3 GB. The image size is known from the AEA root header
 * before a byte is written, and checked against free space with MARGIN to spare.
 * Before iOS 18 the member is a plain UDIF .dmg, streamed as is.
 */

import { open, statfs } from "node:fs/promises";
import { join } from "node:path";

import type { RemoteZip } from "../../../../../../src/lib/firmware/index.ts";
import { fetchRange, fetchWithRetry } from "../../../../../../src/lib/http/index.ts";
import { streamRange } from "../range-stream.ts";
import { osImagePath, type BuildManifest } from "../shared/build-manifest.ts";
import { aeaMetadata, archiveKey, decryptAea, parseAeaHeader } from "./aea.ts";

/** Room kept free beyond the image itself: extracted bundles, packaging, logs. */
const MARGIN = 2 * 1024 ** 3;
/** Enough for any AEA header seen (2.1 KB of auth data on iOS 27); more is read if it says so. */
const HEADER_PROBE = 64 * 1024;
const REPORT_EVERY = 256 * 1024 ** 2;

export interface Reporter {
  log(message: string): void;
  progress(done: number, total: number, note?: string): Promise<void>;
}

export interface OsImage {
  readonly path: string;
  readonly size: number;
  /** The IPSW member it came from: `043-70165-666.dmg.aea`. */
  readonly member: string;
}

/** A check that an image of some size fits, against the space free now (taken once, before writing). */
async function roomFor(dir: string): Promise<(size: number) => void> {
  const fs = await statfs(dir);
  const free = fs.bavail * fs.bsize;
  return (size) => {
    if (size + MARGIN > free) {
      throw new Error(`filesystem image is ${(size / 1e9).toFixed(2)} GB; ${(free / 1e9).toFixed(2)} GB free is not enough with a ${MARGIN / 1e9} GB margin`);
    }
  };
}

async function fetchPem(url: string): Promise<string> {
  const pem = await (await fetchWithRetry(url)).text();
  if (!pem.includes("-----BEGIN")) throw new Error(`${url} did not return a PEM key`);
  return pem;
}

/** The archive key, from the member's AEA header (its first few KB). */
async function aeaKey(url: string, start: number, size: number): Promise<Uint8Array> {
  let head = await fetchRange(url, start, start + Math.min(HEADER_PROBE, size) - 1);
  const want = 12 + new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(8, true);
  if (want > head.length) head = await fetchRange(url, start, start + want - 1);
  return archiveKey(aeaMetadata(parseAeaHeader(head).authData), fetchPem);
}

export async function downloadOsImage(zip: RemoteZip, url: string, manifest: BuildManifest, dir: string, r: Reporter): Promise<OsImage> {
  const member = osImagePath(manifest);
  const entry = zip.entry(member);
  if (!entry) throw new Error(`BuildManifest names ${member}, which the IPSW does not have`);
  if (entry.method !== 0) throw new Error(`${member} is compressed (method ${entry.method}); filesystem images are stored`);
  const start = await zip.dataOffset(entry);
  const path = join(dir, "os.img");
  const file = await open(path, "w");
  let reported = 0;
  const report = async (done: number, total: number): Promise<void> => {
    if (done - reported < REPORT_EVERY && done < total) return;
    reported = done;
    await r.progress(done, total, `${member}: ${(done / 1e9).toFixed(1)} of ${(total / 1e9).toFixed(1)} GB`);
  };
  const sink = async (b: Uint8Array): Promise<void> => {
    for (let at = 0; at < b.length; ) at += (await file.write(b, at)).bytesWritten;
  };
  try {
    const fits = await roomFor(dir);
    const body = streamRange(url, start, entry.compressedSize);
    let size = 0;
    if (member.endsWith(".aea")) {
      const key = await aeaKey(url, start, entry.compressedSize);
      r.log(`${member}: ${(entry.compressedSize / 1e9).toFixed(2)} GB encrypted, key from its fcs-key URL`);
      let total = 0;
      await decryptAea(body, key, {
        onSize: (n) => {
          fits(n);
          total = n;
        },
        sink: async (b) => {
          await sink(b);
          size += b.length;
          await report(size, total);
        },
      });
    } else {
      fits(entry.size);
      for await (const chunk of body) {
        await sink(chunk);
        size += chunk.length;
        await report(size, entry.size);
      }
    }
    return { path, size, member };
  } finally {
    await file.close();
  }
}
