/** Leaf-path view of decoded values: `apns[0].type-mask` → 3. Used for cross-bundle lookups. */

import { decodeFile, decodedPlist, type OpenedBundle } from "./bundle";
import { comparable } from "./compare";
import { isJsonDict } from "./plist";

export type Flat = Record<string, unknown>;

/** Leaves only; tagged scalars (data, dates, big integers, UIDs) are leaves, and empty containers are kept so they stay visible. */
export function flatten(value: unknown, prefix = "", out: Flat = {}): Flat {
  if (Array.isArray(value)) {
    if (!value.length) out[prefix] = [];
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (isJsonDict(value)) {
    const keys = Object.keys(value);
    if (!keys.length && prefix) out[prefix] = {};
    for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out[prefix] = value;
  }
  return out;
}

/** Every decodable member of a bundle, flattened, keyed by member path. */
export function flattenBundle(b: OpenedBundle): Record<string, Flat> {
  const out: Record<string, Flat> = {};
  for (const f of b.info.files) {
    if (f.kind === "image" || f.kind === "binary") continue;
    try {
      const d = decodeFile(b, f.path);
      // PRIs flatten by setting name, the same view the diff uses.
      const v = d.kind === "pri-der" ? comparable(d) : decodedPlist(d);
      if (v !== undefined) out[f.path] = flatten(v);
    } catch {
      // Undecodable members simply have no leaves.
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `a[*].b` matches any index; `a.*.b` matches any single key. */
export function pathPattern(path: string): RegExp | null {
  if (!path.includes("*")) return null;
  const re = path
    .split(/(\[\*\]|\*)/)
    .map((p) => (p === "[*]" ? "\\[\\d+\\]" : p === "*" ? "[^.\\[]+" : esc(p)))
    .join("");
  return new RegExp(`^${re}$`);
}

/** Rebuild the value at `path` (leaf or container) from a flat map. */
export function lookup(flat: Flat, path: string): unknown {
  if (path in flat) return flat[path];
  const kids = Object.keys(flat).filter((k) => k.startsWith(path + ".") || k.startsWith(path + "["));
  if (!kids.length) return undefined;
  const root: Record<string, unknown> = {};
  for (const k of kids) setPath(root, k.slice(path.length), flat[k]);
  return root[""];
}

function setPath(root: Record<string, unknown>, rest: string, v: unknown) {
  // rest starts with "." or "[", relative to the container.
  const parts = [...rest.matchAll(/\.([^.[\]]+)|\[(\d+)\]/g)].map((m) => (m[2] !== undefined ? Number(m[2]) : m[1]));
  let cur: Record<string | number, unknown> = root;
  let key: string | number = "";
  for (const p of parts) {
    cur[key] ??= typeof p === "number" ? [] : {};
    cur = cur[key] as Record<string | number, unknown>;
    key = p;
  }
  cur[key] = v;
}

/** Values at every path matching `path` (wildcards allowed), in path order. */
export function lookupAll(flat: Flat, path: string): Array<{ path: string; value: unknown }> {
  const re = pathPattern(path);
  if (!re) {
    const v = lookup(flat, path);
    return v === undefined ? [] : [{ path, value: v }];
  }
  return Object.keys(flat).filter((k) => re.test(k)).sort().map((k) => ({ path: k, value: flat[k] }));
}
