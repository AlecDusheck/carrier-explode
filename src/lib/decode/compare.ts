/** Structural diff over decoded bundle files, and file-by-file diff of two bundles. */

import { decodeFile, type DecodedFile, type OpenedBundle } from "./bundle";
import type { PriDecoded } from "./pri";

export type DiffKind = "added" | "removed" | "changed" | "same";

export interface DiffRow {
  path: string;
  kind: DiffKind;
  a?: unknown;
  b?: unknown;
}

export type DiffCounts = Record<DiffKind, number>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function stable(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (isObj(v)) {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
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
  walk("", a, b);
  return rows;

  function same(path: string, x: unknown, y: unknown) {
    if (includeSame) rows.push({ path, kind: "same", a: x, b: y });
  }

  function walk(path: string, x: unknown, y: unknown) {
    if (x === undefined && y === undefined) return;
    if (x === undefined) { rows.push({ path, kind: "added", b: y }); return; }
    if (y === undefined) { rows.push({ path, kind: "removed", a: x }); return; }
    if (isObj(x) && isObj(y)) {
      for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
        walk(path ? `${path}.${k}` : k, x[k], y[k]);
      }
      return;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      const sx = x.map(stable), sy = y.map(stable);
      if (sx.length === sy.length && sx.every((s, i) => s === sy[i])) { same(path, x, y); return; }
      const anchors: Array<[number, number]> =
        x.length * y.length <= LCS_LIMIT ? lcs(sx, sy) : [];
      anchors.push([x.length, y.length]);
      let i = 0, j = 0;
      for (const [ai, bj] of anchors) {
        // Pair the unmatched run positionally, then report the leftovers.
        while (i < ai && j < bj) walk(`${path}[${j}]`, x[i++], y[j++]);
        while (i < ai) { walk(`${path}[${i}]`, x[i], undefined); i++; }
        while (j < bj) { walk(`${path}[${j}]`, undefined, y[j]); j++; }
        if (ai < x.length) { same(`${path}[${bj}]`, x[ai], y[bj]); i++; j++; }
      }
      return;
    }
    if (stable(x) === stable(y)) { same(path, x, y); return; }
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
  if (d.pri) return priComparable(d.pri);
  if (d.plist !== undefined) return d.plist;
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
  const max = opts.maxRows ?? 400;
  const pa = new Set(a.info.files.map((f) => f.path));
  const pb = new Set(b.info.files.map((f) => f.path));
  const all = opts.path ? [opts.path] : [...new Set([...pa, ...pb])].sort();
  const files: FileDiff[] = [];
  const counts: DiffCounts = { added: 0, removed: 0, changed: 0, same: 0 };

  for (const path of all) {
    const inA = pa.has(path), inB = pb.has(path);
    if (!inA && !inB) continue;
    let kind: DiffKind;
    if (!inA) kind = "added";
    else if (!inB) kind = "removed";
    else kind = bytesEqual(a.entries[a.prefix + path], b.entries[b.prefix + path]) ? "same" : "changed";
    counts[kind]++;
    if (kind === "same" && !opts.includeSame) continue;
    // Added/removed files link to the file itself; a row dump of the whole value adds nothing.
    const rows = kind === "changed" ? diffValues(decodedOrNull(a, path), decodedOrNull(b, path)) : [];
    files.push({ path, kind, rows: rows.slice(0, max), counts: summariseDiff(rows), truncated: rows.length > max });
  }
  return { files, counts, shared: [...pa].filter((p) => pb.has(p)).sort() };
}
