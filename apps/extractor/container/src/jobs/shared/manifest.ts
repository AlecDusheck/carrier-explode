/** The OTA manifest snapshot the ios-ota run recorded last: what jobs read instead of fetching Apple live, so a run is repeatable. */

import { keys, manifestPointerSchema } from "@carrier-explode/storage";
import type { R2Client } from "../../job.ts";
import { readRecord } from "./records.ts";

export async function storedManifest(r2: R2Client): Promise<Uint8Array> {
  const pointer = await readRecord(r2, keys.otaManifestCurrent(), manifestPointerSchema);
  if (!pointer) throw new Error(`${keys.otaManifestCurrent()}: missing; the ios-ota run writes it`);
  const bytes = await r2.get(keys.otaManifest(pointer.sha1));
  if (!bytes) throw new Error(`${keys.otaManifest(pointer.sha1)}: missing, though current.json names it`);
  return bytes;
}
