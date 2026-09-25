/**
 * Cross-bundle lookup for a single setting: "what does everyone else put here?"
 *
 * scripts/scan_index.ts (run by the workflow) flattens every head bundle and
 * packs, per member file, one shard per top-level key into a single object with
 * a small index beside it. A scan is one range read however many bundles the
 * scope covers. The worker only reads; bundles newer than the last index run
 * are reported as unindexed until the next one.
 */

import { lookupAll, stable, type Flat } from "$lib/decode";

/* ------------------------------------------------------------ storage layout */

/** `scan/current.json`: which generation to read. Written last, after every shard. */
export interface ScanPointer {
  gen: string;
  builtAt: string;
  bundles: number;
  /** The generation before this one, kept for readers still on it; the next run deletes it. */
  previous?: string;
  /** Hash of the head set it was built from; absent when a bundle failed, so the next run rebuilds. */
  heads?: string;
}

/** `scan/<gen>/<file>.idx.json`. */
export interface ScanFileIndex {
  /** Every indexed bundle that has this file. */
  srcs: string[];
  /** Top-level key → [offset, length] of its shard in the `.dat` object. */
  shards: Record<string, [number, number]>;
}

/** One shard inside `scan/<gen>/<file>.dat`: `rows[i]` belongs to `srcs[at[i]]`. */
export interface ScanShard {
  at: number[];
  rows: Flat[];
}

export const POINTER_KEY = "scan/current.json";
const fileStem = (gen: string, file: string) => `scan/${gen}/${encodeURIComponent(file)}`;
export const bundlesKey = (gen: string) => `scan/${gen}/_bundles.json`;
export const fileIndexKey = (gen: string, file: string) => `${fileStem(gen, file)}.idx.json`;
export const fileDataKey = (gen: string, file: string) => `${fileStem(gen, file)}.dat`;

/** First path segment: the shard a query reads. `apns[*].x` → `apns`. */
export function topKey(path: string): string {
  return path.split(/[.[]/, 1)[0];
}

/** Pack flattened bundles into one `{index, data}` pair per member file. */
export function packShards(bundles: Array<{ src: string; flat: Record<string, Flat> }>) {
  const byFile = new Map<string, { srcs: string[]; tops: Map<string, ScanShard> }>();
  for (const { src, flat } of bundles) {
    for (const [file, leaves] of Object.entries(flat)) {
      let f = byFile.get(file);
      if (!f) byFile.set(file, (f = { srcs: [], tops: new Map() }));
      const at = f.srcs.push(src) - 1;
      const mine = new Map<string, Flat>();
      for (const [k, v] of Object.entries(leaves)) {
        const top = topKey(k);
        let row = mine.get(top);
        if (!row) mine.set(top, (row = {}));
        row[k] = v;
      }
      for (const [top, row] of mine) {
        let s = f.tops.get(top);
        if (!s) f.tops.set(top, (s = { at: [], rows: [] }));
        s.at.push(at);
        s.rows.push(row);
      }
    }
  }
  const enc = new TextEncoder();
  const out = new Map<string, { index: ScanFileIndex; data: Uint8Array }>();
  for (const [file, { srcs, tops }] of byFile) {
    const parts: Uint8Array[] = [];
    const shards: ScanFileIndex["shards"] = {};
    let offset = 0;
    for (const top of [...tops.keys()].sort()) {
      const bytes = enc.encode(JSON.stringify(tops.get(top)));
      shards[top] = [offset, bytes.length];
      parts.push(bytes);
      offset += bytes.length;
    }
    const data = new Uint8Array(offset);
    let at = 0;
    for (const p of parts) { data.set(p, at); at += p.length; }
    out.set(file, { index: { srcs, shards }, data });
  }
  return out;
}

/* ------------------------------------------------------------------- query */

export interface ScanTarget {
  name: string;
  display: string;
  cc?: string;
  os: string;
  build: string;
  /** Storage location; never sent to the client. */
  src: string;
}

/**
 * A target's leaves under the queried top-level key. `null` = the bundle has no
 * such file; `undefined` = not in the index yet.
 */
export type TargetRow = Flat | null | undefined;

export interface ScanHit {
  name: string;
  display: string;
  cc?: string;
  os: string;
  build: string;
  /** Every path the query matched in this bundle. Empty = absent. */
  matches: Array<{ path: string; value: unknown }>;
  missing?: boolean;
  unindexed?: boolean;
}

export interface ScanBucket {
  value: unknown;
  present: boolean;
  /** Bundles holding this value at any matched path. */
  count: number;
  carriers: string[];
}

export interface ScanResult {
  path: string;
  file: string;
  scope: string;
  /** Bundles that have the file. */
  scanned: number;
  /** Of those, how many set the key. */
  set: number;
  /** Bundles the index did not cover yet. */
  unindexed: number;
  buckets: ScanBucket[];
  hits: ScanHit[];
}

const BUCKET_NAMES = 60;

/**
 * Answer a query. `rows[i]` pairs with `targets[i]`. Wildcards (`apns[*].type-mask`)
 * match every index; a bundle counts once per distinct value it holds.
 */
export function keyScan(targets: ScanTarget[], rows: TargetRow[], file: string, path: string, scope: string): ScanResult {
  const hits: ScanHit[] = targets.map((t, i) => {
    const base = { name: t.name, display: t.display, cc: t.cc, os: t.os, build: t.build };
    const row = rows[i];
    if (row === undefined) return { ...base, matches: [], unindexed: true };
    if (row === null) return { ...base, matches: [], missing: true };
    return { ...base, matches: lookupAll(row, path) };
  });

  const buckets = new Map<string, ScanBucket>();
  const add = (k: string, value: unknown, present: boolean, name: string) => {
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = { value, present, count: 0, carriers: [] }));
    b.count++;
    if (b.carriers.length < BUCKET_NAMES) b.carriers.push(name);
  };
  for (const h of hits) {
    if (h.missing || h.unindexed) continue;
    if (!h.matches.length) { add("\0absent", null, false, h.name); continue; }
    const seen = new Set<string>();
    for (const m of h.matches) {
      const k = stable(m.value);
      if (!seen.has(k)) { seen.add(k); add(k, m.value, true, h.name); }
    }
  }

  const rank = (h: ScanHit) => (h.unindexed ? 3 : h.missing ? 2 : h.matches.length ? 0 : 1);
  return {
    path, file, scope,
    scanned: hits.filter((h) => !h.missing && !h.unindexed).length,
    set: hits.filter((h) => h.matches.length).length,
    unindexed: hits.filter((h) => h.unindexed).length,
    buckets: [...buckets.values()].sort((a, b) => b.count - a.count || Number(b.present) - Number(a.present)),
    hits: hits.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)),
  };
}
