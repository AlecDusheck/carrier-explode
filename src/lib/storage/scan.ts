/**
 * The cross-source scan index ("what does everyone else put here?"): the head
 * Profile of every source, packed so one query is one range read.
 */

import type { Json } from "../schema/index.ts";

export const SCAN_FORMAT = 2;

/** Name of the file for raw keys without one (Android `apns[0].apn`). */
const ROOT_FILE = "_root";

export const scanKeys = {
  /** ScanPointer, written last. */
  pointer: (): string => "scan/current.json",
  prefix: (gen: string): string => `scan/${gen}/`,
  /** ScanSources. */
  sources: (gen: string): string => `scan/${gen}/_sources.json`,
  /** sourceKey → RareSetting[]. */
  rare: (gen: string): string => `scan/${gen}/_rare.json`,
  /** Every key of the generation, so a later build deletes it in one pass. */
  keys: (gen: string): string => `scan/${gen}/_keys.json`,
  fileIndex: (gen: string, file: string): string => `scan/${gen}/f/${encodeURIComponent(file || ROOT_FILE)}.idx.json`,
  /** The file's shards, concatenated; ScanFileIndex.shards locates each. */
  fileData: (gen: string, file: string): string => `scan/${gen}/f/${encodeURIComponent(file || ROOT_FILE)}.dat`,
} as const satisfies Record<string, (...args: never[]) => string>;

export interface ScanPointer {
  readonly format: typeof SCAN_FORMAT;
  readonly gen: string;
  readonly builtAt: string;
  readonly sources: number;
  /** Kept for readers still holding it; the next build deletes it. */
  readonly previous: string | null;
  /** Hash of the head set and PROFILE_SCHEMA it was built from. */
  readonly heads: string;
  /** False when a source failed, so the next run rebuilds even with the same heads. */
  readonly complete: boolean;
}

export interface ScanSource {
  readonly source: string;
  readonly sha: string;
  readonly version: string;
}

export interface ScanSources {
  readonly sources: readonly ScanSource[];
}

export interface ScanFileIndex {
  /** sourceKeys of the sources that have this file. */
  readonly srcs: readonly string[];
  /** Top-level key → [offset, length] in the `.dat` object. */
  readonly shards: Readonly<Record<string, readonly [number, number]>>;
}

/** One source's leaves under one top-level key. */
export type ScanRow = Readonly<Record<string, Json>>;

/** `rows[i]` belongs to `srcs[at[i]]`. */
export interface ScanShard {
  readonly at: readonly number[];
  readonly rows: readonly ScanRow[];
}

/** A setting at most a few sources of the same platform and kind share: a key almost nobody sets, or a value almost nobody picks. */
export type RareSetting = {
  /** Array positions as `[*]`: `apns[*].type-mask`. */
  readonly path: string;
  readonly holders: number;
  readonly of: number;
  /** The other holders. */
  readonly with: readonly string[];
} & ({ readonly rare: "key" } | { readonly rare: "value"; readonly value: string });

/** The file concept values are indexed under: concept id → state or value. */
export const CONCEPTS_FILE = "@concepts";

/** `carrier.plist:apns[0].apn` → [`carrier.plist`, `apns[0].apn`]; `apns[0].apn` → [``, `apns[0].apn`]. */
export function splitRawKey(key: string): readonly [file: string, path: string] {
  const colon = key.indexOf(":");
  const bracket = key.indexOf("[");
  if (colon < 0 || (bracket >= 0 && bracket < colon)) return ["", key];
  return [key.slice(0, colon), key.slice(colon + 1)];
}

/** The shard a query reads: `apns[*].x` → `apns`. */
export function topKey(path: string): string {
  return path.split(/[.[]/, 1)[0] ?? path;
}

/** JSON with sorted object keys: equal values give equal strings. */
export function stable(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k] ?? null)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface ScanEntry {
  readonly source: string;
  /** `<platform>:<kind>`: rarity is judged within a group. */
  readonly group: string;
  /** The file rarity is judged in (`carrier.plist`, `config`). */
  readonly main: string;
  /** file → path → value. */
  readonly files: Readonly<Record<string, Readonly<Record<string, Json>>>>;
}

interface Packing {
  readonly srcs: string[];
  readonly tops: Map<string, { at: number[]; rows: Record<string, Json>[] }>;
}

/** One `{ index, data }` per file, sources in the order given. */
export function packShards(entries: readonly ScanEntry[]): Map<string, { index: ScanFileIndex; data: Uint8Array }> {
  const byFile = new Map<string, Packing>();
  for (const { source, files } of entries) {
    for (const [file, leaves] of Object.entries(files)) {
      const f: Packing = byFile.get(file) ?? { srcs: [], tops: new Map() };
      byFile.set(file, f);
      const at = f.srcs.push(source) - 1;
      for (const [top, row] of rowsByTop(leaves)) {
        const shard = f.tops.get(top) ?? { at: [], rows: [] };
        f.tops.set(top, shard);
        shard.at.push(at);
        shard.rows.push(row);
      }
    }
  }
  return new Map([...byFile].map(([file, packing]) => [file, encode(packing)]));
}

function rowsByTop(leaves: Readonly<Record<string, Json>>): Map<string, Record<string, Json>> {
  const rows = new Map<string, Record<string, Json>>();
  for (const [path, value] of Object.entries(leaves)) {
    const top = topKey(path);
    const row = rows.get(top) ?? {};
    rows.set(top, row);
    row[path] = value;
  }
  return rows;
}

function encode({ srcs, tops }: Packing): { index: ScanFileIndex; data: Uint8Array } {
  const enc = new TextEncoder();
  const parts = [...tops]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([top, shard]) => ({ top, bytes: enc.encode(JSON.stringify(shard)) }));
  const shards: Record<string, readonly [number, number]> = {};
  const data = new Uint8Array(parts.reduce((n, p) => n + p.bytes.length, 0));
  let offset = 0;
  for (const { top, bytes } of parts) {
    shards[top] = [offset, bytes.length];
    data.set(bytes, offset);
    offset += bytes.length;
  }
  return { index: { srcs, shards }, data };
}

/** One source's main-file paths (array positions as `[*]`) and the values it holds at each. */
interface Holding {
  readonly source: string;
  readonly paths: ReadonlyMap<string, ReadonlySet<string>>;
}

interface Tally {
  /** path → sources setting it. */
  readonly present: Map<string, string[]>;
  /** `path\0value` → sources holding it. */
  readonly holders: Map<string, string[]>;
  /** path → its distinct values. */
  readonly distinct: Map<string, Set<string>>;
}

const wildcard = (path: string): string => path.replace(/\[\d+\]/g, "[*]");

/** A path is a setting, not an identifier, when its values repeat. */
const isSetting = (distinct: number, present: number): boolean => present >= 15 && distinct <= Math.max(4, present / 10);

function holding({ source, main, files }: ScanEntry): Holding[] {
  const leaves = files[main];
  if (!leaves) return [];
  const paths = new Map<string, Set<string>>();
  for (const [p, value] of Object.entries(leaves)) {
    const values = paths.get(wildcard(p)) ?? new Set<string>();
    paths.set(wildcard(p), values);
    values.add(stable(value));
  }
  return [{ source, paths }];
}

function tally(group: readonly Holding[]): Tally {
  const t: Tally = { present: new Map(), holders: new Map(), distinct: new Map() };
  const push = (m: Map<string, string[]>, k: string, source: string): void => {
    m.set(k, [...(m.get(k) ?? []), source]);
  };
  for (const { source, paths } of group) {
    for (const [p, values] of paths) {
      push(t.present, p, source);
      const d = t.distinct.get(p) ?? new Set<string>();
      t.distinct.set(p, d);
      for (const value of values) {
        d.add(value);
        push(t.holders, `${p}\0${value}`, source);
      }
    }
  }
  return t;
}

/** For every source, the rare settings in its main file: shared with at most `max` others of its group. */
export function rareSettings(entries: readonly ScanEntry[], max = 3, keep = 30): Record<string, RareSetting[]> {
  const out: Record<string, RareSetting[]> = {};
  for (const group of new Set(entries.map((e) => e.group))) {
    const members = entries.filter((e) => e.group === group).flatMap(holding);
    const t = tally(members);
    const of = members.length;
    for (const { source, paths } of members) {
      const others = (names: readonly string[]): string[] => names.filter((n) => n !== source);
      const found: RareSetting[] = [];
      for (const [path, values] of paths) {
        const setBy = t.present.get(path) ?? [];
        if (setBy.length <= max && of >= 50) {
          found.push({ rare: "key", path, holders: setBy.length, of, with: others(setBy) });
        } else if (isSetting(t.distinct.get(path)?.size ?? 0, setBy.length)) {
          for (const value of values) {
            const h = t.holders.get(`${path}\0${value}`) ?? [];
            if (h.length <= max) found.push({ rare: "value", path, value, holders: h.length, of, with: others(h) });
          }
        }
      }
      out[source] = rarestFirst(found).slice(0, keep);
    }
  }
  return out;
}

/** Rarest first; a rare key's leaves all say the same, so one per top-level key (three for values). */
function rarestFirst(found: RareSetting[]): RareSetting[] {
  found.sort((a, b) => a.holders - b.holders || a.path.length - b.path.length || a.path.localeCompare(b.path));
  const seen = new Map<string, number>();
  return found.filter((r) => {
    const top = topKey(r.path);
    const n = seen.get(top) ?? 0;
    seen.set(top, n + 1);
    return r.rare === "value" ? n < 3 : n < 1;
  });
}
