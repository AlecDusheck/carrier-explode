/** Structural diff over decoded plists, used for version-to-version and carrier-to-carrier views. */

export type DiffKind = "added" | "removed" | "changed" | "same";

export interface DiffRow {
  path: string;
  kind: DiffKind;
  a?: unknown;
  b?: unknown;
}

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

export function diffValues(a: unknown, b: unknown, includeSame = false): DiffRow[] {
  const rows: DiffRow[] = [];
  walk("", a, b);
  return rows;

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
      const n = Math.max(x.length, y.length);
      if (stable(x) === stable(y)) {
        if (includeSame) rows.push({ path, kind: "same", a: x, b: y });
        return;
      }
      for (let i = 0; i < n; i++) walk(`${path}[${i}]`, x[i], y[i]);
      return;
    }
    if (stable(x) === stable(y)) {
      if (includeSame) rows.push({ path, kind: "same", a: x, b: y });
      return;
    }
    rows.push({ path, kind: "changed", a: x, b: y });
  }
}

export function summariseDiff(rows: DiffRow[]) {
  const counts = { added: 0, removed: 0, changed: 0, same: 0 };
  for (const r of rows) counts[r.kind]++;
  return counts;
}
