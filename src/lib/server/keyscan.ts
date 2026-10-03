/**
 * "What does everyone else put here?": one setting across every source in a
 * scope, from the scan index the extractor builds (src/lib/storage/scan.ts).
 * The index holds each source's head leaves, sharded by file and top-level
 * key, so a scan is one range read however many sources the scope covers.
 * Pure: the reading is ./scan.ts.
 */

import { lookupAll, stable } from "#lib/decode/index.ts";
import type { ScanRow } from "#lib/storage/scan.ts";

export interface ScanTarget {
  /** The source key. */
  readonly source: string;
  readonly name: string;
  readonly cc?: string | undefined;
  /** The version the index read, when it read this source. */
  readonly version?: string | undefined;
}

/** A target's leaves under the queried top-level key. `null` = the source has no such file; `undefined` = not in the index yet. */
export type TargetRow = ScanRow | null | undefined;

export interface ScanHit extends ScanTarget {
  /** Every path the query matched in this source. Empty = absent. */
  readonly matches: ReadonlyArray<{ readonly path: string; readonly value: unknown }>;
  readonly missing?: true;
  readonly unindexed?: true;
}

export interface ScanBucket {
  readonly value: unknown;
  readonly present: boolean;
  /** Sources holding this value at any matched path. */
  readonly count: number;
  /** Source keys, the first BUCKET_NAMES of them. */
  readonly sources: readonly string[];
}

export interface ScanResult {
  readonly path: string;
  readonly file: string;
  readonly scope: string;
  /** Sources that have the file. */
  readonly scanned: number;
  /** Of those, how many set the key. */
  readonly set: number;
  /** Sources the index did not cover yet. */
  readonly unindexed: number;
  readonly buckets: readonly ScanBucket[];
  readonly hits: readonly ScanHit[];
}

const BUCKET_NAMES = 60;

function hitOf(t: ScanTarget, row: TargetRow, path: string): ScanHit {
  if (row === undefined) return { ...t, matches: [], unindexed: true };
  if (row === null) return { ...t, matches: [], missing: true };
  return { ...t, matches: lookupAll({ ...row }, path) };
}

/**
 * Answer a query. `rows[i]` pairs with `targets[i]`. Wildcards (`apns[*].type-mask`)
 * match every index; a source counts once per distinct value it holds.
 */
export function keyScan(targets: readonly ScanTarget[], rows: readonly TargetRow[], file: string, path: string, scope: string): ScanResult {
  const hits = targets.map((t, i) => hitOf(t, rows[i], path));

  const buckets = new Map<string, { value: unknown; present: boolean; count: number; sources: string[] }>();
  const add = (k: string, value: unknown, present: boolean, source: string): void => {
    const b = buckets.get(k) ?? { value, present, count: 0, sources: [] };
    buckets.set(k, b);
    b.count++;
    if (b.sources.length < BUCKET_NAMES) b.sources.push(source);
  };
  for (const h of hits) {
    if (h.missing || h.unindexed) continue;
    if (!h.matches.length) {
      add("\0absent", null, false, h.source);
      continue;
    }
    const seen = new Set<string>();
    for (const m of h.matches) {
      const k = stable(m.value);
      if (seen.has(k)) continue;
      seen.add(k);
      add(k, m.value, true, h.source);
    }
  }

  const rank = (h: ScanHit): number => (h.unindexed ? 3 : h.missing ? 2 : h.matches.length ? 0 : 1);
  return {
    path, file, scope,
    scanned: hits.filter((h) => !h.missing && !h.unindexed).length,
    set: hits.filter((h) => h.matches.length).length,
    unindexed: hits.filter((h) => h.unindexed).length,
    buckets: [...buckets.values()].sort((a, b) => b.count - a.count || Number(b.present) - Number(a.present)),
    hits: hits.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)),
  };
}

export interface SettingSummary {
  readonly scanned: number;
  readonly set: number;
  readonly median: number | null;
  readonly min: { readonly value: number; readonly sources: readonly string[] } | null;
  readonly max: { readonly value: number; readonly sources: readonly string[] } | null;
}

/**
 * One setting cut to what a wiki table shows: how many sources set it, the
 * median of its numeric values, and every source that holds the largest and
 * the smallest.
 */
export function summarise(r: ScanResult): SettingSummary {
  const nums = r.hits
    .flatMap((h) => h.matches.flatMap((m) => (typeof m.value === "number" ? [{ source: h.source, value: m.value }] : [])))
    .sort((a, b) => a.value - b.value);
  const holders = (value: number | undefined): SettingSummary["min"] =>
    value === undefined ? null : { value, sources: [...new Set(nums.filter((x) => x.value === value).map((x) => x.source))] };
  return {
    scanned: r.scanned,
    set: r.set,
    median: nums[Math.floor(nums.length / 2)]?.value ?? null,
    min: holders(nums[0]?.value),
    max: holders(nums.at(-1)?.value),
  };
}
