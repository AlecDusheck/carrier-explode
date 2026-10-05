/**
 * The cross-source scan index ("what does everyone else put here?"): the head
 * Profile of every source, packed so one query is one range read.
 */

import { decoderFamily, type ConceptValue, type DecoderFamily, type Json, type Profile } from "@carrier-explode/schema/types";
import { canonical } from "@carrier-explode/values";

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
const CONCEPTS_FILE = "@concepts";

/** `carrier.plist:apns[0].apn` → [`carrier.plist`, `apns[0].apn`]; `apns[0].apn` → [``, `apns[0].apn`]. */
function splitRawKey(key: string): readonly [file: string, path: string] {
  const colon = key.indexOf(":");
  const bracket = key.indexOf("[");
  if (colon < 0 || (bracket >= 0 && bracket < colon)) return ["", key];
  return [key.slice(0, colon), key.slice(colon + 1)];
}

/** The shard a query reads: `apns[*].x` → `apns`. */
export function topKey(path: string): string {
  return path.split(/[.[]/, 1)[0] ?? path;
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

/** The file rarity is judged in, per decoder. */
const MAIN_FILE = { apple: "carrier.plist", android: "config" } as const satisfies Record<DecoderFamily, string>;

/** Apple signature hash lists and localisations are never worth comparing across sources. */
const scannable = (file: string): boolean => !file.startsWith("signatures/") && !file.includes(".lproj/");

const conceptLeaf = (c: ConceptValue): Json => (c.kind === "state" ? c.state : c.kind === "value" ? c.value : null);

/** A source's head Profile as the scan indexes it: its raw leaves by file, and its concepts under CONCEPTS_FILE. */
export function scanEntry(profile: Profile, source: string): ScanEntry {
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

/** Below this many holders a path's values say too little to call one of them rare. */
const MIN_HOLDERS_FOR_SETTING = 15;
/** A setting has at most this many distinct values, or one per HOLDERS_PER_DISTINCT holders when that is more. */
const MAX_DISTINCT_FLOOR = 4;
const HOLDERS_PER_DISTINCT = 10;
/** A key is rare only in a group this big; in a small one every key is held by few. */
const MIN_GROUP_FOR_RARE_KEY = 50;
/** How many rare values, and rare keys, one top-level key may contribute: a rare key's leaves all say the same. */
const VALUES_PER_TOP = 3;
const KEYS_PER_TOP = 1;
/** A setting is rare when at most this many others of the group share it. */
const MAX_SHARERS = 3;
/** Rare settings kept per source. */
const KEEP = 30;

/** A path is a setting, not an identifier, when its values repeat. */
const isSetting = (distinct: number, present: number): boolean =>
  present >= MIN_HOLDERS_FOR_SETTING && distinct <= Math.max(MAX_DISTINCT_FLOOR, present / HOLDERS_PER_DISTINCT);

function holding({ source, main, files }: ScanEntry): Holding[] {
  const leaves = files[main];
  if (!leaves) return [];
  const paths = new Map<string, Set<string>>();
  for (const [p, value] of Object.entries(leaves)) {
    const values = paths.get(wildcard(p)) ?? new Set<string>();
    paths.set(wildcard(p), values);
    values.add(canonical(value));
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

/** For every source, the rare settings in its main file. */
export function rareSettings(entries: readonly ScanEntry[]): Record<string, RareSetting[]> {
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
        if (setBy.length <= MAX_SHARERS && of >= MIN_GROUP_FOR_RARE_KEY) {
          found.push({ rare: "key", path, holders: setBy.length, of, with: others(setBy) });
        } else if (isSetting(t.distinct.get(path)?.size ?? 0, setBy.length)) {
          for (const value of values) {
            const h = t.holders.get(`${path}\0${value}`) ?? [];
            if (h.length <= MAX_SHARERS) found.push({ rare: "value", path, value, holders: h.length, of, with: others(h) });
          }
        }
      }
      out[source] = rarestFirst(found).slice(0, KEEP);
    }
  }
  return out;
}

/** Rarest first, at most KEYS_PER_TOP rare keys and VALUES_PER_TOP rare values per top-level key. */
function rarestFirst(found: RareSetting[]): RareSetting[] {
  found.sort((a, b) => a.holders - b.holders || a.path.length - b.path.length || a.path.localeCompare(b.path));
  const seen = new Map<string, number>();
  return found.filter((r) => {
    const top = topKey(r.path);
    const n = seen.get(top) ?? 0;
    seen.set(top, n + 1);
    return n < (r.rare === "value" ? VALUES_PER_TOP : KEYS_PER_TOP);
  });
}
