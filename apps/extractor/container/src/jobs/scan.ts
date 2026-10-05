/** The scan index over each source's head Profile. The pointer flips last; then every generation but it and the previous is deleted. */

import { sha256Hex } from "@carrier-explode/binary";

import { head, PROFILE_SCHEMA, profileSchema, type IndexOutput } from "@carrier-explode/schema";
import {
  keys, packShards, rareSettings, SCAN_FORMAT, scanEntry, scanKeys, scanPointerSchema,
  type ScanEntry, type ScanPointer, type ScanSource,
} from "@carrier-explode/storage";
import { allOrThrow, fanOut, failures, succeeded } from "../../../src/fan-out.ts";
import { stamp } from "../../../src/time.ts";
import type { JobContext } from "../job.ts";
import type { JobOutput } from "../../../src/jobs.ts";
import { dropStale } from "./shared/generations.ts";
import { READ_CONCURRENCY } from "./shared/limits.ts";
import { readRecord } from "./shared/records.ts";

/** A run that loses more than this share of its sources fails rather than publish a thin index. */
const MAX_FAILED_SHARE = 0.1;

/** Each source's head in the index just built, by key. */
function headsOf(index: IndexOutput): ScanSource[] {
  return index.docs.flatMap((doc) => Object.entries(doc.sources).flatMap(([source, timeline]) => {
    const at = head(timeline);
    return at ? [{ source, sha: at.entry.sha, version: at.entry.version }] : [];
  })).sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}

async function headsHash(heads: readonly ScanSource[]): Promise<string> {
  const text = JSON.stringify({ schema: PROFILE_SCHEMA, heads: heads.map((h) => [h.source, h.sha]) });
  return sha256Hex(new TextEncoder().encode(text));
}

/** An object the scan index is made of. */
interface Upload {
  readonly key: string;
  readonly body: string | Uint8Array;
}

function scanObjects(gen: string, heads: readonly ScanSource[], entries: readonly ScanEntry[]): Upload[] {
  const objects: Upload[] = [
    { key: scanKeys.sources(gen), body: JSON.stringify({ sources: heads }) },
    { key: scanKeys.rare(gen), body: JSON.stringify(rareSettings(entries)) },
  ];
  for (const [file, { index, data }] of packShards(entries)) {
    objects.push({ key: scanKeys.fileIndex(gen, file), body: JSON.stringify(index) });
    objects.push({ key: scanKeys.fileData(gen, file), body: data });
  }
  return objects;
}

/** The scan part of a publish. */
export type ScanSummary = Extract<JobOutput<"publish">, { readonly kind: "built" }>["scan"];

export async function scan(ctx: JobContext<"publish">, index: IndexOutput): Promise<ScanSummary> {
  const pointer = await readRecord(ctx.r2, scanKeys.pointer(), scanPointerSchema);
  const heads = headsOf(index);
  const hash = await headsHash(heads);
  if (!ctx.spec.params.force && pointer?.complete && pointer.heads === hash) {
    ctx.log(`heads unchanged since ${pointer.gen}`);
    return { gen: null, sources: heads.length, failed: 0 };
  }

  let loaded = 0;
  // A head without a profile is one another pipeline has released but not normalized yet: its own scan follows.
  const results = await fanOut(heads, READ_CONCURRENCY, async (h) => {
    const profile = await readRecord(ctx.r2, keys.norm(h.sha), profileSchema);
    await ctx.progress(++loaded, heads.length, "profiles");
    return profile && scanEntry(profile, h.source);
  });
  const failed = failures(results);
  for (const f of failed) ctx.log(`skipped: ${f}`);
  if (failed.length > heads.length * MAX_FAILED_SHARE) throw new Error(`${failed.length} of ${heads.length} sources failed`);
  const scanned = results.flatMap((r) => (r.ok && r.value ? [{ head: r.item, entry: r.value }] : []));
  const pending = succeeded(results).filter((e) => e === null).length;
  if (pending) ctx.log(`${pending} sources skipped: their heads are not normalized yet`);

  const gen = stamp(new Date());
  const indexed = scanned.map((s) => s.head);
  const objects = scanObjects(gen, indexed, scanned.map((s) => s.entry));
  let put = 0;
  allOrThrow("scan objects", await fanOut(objects, READ_CONCURRENCY, async (o) => {
    await ctx.r2.put(o.key, o.body, typeof o.body === "string" ? "application/json" : "application/octet-stream");
    await ctx.progress(++put, objects.length, "upload");
  }));

  const next: ScanPointer = {
    format: SCAN_FORMAT,
    gen,
    builtAt: new Date().toISOString(),
    sources: indexed.length,
    previous: pointer?.gen ?? null,
    heads: hash,
    complete: failed.length === 0 && pending === 0,
  };
  await ctx.r2.putJson(scanKeys.pointer(), next);
  const kept = (next.previous === null ? [gen] : [gen, next.previous]).map(scanKeys.prefix);
  const dropped = await dropStale(ctx.r2, keys.scanPrefix(), scanKeys.pointer(), kept);
  ctx.log(`${gen}: ${indexed.length} sources, ${objects.length} objects, ${failed.length} failed; ${dropped} stale deleted`);
  return { gen, sources: indexed.length, failed: failed.length };
}
