/** The IPSW's root filesystem image onto disk: streamed by Range, decrypted on the way when it is a .dmg.aea. */

import { createWriteStream } from "node:fs";
import { statfs } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import { fcsKey, openAea, type PlainStream, type RemoteZip } from "@carrier-explode/firmware";
import type { JobContext } from "../../../job.ts";
import { fetchMember } from "../fetch-member.ts";
import { fetchApple, streamRange } from "@carrier-explode/http";
import { osImagePath, type BuildManifest } from "@carrier-explode/decode-ios";

/** Left free beyond the image, for the bundle directories copied out of it. */
const MARGIN = 2 * 1024 ** 3;

const fetchPem = async (url: string): Promise<string> => new TextDecoder().decode(await fetchApple(url));

async function assertRoom(dir: string, size: number): Promise<void> {
  const fs = await statfs(dir);
  const free = fs.bavail * fs.bsize;
  if (size + MARGIN > free) throw new Error(`a ${size}-byte image does not fit in ${free} free bytes with a ${MARGIN}-byte margin`);
}

async function* reporting(s: PlainStream, note: string, r: Pick<JobContext, "progress">): AsyncGenerator<Uint8Array> {
  let done = 0;
  for await (const chunk of s.chunks) {
    yield chunk;
    done += chunk.length;
    await r.progress(done, s.size, note);
  }
}

/** The image's path in `dir`. */
export async function downloadOsImage(zip: RemoteZip, url: string, manifest: BuildManifest, dir: string, r: Pick<JobContext, "progress">): Promise<string> {
  const member = osImagePath(manifest);
  const entry = zip.entry(member);
  if (!entry) throw new Error(`BuildManifest names ${member}, which ${url} does not have`);
  const path = join(dir, "os.img");
  if (!member.endsWith(".aea")) {
    await assertRoom(dir, entry.size);
    await fetchMember(zip, url, entry, path);
    return path;
  }
  if (entry.method !== 0) throw new Error(`${member} is compressed (method ${entry.method}); AEA images are stored`);
  const image = await openAea(streamRange(url, await zip.dataOffset(entry), entry.compressedSize), (authData) => fcsKey(authData, fetchPem));
  await assertRoom(dir, image.size);
  await pipeline(reporting(image, member, r), createWriteStream(path));
  return path;
}
