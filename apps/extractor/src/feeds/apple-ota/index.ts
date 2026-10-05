/** Apple's OTA manifest: a new snapshot plans the files the bucket lacks; the run records what it stored. */

import { sha1Hex } from "@carrier-explode/binary";
import { MANIFEST_URL, manifestTables, parseManifest } from "@carrier-explode/decode-ios";
import { fetchApple } from "@carrier-explode/http";
import { otaFilesSchema } from "@carrier-explode/schema/records";
import { keys, manifestPointerSchema } from "@carrier-explode/storage";
import type { Env } from "../../worker/env.ts";
import type { PipelineParams } from "../../worker/pipelines.ts";
import { readRecord } from "../held.ts";
import { manifestEntries, mergeFiles, type Entry, type StoredFile } from "./files.ts";

const entriesOf = (manifest: Uint8Array): Entry[] => manifestEntries(manifestTables(parseManifest(manifest)));

/**
 * Null while the manifest is the one last recorded. A new one is snapshotted and plans every file it lists that is not
 * stored, so a download that failed is tried again when Apple next changes the manifest.
 */
export async function checkOta(env: Env): Promise<PipelineParams<"ios-ota"> | null> {
  // A query of its own gets past a stale CDN copy.
  const manifest = await fetchApple(`${MANIFEST_URL}?t=${Date.now()}`);
  const sha1 = sha1Hex(manifest);
  const current = await readRecord(env.BUCKET, keys.otaManifestCurrent(), manifestPointerSchema);
  if (current?.sha1 === sha1) return null;
  if (!(await env.BUCKET.head(keys.otaManifest(sha1)))) await env.BUCKET.put(keys.otaManifest(sha1), manifest, { httpMetadata: { contentType: "application/xml" } });
  const held = new Set(((await readRecord(env.BUCKET, keys.otaFiles(), otaFilesSchema)) ?? []).map((f) => f.url));
  return { manifest: sha1, fetch: [...new Set(entriesOf(manifest).map((e) => e.url))].filter((url) => !held.has(url)) };
}

/** files.json with the run's manifest merged in and what it stored added, then current.json at the manifest. `changed`: the index shows a difference. */
export async function recordOta(env: Env, sha1: string, stored: ReadonlyMap<string, StoredFile>): Promise<{ changed: boolean }> {
  const manifest = await env.BUCKET.get(keys.otaManifest(sha1));
  if (!manifest) throw new Error(`${keys.otaManifest(sha1)}: missing; the check stores it`);
  const previous = (await readRecord(env.BUCKET, keys.otaFiles(), otaFilesSchema)) ?? [];
  const merged = mergeFiles(previous, entriesOf(new Uint8Array(await manifest.arrayBuffer())), stored, new Date().toISOString());
  await env.BUCKET.put(keys.otaFiles(), JSON.stringify(merged.files), { httpMetadata: { contentType: "application/json" } });
  await env.BUCKET.put(keys.otaManifestCurrent(), JSON.stringify({ sha1 }), { httpMetadata: { contentType: "application/json" } });
  return { changed: merged.changed };
}
