/** "What does everyone else put here?": one setting across a scope of sources, from scan index rows. Pure; ./scan.ts reads them. */

import { canonical, lookupAll } from "@carrier-explode/values";
import type { ScanRow } from "@carrier-explode/storage";

export interface ScanTarget {
  /** The source key. */
  readonly source: string;
  readonly name: string;
  readonly cc: string | null;
  /** The version the index read; null when it has not read this source. */
  readonly version: string | null;
}

/** What the index holds for a target: nothing yet, no such file, or the file's leaves under the queried top-level key. */
export type TargetRow = { readonly kind: "unindexed" } | { readonly kind: "missing" } | { readonly kind: "read"; readonly row: ScanRow };

export type Match = { readonly path: string; readonly value: unknown };

/** A target's answer; `matches` holds every path the query matched in the file, empty when the key is absent. */
export type ScanHit = ScanTarget & (
  | { readonly state: "unindexed" }
  | { readonly state: "missing" }
  | { readonly state: "read"; readonly matches: readonly Match[] }
);

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
  return row.kind === "read" ? { ...t, state: "read", matches: lookupAll({ ...row.row }, path) } : { ...t, state: row.kind };
}

/** A hit's matches; none for a source the index did not read the file of. */
const matchesOf = (h: ScanHit): readonly Match[] => (h.state === "read" ? h.matches : []);

/**
 * Answer a query. `rows[i]` pairs with `targets[i]`. Wildcards (`apns[*].type-mask`)
 * match every index; a source counts once per distinct value it holds.
 */
export function keyScan(targets: readonly ScanTarget[], rows: readonly TargetRow[], file: string, path: string, scope: string): ScanResult {
  const hits = targets.map((t, i) => hitOf(t, rows[i] ?? { kind: "unindexed" }, path));

  const buckets = new Map<string, { value: unknown; present: boolean; count: number; sources: string[] }>();
  const add = (k: string, value: unknown, present: boolean, source: string): void => {
    const b = buckets.get(k) ?? { value, present, count: 0, sources: [] };
    buckets.set(k, b);
    b.count++;
    if (b.sources.length < BUCKET_NAMES) b.sources.push(source);
  };
  for (const h of hits) {
    if (h.state !== "read") continue;
    if (!h.matches.length) {
      add("\0absent", null, false, h.source);
      continue;
    }
    const seen = new Set<string>();
    for (const m of h.matches) {
      const k = canonical(m.value);
      if (seen.has(k)) continue;
      seen.add(k);
      add(k, m.value, true, h.source);
    }
  }

  const RANK = { read: 0, missing: 2, unindexed: 3 } as const satisfies Record<ScanHit["state"], number>;
  const rank = (h: ScanHit): number => RANK[h.state] + (h.state === "read" && !h.matches.length ? 1 : 0);
  return {
    path, file, scope,
    scanned: hits.filter((h) => h.state === "read").length,
    set: hits.filter((h) => matchesOf(h).length).length,
    unindexed: hits.filter((h) => h.state === "unindexed").length,
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
    .flatMap((h) => matchesOf(h).flatMap((m) => (typeof m.value === "number" ? [{ source: h.source, value: m.value }] : [])))
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
