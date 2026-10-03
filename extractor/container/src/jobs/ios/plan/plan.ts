/** Which iOS builds to extract: a pure port of scripts/plan_system_bundles.py. */

import { compareProducts, compareVersions, isPrerelease } from "../../../../../../src/lib/decode/index.ts";

export interface IpswRef {
  readonly device: string;
  readonly url: string;
}

/** ios.plan's output entry (extractor/src/jobs.ts). `label` is what pages show: "27.2 beta 2". */
export interface PlannedBuild {
  readonly build: string;
  readonly version: string;
  readonly label: string;
  readonly released?: string;
  readonly prerelease: boolean;
  /** The first IPSW names the image. */
  readonly ipsws: readonly IpswRef[];
}

/** An image in the bucket. */
export interface Held {
  readonly build: string;
  readonly version: string;
  readonly devices: readonly string[];
  readonly released?: string;
  readonly prerelease: boolean;
}

/** One device's catalogue entry for one build. */
export interface Fw {
  readonly version: string;
  readonly build: string;
  readonly device: string;
  readonly released?: string;
}

export interface PlanOptions {
  /** Exactly this version, held or not. */
  readonly only?: string;
  /** Floor; default the oldest image held. */
  readonly since?: string;
  readonly cap: number;
}

const byVersion = (a: { readonly version: string }, b: { readonly version: string }): number => compareVersions(a.version, b.version);

/**
 * Builds to extract, oldest first so history fills in order: every one above the floor not held.
 * `preferred` keeps images comparable; `fallback` (the newest iPhone) covers releases it no longer gets.
 */
export function plan(held: readonly Held[], preferred: readonly Fw[], fallback: readonly Fw[], o: PlanOptions): Fw[] {
  const builds = new Set(held.map((h) => h.build));
  const heldFrom = new Map(held.map((h) => [h.version, h.devices]));
  const floor = o.since ?? held.map((h) => h.version).sort(compareVersions)[0];

  const chosen = new Map<string, Fw>();
  // Preferred last, so it wins a version both list.
  for (const fw of [...fallback, ...preferred]) {
    if (o.only !== undefined) {
      if (fw.version !== o.only) continue;
    } else {
      if (builds.has(fw.build)) continue;
      if (floor !== undefined && compareVersions(fw.version, floor) < 0) continue;
      // Held as another device's build: this device's build of the version differs for that reason alone.
      if (heldFrom.get(fw.version)?.includes(fw.device) === false) continue;
    }
    chosen.set(fw.version, fw);
  }
  const out = [...chosen.values()].sort(byVersion);
  // An empty bucket starts from the newest, not from all of history.
  if (floor === undefined && o.only === undefined) return out.slice(-1);
  return out.slice(0, o.cap);
}

/** One entry per IPSW file (phones share files): `first`'s leads, then the newest phone's. */
export function distinctIpsws(pairs: readonly IpswRef[], first: string): IpswRef[] {
  const ordered = [...pairs].sort((a, b) => Number(a.device !== first) - Number(b.device !== first) || compareProducts(b.device, a.device));
  const byUrl = new Map<string, string>();
  for (const p of ordered) if (!byUrl.has(p.url)) byUrl.set(p.url, p.device);
  return [...byUrl].map(([url, device]) => ({ device, url }));
}

/** 24B5089g: major 24, train B, lower-case suffix for a beta. */
const BETA_BUILD = /^(\d+)([A-Z])\d+[a-z]$/;
const RELEASE_BUILD = /^(\d+)([A-Z])\d+$/;

/** A sortable train key: 24B -> 24 * 26 + 1. */
function train(build: string): number | undefined {
  const m = BETA_BUILD.exec(build) ?? RELEASE_BUILD.exec(build);
  if (!m?.[1] || !m[2]) return undefined;
  return Number(m[1]) * 26 + (m[2].charCodeAt(0) - 65);
}

/** AppleDB beta builds past the newest public release's train, not held: betas of what comes next. */
export function betaCandidates(keys: readonly string[], held: readonly Held[], releases: readonly Fw[]): string[] {
  const have = new Set(held.map((h) => h.build));
  const trains = releases.flatMap((f) => train(f.build) ?? []);
  const newest = trains.length ? Math.max(...trains) : undefined;
  return keys.flatMap((k) => {
    const [os, build = ""] = k.split(";");
    if (os !== "iOS" || !BETA_BUILD.test(build) || have.has(build)) return [];
    const t = train(build);
    return newest === undefined || (t !== undefined && t > newest) ? [build] : [];
  });
}

/** An AppleDB firmware record (../catalog.ts). */
export interface BetaEntry {
  readonly version: string;
  readonly build: string;
  readonly beta: boolean;
  readonly released?: string;
  readonly ipsws: ReadonlyMap<string, string>;
}

/** Betas to extract, oldest first; `device`'s IPSW leads, else the newest iPhone's. */
export function planBetas(entries: readonly BetaEntry[], device: string, cap: number): PlannedBuild[] {
  const out: PlannedBuild[] = [];
  for (const e of entries) {
    const newest = [...e.ipsws.keys()].sort(compareProducts).at(-1);
    if (!e.beta || newest === undefined) continue;
    const lead = e.ipsws.has(device) ? device : newest;
    const pairs = [...e.ipsws].map(([d, url]) => ({ device: d, url }));
    out.push({ build: e.build, version: e.version, label: e.version, prerelease: true, ...(e.released ? { released: e.released } : {}), ipsws: distinctIpsws(pairs, lead) });
  }
  return out.sort(byVersion).slice(0, cap);
}

export function toBuild(fw: Fw, pairs: readonly IpswRef[]): PlannedBuild {
  return {
    build: fw.build,
    version: fw.version,
    label: fw.version,
    prerelease: isPrerelease(fw.version),
    ...(fw.released ? { released: fw.released } : {}),
    ipsws: distinctIpsws(pairs, fw.device),
  };
}

/** Every held image again, newest first, keeping its label and day; builds no catalogue lists come back in `missing`. */
export function planRebuild(held: readonly Held[], ipswsOf: (build: string) => readonly IpswRef[], device: string): { builds: PlannedBuild[]; missing: string[] } {
  const builds: PlannedBuild[] = [];
  const missing: string[] = [];
  for (const h of [...held].sort((a, b) => byVersion(b, a))) {
    const pairs = ipswsOf(h.build);
    const devices = pairs.map((p) => p.device).sort(compareProducts);
    const lead = devices.includes(device) ? device : devices.at(-1);
    if (lead === undefined) {
      missing.push(h.build);
      continue;
    }
    builds.push({
      build: h.build,
      version: h.version,
      label: h.version,
      prerelease: h.prerelease,
      ...(h.released ? { released: h.released } : {}),
      ipsws: distinctIpsws(pairs, lead),
    });
  }
  return { builds, missing };
}
