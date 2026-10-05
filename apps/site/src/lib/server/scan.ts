/** The scan index: one setting across a scope of sources, the settings few others share, and the wiki's live numbers. */

import * as v from "valibot";
import { sourceOf, type Platform } from "@carrier-explode/schema/types";
import { jsonSchema } from "@carrier-explode/schema/records";
import { scanKeys, scanPointerSchema, topKey, type RareSetting, type ScanFileIndex, type ScanShard, type ScanSources } from "@carrier-explode/storage";
import type { ScanScope } from "#lib/ui-state.svelte.ts";
import { cached, perRequest } from "./cache";
import { carrierList, countryList, resolve } from "./catalog";
import type { Ver } from "#lib/types.ts";
import { keyScan, summarise, type ScanResult, type ScanTarget, type SettingSummary, type TargetRow } from "./keyscan";
import { readBytes, readJson } from "./store";

const sourcesSchema: v.GenericSchema<unknown, ScanSources> = v.object({
  sources: v.array(v.object({ source: v.string(), sha: v.string(), version: v.string() })),
});
const fileIndexSchema: v.GenericSchema<unknown, ScanFileIndex> = v.object({
  srcs: v.array(v.string()),
  shards: v.record(v.string(), v.tuple([v.number(), v.number()])),
});
const shardSchema: v.GenericSchema<unknown, ScanShard> = v.object({
  at: v.array(v.number()),
  rows: v.array(v.record(v.string(), jsonSchema)),
});
const rareBase = { path: v.string(), holders: v.number(), of: v.number(), with: v.array(v.string()) };
const rareSchema: v.GenericSchema<unknown, Record<string, RareSetting[]>> = v.record(v.string(), v.array(v.variant("rare", [
  v.object({ ...rareBase, rare: v.literal("key") }),
  v.object({ ...rareBase, rare: v.literal("value"), value: v.string() }),
])));

/** Which generation to read; null until the first scan job has run. Written last by the job, so whatever it names is whole. */
const pointer = perRequest(() => readJson(scanKeys.pointer(), scanPointerSchema));

/** Every source the generation indexed, with the version it read. */
const indexedSources = perRequest(async (gen: string): Promise<ReadonlyMap<string, { sha: string; version: string }>> => {
  const s = await readJson(scanKeys.sources(gen), sourcesSchema);
  return new Map((s?.sources ?? []).map((x) => [x.source, { sha: x.sha, version: x.version }]));
});

/** The sources a scope covers on a platform: phone-family carrier sources, or iOS country bundles. */
async function scopeSources(platform: Platform, scope: ScanScope): Promise<ScanTarget[]> {
  if (scope === "countries") {
    return (await countryList()).flatMap((c) => c.sources.flatMap((source) => {
      const ref = sourceOf(source);
      return ref.platform === platform ? [{ source, name: ref.name, cc: c.iso, version: null }] : [];
    }));
  }
  const cc = scope.startsWith("country:") ? scope.slice("country:".length) : null;
  return (await carrierList())
    .filter((c) => cc === null || c.iso === cc)
    .flatMap((c) => c.members.flatMap((source) => {
      const ref = sourceOf(source);
      return ref.platform === platform && ref.kind === "carrier" ? [{ source, name: ref.name, cc: c.iso ?? null, version: null }] : [];
    }));
}

/**
 * Every source in scope's value at `path` in `file`. `path` may use `[*]` for
 * any index and `*` for any key. Covers the whole scope: no limit.
 */
export async function scanKey(platform: Platform, path: string, file: string, scope: ScanScope): Promise<ScanResult> {
  const [p, inScope] = await Promise.all([pointer(), scopeSources(platform, scope)]);
  return cached(`scan:v5:${p?.gen ?? "none"}|${platform}|${scope}|${file}|${path}|${inScope.length}`, async () => {
    if (!p) return keyScan(inScope, inScope.map((): TargetRow => ({ kind: "unindexed" })), file, path, scope);
    const [indexed, fi] = await Promise.all([indexedSources(p.gen), readJson(scanKeys.fileIndex(p.gen, file), fileIndexSchema)]);
    const targets = inScope.map((t) => ({ ...t, version: indexed.get(t.source)?.version ?? null }));
    // An indexed source has the file only when the file index lists it; its row is empty until the shard says more.
    const rows: TargetRow[] = targets.map((t) => (indexed.has(t.source) ? { kind: "missing" } : { kind: "unindexed" }));
    const at = new Map(targets.map((t, i) => [t.source, i]));
    for (const src of fi?.srcs ?? []) {
      const i = at.get(src);
      if (i !== undefined) rows[i] = { kind: "read", row: {} };
    }
    const loc = fi?.shards[topKey(path)];
    const bytes = loc ? await readBytes(scanKeys.fileData(p.gen, file), { offset: loc[0], length: loc[1] }) : null;
    if (bytes && fi) {
      const shard = v.parse(shardSchema, JSON.parse(new TextDecoder().decode(bytes)));
      shard.at.forEach((n, k) => {
        const src = fi.srcs[n];
        const i = src === undefined ? undefined : at.get(src);
        const row = shard.rows[k];
        if (i !== undefined && row !== undefined) rows[i] = { kind: "read", row };
      });
    }
    return keyScan(targets, rows, file, path, scope);
  });
}

export async function settingSummary(platform: Platform, path: string, file: string, scope: ScanScope): Promise<SettingSummary> {
  return summarise(await scanKey(platform, path, file, scope));
}

/** "pending": no index run has written the rarity file yet; "old": the version is not the one the index read. */
export type Rare =
  | { readonly indexed: true; readonly rows: readonly RareSetting[] }
  | { readonly indexed: false; readonly why: "pending" | "old" };

/** A version's settings that at most a few other sources of its platform and kind share. Only the indexed (head) version has them. */
export async function getRare(v: Ver): Promise<Rare> {
  const key = v.source;
  const [{ entry }, p] = await Promise.all([resolve(v), pointer()]);
  if (!p) return { indexed: false, why: "pending" };
  const got = await cached(`rare:v2:${p.gen}:${key}`, async () => {
    const [all, indexed] = await Promise.all([readJson(scanKeys.rare(p.gen), rareSchema), indexedSources(p.gen)]);
    return { built: all !== null, sha: indexed.get(key)?.sha ?? null, rows: all?.[key] ?? [] };
  });
  if (!got.built) return { indexed: false, why: "pending" };
  return got.sha !== null && entry.sha === got.sha ? { indexed: true, rows: got.rows } : { indexed: false, why: "old" };
}
