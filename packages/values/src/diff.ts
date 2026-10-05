/** Structural diff over decoded values. */

import { canonical, isRecord } from "./canonical.ts";

export type DiffKind = "added" | "removed" | "changed" | "same";

export interface DiffRow {
  path: string;
  kind: DiffKind;
  a?: unknown;
  b?: unknown;
}

export type DiffCounts = Record<DiffKind, number>;

/** Past this many cells the LCS table costs more than it saves; align by index instead. */
const LCS_LIMIT = 4_000_000;

/** Index pairs [i, j] of an LCS over the canonical forms of two arrays. */
function lcs(x: string[], y: string[]): Array<[number, number]> {
  const n = x.length, m = y.length;
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  const at = (k: number): number => t[k] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = x[i] === y[j] ? at((i + 1) * w + j + 1) + 1 : Math.max(at((i + 1) * w + j), at(i * w + j + 1));
    }
  }
  const out: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (x[i] === y[j]) { out.push([i, j]); i++; j++; }
    else if (at((i + 1) * w + j) >= at(i * w + j + 1)) i++;
    else j++;
  }
  return out;
}

/**
 * Rows for every leaf that differs. Arrays are aligned on their longest common
 * subsequence, so an entry inserted mid-list is one "added" row, not a cascade;
 * unmatched entries between anchors are paired up and diffed in place. `isDict`
 * says which objects to walk into: a format whose scalars are objects (plist
 * data, dates) passes its own.
 */
export function diffValues(a: unknown, b: unknown, isDict: (v: unknown) => v is Record<string, unknown> = isRecord): DiffRow[] {
  const rows: DiffRow[] = [];
  const memo = new WeakMap<object, string>();
  const key = (v: unknown): string => canonical(v, memo);
  walk("", a, b);
  return rows;

  function walk(path: string, x: unknown, y: unknown): void {
    if (x === undefined && y === undefined) return;
    if (x === undefined) { rows.push({ path, kind: "added", b: y }); return; }
    if (y === undefined) { rows.push({ path, kind: "removed", a: x }); return; }
    if (isDict(x) && isDict(y)) {
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
      if (head === sx.length && head === sy.length) return;
      const mx = sx.slice(head, sx.length - tail), my = sy.slice(head, sy.length - tail);
      const anchors: Array<[number, number]> = (mx.length * my.length <= LCS_LIMIT ? lcs(mx, my) : []).map(([i, j]) => [i + head, j + head]);
      anchors.push([x.length - tail, y.length - tail]);
      let i = head, j = head;
      for (const [ai, bj] of anchors) {
        // Pair the unmatched run positionally, then report the leftovers.
        while (i < ai && j < bj) walk(`${path}[${j}]`, x[i++], y[j++]);
        while (i < ai) { walk(`${path}[${i}]`, x[i], undefined); i++; }
        while (j < bj) { walk(`${path}[${j}]`, undefined, y[j]); j++; }
        if (ai < x.length - tail) { i++; j++; }
      }
      return;
    }
    if (key(x) !== key(y)) rows.push({ path, kind: "changed", a: x, b: y });
  }
}

export function summariseDiff(rows: readonly DiffRow[]): DiffCounts {
  const counts: DiffCounts = { added: 0, removed: 0, changed: 0, same: 0 };
  for (const r of rows) counts[r.kind]++;
  return counts;
}
