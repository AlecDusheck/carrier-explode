/**
 * scan: the cross-source scan index (src/lib/storage/scan.ts) over each
 * source's head Profile, as the index's timelines name it. scan/current.json
 * flips last; the generation before the previous one is deleted.
 */

import * as v from "valibot";

import { sha256Hex } from "../../../../src/lib/binary/index.ts";
import {
  decoderFamily, head, PROFILE_SCHEMA,
  type ConceptValue, type DecoderFamily, type Json, type Profile, type Timeline,
} from "../../../../src/lib/schema/index.ts";
import { keys } from "../../../../src/lib/storage/keys.ts";
import {
  CONCEPTS_FILE, packShards, rareSettings, scanKeys, SCAN_FORMAT, splitRawKey,
  type ScanEntry, type ScanPointer, type ScanSource,
} from "../../../../src/lib/storage/scan.ts";
import { fanOut, failures, succeeded } from "../../../src/fan-out.ts";
import type { JobContext, JobOutput } from "../job.ts";
import { allOrThrow, READ_CONCURRENCY } from "./shared/catalog.ts";
import { carrierIndexSchema, carrierTimelinesSchema, profileSchema, readRecord, scanPointerSchema } from "./shared/records.ts";

/** A run that loses more than this share of its sources fails rather than publish a thin index. */
const MAX_FAILED_SHARE = 0.1;

const MAIN_FILE = { apple: "carrier.plist", android: "config" } as const satisfies Record<DecoderFamily, string>;

/** Apple signature hash lists and localisations are never worth comparing across sources. */
const scannable = (file: string): boolean => !file.startsWith("signatures/") && !file.includes(".lproj/");

/** `20261003T051700`, UTC. */
const generation = (now: Date): string => now.toISOString().replace(/[-:]/g, "").slice(0, 15);

type Upload = { readonly key: string; readonly body: string | Uint8Array };

/** The head's stored bytes; undefined while its only copy is an OTA file not archived yet. */
function headArtifact(timeline: Timeline): { sha: string; version: string } | undefined {
  const at = head(timeline);
  if (!at) return undefined;
  for (const copy of at.entry.copies) {
    if (copy.via === "image") return { sha: copy.sha, version: at.entry.version };
    if (copy.archive.state === "archived") return { sha: copy.archive.sha, version: at.entry.version };
  }
  return undefined;
}

async function loadHeads(ctx: JobContext<"scan">): Promise<ScanSource[]> {
  const carriers = (await readRecord(ctx.r2, keys.carrierIndex(), carrierIndexSchema)) ?? [];
  const docs = allOrThrow("carrier docs", await fanOut(carriers, READ_CONCURRENCY, async ({ id }) => {
    const doc = await readRecord(ctx.r2, keys.carrier(id), carrierTimelinesSchema);
    if (!doc) throw new Error(`${keys.carrier(id)}: in the carrier index but missing`);
    return doc;
  }));
  const heads = new Map<string, ScanSource>();
  let unarchived = 0;
  for (const doc of docs) {
    for (const [source, timeline] of Object.entries(doc.timelines)) {
      const found = headArtifact(timeline);
      if (found) heads.set(source, { source, ...found });
      else unarchived++;
    }
  }
  if (unarchived) ctx.log(`${unarchived} sources skipped: their heads are not archived yet`);
  return [...heads.values()].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}

const conceptLeaf = (c: ConceptValue): Json => (c.kind === "state" ? c.state : c.kind === "value" ? c.value : null);

function entryOf(profile: Profile, source: string): ScanEntry {
  const files: Record<string, Record<string, Json>> = {};
  for (const [key, value] of Object.entries(profile.raw)) {
    const [file, path] = splitRawKey(key);
    if (!scannable(file)) continue;
    const leaves = files[file] ?? {};
    files[file] = leaves;
    leaves[path] = value;
  }
  files[CONCEPTS_FILE] = Object.fromEntries(Object.entries(profile.concepts).map(([id, c]) => [id, conceptLeaf(c)]));
  return {
    source,
    group: `${profile.source.platform}:${profile.source.kind}`,
    main: MAIN_FILE[decoderFamily(profile.source.platform)],
    files,
  };
}

async function headsHash(heads: readonly ScanSource[]): Promise<string> {
  const text = JSON.stringify({ schema: PROFILE_SCHEMA, heads: heads.map((h) => [h.source, h.sha]) });
  return sha256Hex(new TextEncoder().encode(text));
}

function generationObjects(gen: string, heads: readonly ScanSource[], entries: readonly ScanEntry[]): Upload[] {
  const objects: Upload[] = [
    { key: scanKeys.sources(gen), body: JSON.stringify({ sources: heads }) },
    { key: scanKeys.rare(gen), body: JSON.stringify(rareSettings(entries)) },
  ];
  for (const [file, { index, data }] of packShards(entries)) {
    objects.push({ key: scanKeys.fileIndex(gen, file), body: JSON.stringify(index) });
    objects.push({ key: scanKeys.fileData(gen, file), body: data });
  }
  return [...objects, { key: scanKeys.keys(gen), body: JSON.stringify([...objects.map((o) => o.key), scanKeys.keys(gen)]) }];
}

/** Deletes a generation by its key list, the list itself last, so a failed run can resume. */
async function dropGeneration(ctx: JobContext<"scan">, gen: string): Promise<void> {
  const list = scanKeys.keys(gen);
  const owned = (await readRecord(ctx.r2, list, v.array(v.string()))) ?? [];
  const mine = owned.filter((k) => k.startsWith(scanKeys.prefix(gen)) && k !== list);
  allOrThrow(`drop ${gen}`, await fanOut(mine, READ_CONCURRENCY, (k) => ctx.r2.delete(k)));
  await ctx.r2.delete(list);
}

export async function scan(ctx: JobContext<"scan">): Promise<JobOutput<"scan">> {
  const pointer = await readRecord(ctx.r2, scanKeys.pointer(), scanPointerSchema);
  const heads = await loadHeads(ctx);
  const hash = await headsHash(heads);
  if (!ctx.spec.params.force && pointer?.complete && pointer.heads === hash) {
    ctx.log(`heads unchanged since ${pointer.gen}`);
    return { gen: null, sources: heads.length, failed: 0 };
  }

  let loaded = 0;
  const results = await fanOut(heads, READ_CONCURRENCY, async (h) => {
    const profile = await readRecord(ctx.r2, keys.norm(h.sha), profileSchema);
    if (!profile) throw new Error(`${h.source}: no profile for ${h.sha}`);
    await ctx.progress(++loaded, heads.length, "profiles");
    return entryOf(profile, h.source);
  });
  const failed = failures(results);
  for (const f of failed) ctx.log(`skipped: ${f}`);
  if (failed.length > heads.length * MAX_FAILED_SHARE) throw new Error(`${failed.length} of ${heads.length} sources failed`);

  const gen = generation(new Date());
  const indexed = results.flatMap((r) => (r.ok ? [r.item] : []));
  const objects = generationObjects(gen, indexed, succeeded(results));
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
    complete: failed.length === 0,
  };
  await ctx.r2.putJson(scanKeys.pointer(), next);
  if (pointer?.previous) await dropGeneration(ctx, pointer.previous);
  ctx.log(`${gen}: ${indexed.length} sources, ${objects.length} objects, ${failed.length} failed`);
  return { gen, sources: indexed.length, failed: failed.length };
}
