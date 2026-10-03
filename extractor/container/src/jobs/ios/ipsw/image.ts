/** The IPSW's root filesystem image onto disk: streamed by Range, decrypted on the way when it is a .dmg.aea. */

import { open, statfs } from "node:fs/promises";
import { join } from "node:path";

import type { RemoteZip } from "../../../../../../src/lib/firmware/index.ts";
import { fetchRange, fetchWithRetry } from "../../../../../../src/lib/http/index.ts";
import { streamRange } from "../range-stream.ts";
import { osImagePath, type BuildManifest } from "../shared/build-manifest.ts";
import { aeaMetadata, archiveKey, decryptAea, parseAeaHeader } from "./aea.ts";

/** Kept free beyond the image, for the extracted bundles. */
const MARGIN = 2 * 1024 ** 3;
/** Covers Apple's AEA headers (2.1 KB of auth data on iOS 27); a longer one is fetched again whole. */
const HEADER_PROBE = 64 * 1024;
const REPORT_EVERY = 256 * 1024 ** 2;

export interface Reporter {
  progress(done: number, total: number, note?: string): Promise<void>;
}

/** Throws unless an image of `size` fits, against the space free before writing starts. */
async function roomFor(dir: string): Promise<(size: number) => void> {
  const fs = await statfs(dir);
  const free = fs.bavail * fs.bsize;
  return (size) => {
    if (size + MARGIN > free) throw new Error(`a ${size}-byte image does not fit in ${free} free bytes with a ${MARGIN}-byte margin`);
  };
}

async function fetchPem(url: string): Promise<string> {
  const pem = await (await fetchWithRetry(url)).text();
  if (!pem.includes("-----BEGIN")) throw new Error(`${url} did not return a PEM key`);
  return pem;
}

async function aeaKey(url: string, start: number, size: number): Promise<Uint8Array> {
  let head = await fetchRange(url, start, start + Math.min(HEADER_PROBE, size) - 1);
  const want = 12 + new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(8, true);
  if (want > head.length) head = await fetchRange(url, start, start + want - 1);
  return archiveKey(aeaMetadata(parseAeaHeader(head).authData), fetchPem);
}

/** Returns the image's path in `dir`. */
export async function downloadOsImage(zip: RemoteZip, url: string, manifest: BuildManifest, dir: string, r: Reporter): Promise<string> {
  const member = osImagePath(manifest);
  const entry = zip.entry(member);
  if (!entry) throw new Error(`BuildManifest names ${member}, which ${url} does not have`);
  if (entry.method !== 0) throw new Error(`${member} is compressed (method ${entry.method}); filesystem images are stored`);
  const start = await zip.dataOffset(entry);
  const fits = await roomFor(dir);
  const path = join(dir, "os.img");
  const file = await open(path, "w");
  let written = 0;
  let reported = 0;
  const sink = async (b: Uint8Array, total: number): Promise<void> => {
    for (let at = 0; at < b.length; ) at += (await file.write(b, at)).bytesWritten;
    written += b.length;
    if (written - reported < REPORT_EVERY && written < total) return;
    reported = written;
    await r.progress(written, total, member);
  };
  try {
    const body = streamRange(url, start, entry.compressedSize);
    if (member.endsWith(".aea")) {
      let total = 0;
      await decryptAea(body, await aeaKey(url, start, entry.compressedSize), {
        onSize: (n) => {
          fits(n);
          total = n;
        },
        sink: (b) => sink(b, total),
      });
    } else {
      fits(entry.size);
      for await (const chunk of body) await sink(chunk, entry.size);
    }
  } finally {
    await file.close();
  }
  return path;
}
