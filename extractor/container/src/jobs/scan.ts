/**
 * scan: the cross-source scan index (format: src/lib/storage/scan.ts), the
 * port of scripts/scan_index.ts to v2. Rows are each source's head Profile:
 * its raw leaves by file, and its concepts.
 *
 * Heads come from the index (index/carriers/<slug>.json timelines), picked
 * by the schema's headIndex: the entry a carrier page shows by default. A
 * head whose bytes are not stored yet (an OTA file not archived) is skipped.
 *
 * Generations: everything goes under scan/<gen>/, scan/current.json flips
 * last, and the generation before the previous one is deleted (a warm site
 * isolate may still hold the previous pointer for a few minutes). When the
 * heads, and PROFILE_SCHEMA, have not moved since a complete build, nothing
 * is rebuilt unless `force` is set.
 */

import * as v from "valibot";

import { sha256Hex } from "../../../../src/lib/binary/index.ts";
import { headIndex, parseSourceKey, PROFILE_SCHEMA, type Json, type Profile } from "../../../../src/lib/schema/index.ts";
import { keys } from "../../../../src/lib/storage/keys.ts";
import {
  CONCEPTS_FILE, packShards, rareSettings, scanKeys, SCAN_FORMAT, splitRawKey,
  type ScanEntry, type ScanPointer, type ScanSource,
} from "../../../../src/lib/storage/scan.ts";
import { fanOut, failures, succeeded } from "../../../src/fan-out.ts";
import type { JobContext, JobOutput } from "../job.ts";
import { allOrThrow, READ_CONCURRENCY } from "./shared/catalog.ts";
import { profileSchema, readRecord, scanPointerSchema, timelineEntrySchema } from "./shared/records.ts";

/** A run that loses more than this share of its sources fails instead of publishing a thin index. */
const MAX_FAILED_SHARE = 0.1;

const carriersSchema = v.array(v.object({ slug: v.string() }));
/** The part of a CarrierDoc a head needs. */
const docSchema = v.object({ timelines: v.record(v.string(), v.array(timelineEntrySchema)) });

/** `20261003T051700`, UTC: sortable, and unique per run. */
const generation = (now: Date): string => now.toISOString().replace(/[-:]/g, "").slice(0, 15);

async function loadHeads(ctx: JobContext<"scan">): Promise<ScanSource[]> {
  const carriers = (await readRecord(ctx.r2, keys.carriers(), carriersSchema)) ?? [];
  const docs = allOrThrow("carrier docs", await fanOut(carriers, READ_CONCURRENCY, async ({ slug }) => {
    const doc = await readRecord(ctx.r2, keys.carrier(slug), docSchema);
    if (!doc) throw new Error(`${keys.carrier(slug)}: listed in carriers.json but missing`);
    return doc;
  }));
  const heads = new Map<string, ScanSource>();
  const unstored: string[] = [];
  for (const doc of docs) {
    for (const [source, timeline] of Object.entries(doc.timelines)) {
      const head = timeline[headIndex(timeline)];
      // Every copy of an entry has the same content, so any stored one will do.
      const sha = head?.copies.find((c) => c.sha !== undefined)?.sha;
      if (head === undefined || sha === undefined) unstored.push(source);
      else if (!heads.has(source)) heads.set(source, { source, sha, version: head.version });
    }
  }
  if (unstored.length) ctx.log(`${unstored.length} sources skipped, their heads not stored yet: ${unstored.slice(0, 5).join(", ")}${unstored.length > 5 ? ", ..." : ""}`);
  return [...heads.values()].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}

/** iOS signature hash lists and localisations are never worth comparing across sources (as in v1). */
const scannable = (file: string): boolean => !file.startsWith("signatures/") && !file.includes(".lproj/");

/** A Profile as scan rows: raw leaves grouped by file, concepts as their own file. */
function entryOf(profile: Profile, source: string): ScanEntry {
  const files: Record<string, Record<string, Json>> = {};
  for (const [key, value] of Object.entries(profile.raw)) {
    const [file, path] = splitRawKey(key);
    if (!scannable(file)) continue;
    const leaves = files[file] ?? {};
    files[file] = leaves;
    leaves[path] = value;
  }
  files[CONCEPTS_FILE] = Object.fromEntries(Object.entries(profile.concepts).map(([id, c]): [string, Json] =>
    [id, c.state !== undefined ? { value: c.value, state: c.state } : { value: c.value }]));
  return { source, group: `${profile.source.platform}:${profile.source.kind}`, files };
}

/** Rarity is judged within each platform's main settings file. */
const mainFile = (group: string): string => (group.startsWith("ios:") ? "carrier.plist" : "config");

export async function scan(ctx: JobContext<"scan">): Promise<JobOutput<"scan">> {
  const pointer = await readRecord(ctx.r2, scanKeys.pointer(), scanPointerSchema);
  const heads = await loadHeads(ctx);
  const hash = await sha256Hex(new TextEncoder().encode(JSON.stringify({ schema: PROFILE_SCHEMA, heads: heads.map((h) => [h.source, h.sha]) })));
  if (!ctx.spec.params.force && pointer?.heads === hash) {
    ctx.log(`heads unchanged since ${pointer.gen}`);
    return { gen: null, sources: heads.length, failed: 0 };
  }

  let loaded = 0;
  const results = await fanOut(heads, READ_CONCURRENCY, async (head) => {
    if (!parseSourceKey(head.source)) throw new Error(`${head.source}: not a sourceKey`);
    const profile = await readRecord(ctx.r2, keys.norm(head.sha), profileSchema);
    if (!profile) throw new Error(`${head.source}: no profile for ${head.sha}`);
    await ctx.progress(++loaded, heads.length, "profiles");
    return { head, entry: entryOf(profile, head.source) };
  });
  const failed = failures(results);
  for (const f of failed) ctx.log(`skip: ${f}`);
  if (failed.length > heads.length * MAX_FAILED_SHARE) throw new Error(`${failed.length} of ${heads.length} sources failed`);
  const ok = succeeded(results);

  const gen = generation(new Date());
  const objects: Array<{ key: string; body: string | Uint8Array }> = [
    { key: scanKeys.sources(gen), body: JSON.stringify({ sources: ok.map((r) => r.head) }) },
    { key: scanKeys.rare(gen), body: JSON.stringify(rareSettings(ok.map((r) => r.entry), mainFile)) },
  ];
  for (const [file, { index, data }] of packShards(ok.map((r) => r.entry))) {
    objects.push({ key: scanKeys.fileIndex(gen, file), body: JSON.stringify(index) });
    objects.push({ key: scanKeys.fileData(gen, file), body: data });
  }
  objects.push({ key: scanKeys.keys(gen), body: JSON.stringify([...objects.map((o) => o.key), scanKeys.keys(gen)]) });

  let put = 0;
  allOrThrow("scan objects", await fanOut(objects, READ_CONCURRENCY, async (o) => {
    await ctx.r2.put(o.key, o.body, typeof o.body === "string" ? "application/json" : "application/octet-stream");
    await ctx.progress(++put, objects.length, "upload");
  }));

  const next: ScanPointer = {
    format: SCAN_FORMAT,
    gen,
    builtAt: new Date().toISOString(),
    sources: ok.length,
    ...(pointer ? { previous: pointer.gen } : {}),
    // A partial index must not look complete to the next run's change check.
    ...(failed.length ? {} : { heads: hash }),
  };
  await ctx.r2.putJson(scanKeys.pointer(), next);

  if (pointer?.previous) await dropGeneration(ctx, pointer.previous);
  ctx.log(`${gen}: ${ok.length} sources, ${objects.length} objects, ${failed.length} failed`);
  return { gen, sources: ok.length, failed: failed.length };
}

/** Deletes a generation by its _keys.json, which lists every key it wrote; the list itself goes last, so a failed run can resume. */
async function dropGeneration(ctx: JobContext<"scan">, gen: string): Promise<void> {
  const list = scanKeys.keys(gen);
  const owned = (await readRecord(ctx.r2, list, v.array(v.string()))) ?? [];
  const mine = owned.filter((k) => k.startsWith(scanKeys.prefix(gen)) && k !== list);
  allOrThrow(`drop ${gen}`, await fanOut(mine, READ_CONCURRENCY, (k) => ctx.r2.delete(k)));
  await ctx.r2.delete(list);
}
