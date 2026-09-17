/**
 * Cross-carrier lookup for a single setting.
 *
 * Answers "what do other operators put here?" for a key path the reader is
 * already looking at. Bounded by design: a scan fans out to one bundle per
 * carrier, so the scope is capped and the result says when it was truncated.
 */

import { openIpcc, decodeFile } from "./ipcc";
import { compareVersions, type CarrierSummary, type BundleRef, type CountrySummary } from "./manifest";

export type Fetcher = (url: string) => Promise<Uint8Array>;

export interface ScanHit {
  name: string;
  display: string;
  cc?: string;
  os: string;
  build: string;
  url: string;
  /** undefined = the key is absent from this bundle. */
  value?: unknown;
  present: boolean;
  error?: string;
}

export interface ScanResult {
  path: string;
  file: string;
  scope: string;
  scanned: number;
  truncated: boolean;
  candidates: number;
  /** Distinct values, most common first. `present: false` is the absent bucket. */
  buckets: Array<{ value: unknown; present: boolean; count: number; carriers: string[] }>;
  hits: ScanHit[];
}

const MAX_SCAN = 120;

const ABSENT = "<absent>";

function readPath(root: unknown, path: string): unknown {
  let cur = root;
  // Accepts a.b[0].c as well as plain a.b.c
  for (const part of path.split(".")) {
    if (cur == null) return undefined;
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) return undefined;
    if (m[1]) {
      if (typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[m[1]];
    }
    for (const idx of m[2].match(/\d+/g) ?? []) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(idx)];
    }
  }
  return cur;
}

function stableKey(v: unknown): string {
  if (v === undefined) return ABSENT;
  const seen = new WeakSet<object>();
  const walk = (x: unknown): unknown => {
    if (x === null || typeof x !== "object") return x;
    if (seen.has(x)) return "[circular]";
    seen.add(x);
    if (Array.isArray(x)) return x.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(x as object).sort()) out[k] = walk((x as Record<string, unknown>)[k]);
    return out;
  };
  try {
    return JSON.stringify(walk(v));
  } catch {
    return String(v);
  }
}

export interface ScanTarget { name: string; display: string; cc?: string; ref: BundleRef }

/** Pick one bundle per carrier: the newest published within the scope. */
export function scanTargets(
  scope: string,
  carriers: CarrierSummary[],
  refs: Record<string, BundleRef[]>,
  countries: CountrySummary[],
): ScanTarget[] {
  if (scope === "countries") {
    const best = new Map<string, CountrySummary>();
    for (const c of countries) {
      if (c.family !== "iPhone") continue;
      const prev = best.get(c.id);
      if (!prev || compareVersions(c.version, prev.version) > 0) best.set(c.id, c);
    }
    return [...best.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => ({
        name: c.id,
        display: c.id,
        ref: { os: c.minOS ?? "", build: c.version, url: c.url, productType: "iPhone" },
      }));
  }

  const cc = scope.startsWith("country:") ? scope.slice(8).toLowerCase() : null;
  const picked: ScanTarget[] = [];
  for (const c of carriers) {
    if (cc && c.cc !== cc) continue;
    const list = (refs[c.name] ?? []).filter(
      (r) => r.os !== "legacy" && (!r.productType || r.productType === "iPhone"),
    );
    if (!list.length) continue;
    // Merged lists are already ordered the way a phone would choose.
    const newest = list.some((r) => r.source === "image")
      ? list[0]
      : list.reduce((a, b) => (compareVersions(b.os, a.os) > 0 ? b : a));
    picked.push({ name: c.name, display: c.display, cc: c.cc, ref: newest });
  }
  // Prefer the most actively maintained bundles when the scope has to be cut.
  picked.sort((a, b) => compareVersions(b.ref.os, a.ref.os) || a.name.localeCompare(b.name));
  return picked;
}

export async function keyScan(
  targets: ScanTarget[],
  file: string,
  path: string,
  fetchUpstream: Fetcher,
  scope: string,
  limit = 40,
): Promise<ScanResult> {
  const capped = Math.min(Math.max(limit, 1), MAX_SCAN);
  const use = targets.slice(0, capped);
  const hits: ScanHit[] = [];
  const CONCURRENCY = 8;

  for (let i = 0; i < use.length; i += CONCURRENCY) {
    const batch = use.slice(i, i + CONCURRENCY).map(async (t): Promise<ScanHit> => {
      const base: ScanHit = {
        name: t.name, display: t.display, cc: t.cc,
        os: t.ref.os, build: t.ref.build, url: t.ref.url, present: false,
      };
      try {
        const bundle = openIpcc(await fetchUpstream(t.ref.url));
        if (!bundle.info.files.some((f) => f.path === file)) return { ...base, error: "no " + file };
        const decoded = decodeFile(bundle, file);
        const root = decoded.plist ?? decoded.pri ?? decoded.text;
        const value = readPath(root, path);
        return { ...base, value, present: value !== undefined };
      } catch (e) {
        return { ...base, error: (e as Error).message };
      }
    });
    hits.push(...(await Promise.all(batch)));
  }

  const byValue = new Map<string, { value: unknown; present: boolean; count: number; carriers: string[] }>();
  for (const h of hits) {
    if (h.error) continue;
    const k = stableKey(h.value);
    const b = byValue.get(k) ?? { value: h.value ?? null, present: h.present, count: 0, carriers: [] };
    b.count++;
    if (b.carriers.length < 40) b.carriers.push(h.name);
    byValue.set(k, b);
  }

  return {
    path, file, scope,
    scanned: hits.length,
    truncated: targets.length > use.length,
    candidates: targets.length,
    buckets: [...byValue.values()].sort((a, b) => b.count - a.count),
    hits: hits.sort((a, b) => Number(b.present) - Number(a.present) || a.name.localeCompare(b.name)),
  };
}

export { readPath };
