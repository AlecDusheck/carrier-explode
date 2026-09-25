/** Structural diff over decoded values, keyed collections, and file by file over two bundles. */

import { decodeFile, decodedPlist, type DecodedFile, type OpenedBundle } from "./bundle";
import { isJsonDict, isRecord } from "./plist";
import type { PriDecoded } from "./pri";

export type DiffKind = "added" | "removed" | "changed" | "same";

export interface DiffRow {
  path: string;
  kind: DiffKind;
  a?: unknown;
  b?: unknown;
}

export type DiffCounts = Record<DiffKind, number>;

/** Canonical text of a JSON-like value: dict keys sorted, so equal values give equal strings. `memo` caches containers already seen. */
export function stable(v: unknown, memo?: WeakMap<object, string>): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v !== "object") return JSON.stringify(v);
  const hit = memo?.get(v);
  if (hit !== undefined) return hit;
  const out = Array.isArray(v)
    ? `[${v.map((x) => stable(x, memo)).join(",")}]`
    : isRecord(v)
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k], memo)}`).join(",")}}`
      : JSON.stringify(v);
  memo?.set(v, out);
  return out;
}

/** Past this many cells the LCS table costs more than it saves; align by index instead. */
const LCS_LIMIT = 4_000_000;

/** Index pairs [i, j] of an LCS over the stable forms of two arrays. */
function lcs(x: string[], y: string[]): Array<[number, number]> {
  const n = x.length, m = y.length;
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
  }
  const out: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (x[i] === y[j]) { out.push([i, j]); i++; j++; }
    else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
    else j++;
  }
  return out;
}

/**
 * Rows for every leaf that differs. Arrays are aligned on their longest common
 * subsequence, so an entry inserted mid-list is one "added" row, not a cascade;
 * unmatched entries between anchors are paired up and diffed in place.
 */
export function diffValues(a: unknown, b: unknown, includeSame = false): DiffRow[] {
  const rows: DiffRow[] = [];
  const memo = new WeakMap<object, string>();
  const key = (v: unknown) => stable(v, memo);
  walk("", a, b);
  return rows;

  function same(path: string, x: unknown, y: unknown) {
    if (includeSame) rows.push({ path, kind: "same", a: x, b: y });
  }

  function walk(path: string, x: unknown, y: unknown) {
    if (x === undefined && y === undefined) return;
    if (x === undefined) { rows.push({ path, kind: "added", b: y }); return; }
    if (y === undefined) { rows.push({ path, kind: "removed", a: x }); return; }
    if (isJsonDict(x) && isJsonDict(y)) {
      for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
        walk(path ? `${path}.${k}` : k, x[k], y[k]);
      }
      return;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      const sx = x.map(key), sy = y.map(key);
      // Common head and tail match as they are; only the middle needs aligning.
      let head = 0;
      while (head < sx.length && head < sy.length && sx[head] === sy[head]) head++;
      let tail = 0;
      while (tail < sx.length - head && tail < sy.length - head && sx[sx.length - 1 - tail] === sy[sy.length - 1 - tail]) tail++;
      if (head === sx.length && head === sy.length) { same(path, x, y); return; }
      for (let k = 0; k < head; k++) same(`${path}[${k}]`, x[k], y[k]);
      const mx = sx.slice(head, sx.length - tail), my = sy.slice(head, sy.length - tail);
      const anchors: Array<[number, number]> = (mx.length * my.length <= LCS_LIMIT ? lcs(mx, my) : []).map(([i, j]) => [i + head, j + head]);
      anchors.push([x.length - tail, y.length - tail]);
      let i = head, j = head;
      for (const [ai, bj] of anchors) {
        // Pair the unmatched run positionally, then report the leftovers.
        while (i < ai && j < bj) walk(`${path}[${j}]`, x[i++], y[j++]);
        while (i < ai) { walk(`${path}[${i}]`, x[i], undefined); i++; }
        while (j < bj) { walk(`${path}[${j}]`, undefined, y[j]); j++; }
        if (ai < x.length - tail) { same(`${path}[${bj}]`, x[ai], y[bj]); i++; j++; }
      }
      for (let k = 0; k < tail; k++) same(`${path}[${y.length - tail + k}]`, x[x.length - tail + k], y[y.length - tail + k]);
      return;
    }
    if (key(x) === key(y)) { same(path, x, y); return; }
    rows.push({ path, kind: "changed", a: x, b: y });
  }
}

export function summariseDiff(rows: DiffRow[]): DiffCounts {
  const counts: DiffCounts = { added: 0, removed: 0, changed: 0, same: 0 };
  for (const r of rows) counts[r.kind]++;
  return counts;
}

/** A PRI keyed by setting name/path, so a moved setting is not reported as changed. */
function priComparable(p: PriDecoded): Record<string, unknown> {
  const byKey = <T>(xs: T[], key: (x: T) => string, val: (x: T) => unknown) => {
    const out: Record<string, unknown> = {};
    for (const x of xs) {
      const k = key(x);
      out[k] = k in out ? [out[k], val(x)].flat() : val(x);
    }
    return out;
  };
  return {
    header: p.header,
    named: byKey(p.named, (x) => x.name, (x) => x.value.text),
    efs: byKey(p.efs, (x) => x.path, (x) => x.value.text),
    featureGroups: byKey(p.featureGroups, (x) => x.name, (x) => x.bits),
    nvItems: p.nvItems,
    schema: p.schema.paths,
    unknown: byKey(p.unknown, (x) => x.tag, (x) => x.hex),
  };
}

/** What a decoded file is diffed as: its value tree, its PRI settings, or its lines. */
export function comparable(d: DecodedFile): unknown {
  if (d.kind === "pri-der") return priComparable(d.pri);
  const plist = decodedPlist(d);
  if (plist !== undefined) return plist;
  if (d.text !== undefined) return d.text.split("\n");
  return d.hex ?? null;
}

export interface FileDiff {
  path: string;
  kind: DiffKind;
  rows: DiffRow[];
  counts: DiffCounts;
  /** Rows beyond `maxRows` were dropped. */
  truncated: boolean;
}

export interface BundleDiff {
  files: FileDiff[];
  /** File-level counts. */
  counts: DiffCounts;
  /** Paths present in both bundles. */
  shared: string[];
}

export interface CompareOptions {
  /** Only this member. */
  path?: string;
  /** Keep byte-identical files in `files`. */
  includeSame?: boolean;
  /** Cap on rows per file (default 400). */
  maxRows?: number;
}

export interface KeyedDiffOptions {
  /** Cap on rows per key (default 400). */
  maxRows?: number;
  /** Keep keys whose values match. */
  includeSame?: boolean;
}

/** Key-by-key diff of two keyed collections: a key only on one side is added or removed, one on both is diffed as a value. */
export function diffKeyed(a: Record<string, unknown>, b: Record<string, unknown>, opts: KeyedDiffOptions = {}): FileDiff[] {
  const max = opts.maxRows ?? 400;
  const out: FileDiff[] = [];
  for (const path of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const inA = Object.hasOwn(a, path), inB = Object.hasOwn(b, path);
    const rows = inA && inB ? diffValues(a[path], b[path]) : [];
    const kind: DiffKind = !inA ? "added" : !inB ? "removed" : rows.length ? "changed" : "same";
    if (kind === "same" && !opts.includeSame) continue;
    out.push({ path, kind, rows: rows.slice(0, max), counts: summariseDiff(rows), truncated: rows.length > max });
  }
  return out;
}

function bytesEqual(x: Uint8Array, y: Uint8Array): boolean {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

function decodedOrNull(o: OpenedBundle, path: string): unknown {
  try {
    return comparable(decodeFile(o, path));
  } catch {
    return null;
  }
}

/** File-by-file diff of bundle `a` (before/left) against `b` (after/right). */
export function compareBundles(a: OpenedBundle, b: OpenedBundle, opts: CompareOptions = {}): BundleDiff {
  const pa = new Set(a.info.files.map((f) => f.path));
  const pb = new Set(b.info.files.map((f) => f.path));
  const all = opts.path ? [opts.path] : [...new Set([...pa, ...pb])].sort();
  const counts: DiffCounts = { added: 0, removed: 0, changed: 0, same: 0 };
  const same: FileDiff[] = [];
  // Only files whose bytes differ are decoded; added and removed ones link to the file itself, so their value is never read.
  const va: Record<string, unknown> = {}, vb: Record<string, unknown> = {};
  for (const path of all) {
    const inA = pa.has(path), inB = pb.has(path);
    if (!inA && !inB) continue;
    if (inA && inB && bytesEqual(a.entries[a.prefix + path], b.entries[b.prefix + path])) {
      counts.same++;
      if (opts.includeSame) same.push({ path, kind: "same", rows: [], counts: summariseDiff([]), truncated: false });
      continue;
    }
    counts[!inA ? "added" : !inB ? "removed" : "changed"]++;
    if (inA) va[path] = inB ? decodedOrNull(a, path) : null;
    if (inB) vb[path] = inA ? decodedOrNull(b, path) : null;
  }
  // Bytes that differ make a changed file even when the decoded values match.
  const differ = diffKeyed(va, vb, { maxRows: opts.maxRows, includeSame: true }).map((f): FileDiff => (f.kind === "same" ? { ...f, kind: "changed" } : f));
  const files = [...same, ...differ].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  return { files, counts, shared: [...pa].filter((p) => pb.has(p)).sort() };
}
