/**
 * The cross-source scan index, v2: "what does everyone else put here?" over
 * Profiles, both platforms. Written by the extractor's `scan` job, read by the
 * site. v1 (src/lib/server/keyscan.ts) flattened iOS bundles itself; v2 reads
 * the leaves the platform mappers already flattened into Profile.raw, plus
 * Profile.concepts, of each source's head.
 *
 *   scan/current.json                      ScanPointer, written last
 *   scan/<gen>/_sources.json               ScanSources: every source indexed, and which artifact
 *   scan/<gen>/f/<file>.idx.json           ScanFileIndex: sources with the file, shard offsets
 *   scan/<gen>/f/<file>.dat                the shards, concatenated JSON (one range read per query)
 *   scan/<gen>/_rare.json                  sourceKey → RareSetting[]
 *   scan/<gen>/_keys.json                  every key of the generation, so the one after next deletes it in one pass
 *
 * A "file" is the part of a raw key before its first `:` (`carrier.plist`,
 * `overrides_N104.plist`, Android `config`, `vendor`), "" for keys with none
 * (Android `apns[0].apn`), and CONCEPTS_FILE for concept values.
 * Pure data and functions: no decoder imports, so both platforms share it.
 */

import type { Json } from "../schema/types.ts";

export const SCAN_FORMAT = 2;

/** `scan/current.json`. */
export interface ScanPointer {
  readonly format: typeof SCAN_FORMAT;
  readonly gen: string;
  readonly builtAt: string;
  readonly sources: number;
  /** The generation before this one, kept for readers still holding it; the next build deletes it. */
  readonly previous?: string;
  /** Hash of the head set (and PROFILE_SCHEMA) it was built from; absent when a source failed, so the next run rebuilds. */
  readonly heads?: string;
}

/** One indexed source: its head artifact. */
export interface ScanSource {
  /** sourceKey, `ios:carrier:TMobile_us`. */
  readonly source: string;
  readonly sha: string;
  readonly version: string;
}

export interface ScanSources {
  readonly sources: readonly ScanSource[];
}

/** `scan/<gen>/f/<file>.idx.json`. */
export interface ScanFileIndex {
  /** sourceKeys of every indexed source that has this file. */
  readonly srcs: readonly string[];
  /** Top-level key → [offset, length] of its shard in the `.dat` object. */
  readonly shards: Readonly<Record<string, readonly [number, number]>>;
}

/** Leaves of one source under one top-level key: path → value. */
export type ScanRow = Readonly<Record<string, Json>>;

/** One shard inside `.dat`: `rows[i]` belongs to `srcs[at[i]]`. */
export interface ScanShard {
  readonly at: readonly number[];
  readonly rows: readonly ScanRow[];
}

/** `scan/<gen>/_rare.json` entries: settings few other sources of the same platform and kind share. */
export interface RareSetting {
  /** Leaf path with array positions as `[*]`, e.g. `apns[*].type-mask`. */
  readonly path: string;
  /** The value as stable() writes it; absent when the key itself is what is rare. */
  readonly value?: string;
  /** Sources holding this value (or setting this key), this one included. */
  readonly holders: number;
  /** Sources of the same platform and kind with the file. */
  readonly of: number;
  /** The other sources holding it. */
  readonly with: readonly string[];
}

/** The pseudo-file concept values are indexed under; a row's leaves are concept id → { value, state? }. */
export const CONCEPTS_FILE = "@concepts";

export const scanKeys = {
  pointer: (): string => "scan/current.json",
  prefix: (gen: string): string => `scan/${gen}/`,
  sources: (gen: string): string => `scan/${gen}/_sources.json`,
  rare: (gen: string): string => `scan/${gen}/_rare.json`,
  keys: (gen: string): string => `scan/${gen}/_keys.json`,
  fileIndex: (gen: string, file: string): string => `scan/${gen}/f/${encodeURIComponent(file || "_root")}.idx.json`,
  fileData: (gen: string, file: string): string => `scan/${gen}/f/${encodeURIComponent(file || "_root")}.dat`,
} as const;

/** A raw key's file and path: `carrier.plist:apns[0].apn` → [`carrier.plist`, `apns[0].apn`]; `apns[0].apn` → [``, ...]. */
export function splitRawKey(key: string): readonly [file: string, path: string] {
  const colon = key.indexOf(":");
  const bracket = key.indexOf("[");
  if (colon < 0 || (bracket >= 0 && bracket < colon)) return ["", key];
  return [key.slice(0, colon), key.slice(colon + 1)];
}

/** First path segment, the shard a query reads: `apns[*].x` → `apns`. */
export function topKey(path: string): string {
  return path.split(/[.[]/, 1)[0] ?? path;
}

/** JSON with object keys sorted: equal values, equal strings. */
export function stable(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k] ?? null)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** One source's leaves, grouped by file: what packShards and rareSettings take. */
export interface ScanEntry {
  readonly source: string;
  /** `<platform>:<kind>`: rarity is judged among sources of the same platform and kind. */
  readonly group: string;
  /** The file rarity is judged in: the platform's main settings file (`carrier.plist`, `config`). */
  readonly main: string;
  readonly files: Readonly<Record<string, Readonly<Record<string, Json>>>>;
}

/** Pack every entry into one `{ index, data }` pair per file. Entries are taken in the order given. */
export function packShards(entries: readonly ScanEntry[]): Map<string, { index: ScanFileIndex; data: Uint8Array }> {
  type Shard = { at: number[]; rows: Record<string, Json>[] };
  type FileShards = { srcs: string[]; tops: Map<string, Shard> };
  const byFile = new Map<string, FileShards>();
  for (const { source, files } of entries) {
    for (const [file, leaves] of Object.entries(files)) {
      const f: FileShards = byFile.get(file) ?? { srcs: [], tops: new Map() };
      byFile.set(file, f);
      const at = f.srcs.push(source) - 1;
      const mine = new Map<string, Record<string, Json>>();
      for (const [path, value] of Object.entries(leaves)) {
        const top = topKey(path);
        const row = mine.get(top) ?? {};
        mine.set(top, row);
        row[path] = value;
      }
      for (const [top, row] of mine) {
        const shard: Shard = f.tops.get(top) ?? { at: [], rows: [] };
        f.tops.set(top, shard);
        shard.at.push(at);
        shard.rows.push(row);
      }
    }
  }
  const enc = new TextEncoder();
  const out = new Map<string, { index: ScanFileIndex; data: Uint8Array }>();
  for (const [file, { srcs, tops }] of byFile) {
    const shards: Record<string, readonly [number, number]> = {};
    const parts: Uint8Array[] = [];
    let offset = 0;
    for (const [top, shard] of [...tops].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const bytes = enc.encode(JSON.stringify(shard));
      shards[top] = [offset, bytes.length];
      parts.push(bytes);
      offset += bytes.length;
    }
    const data = new Uint8Array(offset);
    let at = 0;
    for (const p of parts) {
      data.set(p, at);
      at += p.length;
    }
    out.set(file, { index: { srcs, shards }, data });
  }
  return out;
}

/** A path counts as a setting, not an identifier, when its values repeat: few distinct values for many holders. */
const isSetting = (distinct: number, present: number): boolean => present >= 15 && distinct <= Math.max(4, present / 10);

const wildcard = (path: string): string => path.replace(/\[\d+\]/g, "[*]");

/**
 * For every source, the settings in its main file it shares with at most `max` others
 * of its group: keys almost nobody sets, and values almost nobody picks for a
 * key many set. Identifiers (names, URLs, APNs) are skipped: their values
 * never repeat. The v1 algorithm (keyscan.ts rareSettings), over Profile.raw.
 */
export function rareSettings(entries: readonly ScanEntry[], max = 3, keep = 30): Record<string, RareSetting[]> {
  const out: Record<string, RareSetting[]> = {};
  for (const group of new Set(entries.map((e) => e.group))) {
    const mine = entries.flatMap((e) => {
      const leaves = e.group === group ? e.files[e.main] : undefined;
      return leaves ? [{ source: e.source, leaves }] : [];
    });
    // Per source: wildcard path → the set of values it holds there.
    const held = mine.map(({ source, leaves }) => {
      const paths = new Map<string, Set<string>>();
      for (const [p, v] of Object.entries(leaves)) {
        const k = wildcard(p);
        const values = paths.get(k) ?? new Set<string>();
        paths.set(k, values);
        values.add(stable(v));
      }
      return { source, paths };
    });
    const present = new Map<string, string[]>();
    const holders = new Map<string, string[]>();
    const distinct = new Map<string, Set<string>>();
    const push = (m: Map<string, string[]>, k: string, name: string): void => {
      const l = m.get(k) ?? [];
      m.set(k, l);
      l.push(name);
    };
    for (const { source: name, paths } of held) {
      for (const [p, values] of paths) {
        push(present, p, name);
        const d = distinct.get(p) ?? new Set<string>();
        distinct.set(p, d);
        for (const value of values) {
          d.add(value);
          push(holders, `${p}\0${value}`, name);
        }
      }
    }
    const of = mine.length;
    for (const { source: name, paths } of held) {
      const others = (names: readonly string[]): string[] => names.filter((n) => n !== name);
      const found: RareSetting[] = [];
      for (const [path, values] of paths) {
        const setBy = present.get(path) ?? [];
        if (setBy.length <= max && of >= 50) {
          found.push({ path, holders: setBy.length, of, with: others(setBy) });
          continue;
        }
        if (!isSetting(distinct.get(path)?.size ?? 0, setBy.length)) continue;
        for (const value of values) {
          const h = holders.get(`${path}\0${value}`) ?? [];
          if (h.length <= max) found.push({ path, value, holders: h.length, of, with: others(h) });
        }
      }
      // A rare key's leaves all say the same thing: keep its shortest path only.
      found.sort((a, b) => a.holders - b.holders || a.path.length - b.path.length || a.path.localeCompare(b.path));
      const tops = new Map<string, number>();
      out[name] = found
        .filter((r) => {
          const t = topKey(r.path);
          const n = tops.get(t) ?? 0;
          tops.set(t, n + 1);
          return r.value !== undefined ? n < 3 : n < 1;
        })
        .slice(0, keep);
    }
  }
  return out;
}
