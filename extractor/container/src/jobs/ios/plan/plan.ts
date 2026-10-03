/**
 * Which iOS images to extract: a port of scripts/plan_system_bundles.py.
 * Pure; ./job.ts feeds it the catalogues and what the bucket holds.
 *
 * - A release is its build, not its version: Apple sometimes re-issues a
 *   version under a new build, and that is picked up. The exception is a
 *   version held from a different device, whose build differs for that reason
 *   alone.
 * - The preferred device keeps builds comparable between images; the newest
 *   iPhone covers releases the preferred one no longer receives.
 * - Every release above the floor (`since`, else the oldest image held) that is
 *   not held, oldest first and capped, so history fills in order across runs.
 *   Asking only for "latest" would skip a release whenever two ship between runs.
 * - Each build lists every distinct iPhone IPSW, the planned device's first:
 *   a bundle in an image carries only the override files of the phones that
 *   image was cut for, so every one is extracted and the copies merged, and
 *   the first names the image.
 * - Betas come from AppleDB (ipsw.me has none): every beta past the newest
 *   public release, labelled "27.2 beta 2" so it sorts below the release. A
 *   beta of a release that already shipped is not fetched: the point is to see
 *   bundle changes before they reach phones.
 */

import { compareProducts, compareVersions, isPrerelease } from "../../../../../../src/lib/decode/index.ts";

/** One IPSW: the file, and the phone it is listed under. */
export interface IpswRef {
  readonly device: string;
  readonly url: string;
}

/** A build to extract, in the shape ios.plan outputs (extractor/src/jobs.ts iosBuild). */
export interface PlannedBuild {
  readonly build: string;
  /** The version as the catalogue names it. */
  readonly version: string;
  /** What pages show: equal to version, or "27.2 beta 2" for betas. */
  readonly label: string;
  readonly released?: string;
  readonly prerelease?: boolean;
  readonly ipsws: readonly IpswRef[];
}

/** An image already in the bucket (releases/ios/<build>.json). */
export interface Held {
  readonly build: string;
  readonly version: string;
  readonly devices: readonly string[];
  readonly released?: string;
}

/** A catalogue firmware: one device's view of one build. */
export interface Fw {
  readonly version: string;
  readonly build: string;
  readonly device: string;
  readonly released?: string;
}

/** A release chosen by `plan`, before its IPSW list is filled in. */
export interface Chosen {
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
 * Releases to extract from `preferred` (the preferred device's firmwares) and
 * `fallback` (the newest iPhone's), given what is `held`.
 */
export function plan(held: readonly Held[], preferred: readonly Fw[], fallback: readonly Fw[], o: PlanOptions): Chosen[] {
  const builds = new Set(held.map((h) => h.build));
  const heldFrom = new Map(held.map((h) => [h.version, h.devices]));
  const floor = o.since ?? held.map((h) => h.version).sort(compareVersions)[0];

  const chosen = new Map<string, Chosen>();
  // Preferred last, so it wins a version both list.
  for (const fw of [...fallback, ...preferred]) {
    if (o.only !== undefined) {
      if (fw.version !== o.only) continue;
    } else {
      if (builds.has(fw.build)) continue;
      if (floor !== undefined && compareVersions(fw.version, floor) < 0) continue;
      // Held as a build of other phones: this device's build of the version differs for that reason alone.
      if (heldFrom.get(fw.version)?.includes(fw.device) === false) continue;
    }
    chosen.set(fw.version, { version: fw.version, build: fw.build, device: fw.device, ...(fw.released ? { released: fw.released } : {}) });
  }
  const out = [...chosen.values()].sort(byVersion);
  // No floor at all: just the newest rather than all of history.
  if (floor === undefined && o.only === undefined) return out.slice(-1);
  return out.slice(0, o.cap);
}

/**
 * One entry per IPSW file among `pairs` (several phones share one file):
 * `first`'s file leads, so its metadata names the image; then newest phone first.
 */
export function distinctIpsws(pairs: readonly IpswRef[], first: string): IpswRef[] {
  const ordered = [...pairs].sort((a, b) => Number(a.device !== first) - Number(b.device !== first) || compareProducts(b.device, a.device));
  const byUrl = new Map<string, string>();
  for (const p of ordered) if (!byUrl.has(p.url)) byUrl.set(p.url, p.device);
  return [...byUrl].map(([url, device]) => ({ device, url }));
}

/** 24B5089g: major 24, train B, a lower-case suffix because it is a beta. */
const BETA_BUILD = /^(\d+)([A-Z])\d+[a-z]$/;
const RELEASE_BUILD = /^(\d+)([A-Z])\d+$/;

/** A build's train, as a sortable key: 24B -> 24 * 26 + 1. */
export function train(build: string): number | undefined {
  const m = BETA_BUILD.exec(build) ?? RELEASE_BUILD.exec(build);
  if (!m?.[1] || !m[2]) return undefined;
  return Number(m[1]) * 26 + (m[2].charCodeAt(0) - 65);
}

/**
 * Beta builds in AppleDB's index worth a closer look: iOS, not held, and on a
 * later train than the newest public release (24B5089g is past 24A437, so it
 * is a beta of what comes next). Cheap, so each run fetches only a handful.
 */
export function betaCandidates(keys: readonly string[], held: readonly Held[], releases: readonly Fw[]): string[] {
  const have = new Set(held.map((h) => h.build));
  const trains = releases.flatMap((f) => train(f.build) ?? []);
  const newest = trains.length ? Math.max(...trains) : undefined;
  const out: string[] = [];
  for (const k of keys) {
    const [os, build = ""] = k.split(";");
    if (os !== "iOS" || !BETA_BUILD.test(build) || have.has(build)) continue;
    const t = train(build);
    if (newest === undefined || (t !== undefined && t > newest)) out.push(build);
  }
  return out;
}

/** An AppleDB firmware record, as ../catalog.ts parses it. */
export interface BetaEntry {
  readonly version: string;
  readonly build: string;
  readonly beta: boolean;
  readonly released?: string;
  readonly ipsws: ReadonlyMap<string, string>;
}

/** Betas to extract, oldest first: `device`'s IPSW leads, else the newest iPhone the beta has. */
export function planBetas(entries: readonly BetaEntry[], device: string, cap: number): PlannedBuild[] {
  const out: PlannedBuild[] = [];
  for (const e of entries) {
    if (!e.beta || e.ipsws.size === 0) continue;
    const devices = [...e.ipsws.keys()].sort(compareProducts);
    const pick = e.ipsws.has(device) ? device : (devices.at(-1) ?? device);
    out.push({
      build: e.build,
      version: e.version,
      label: e.version,
      prerelease: true,
      ...(e.released ? { released: e.released } : {}),
      ipsws: distinctIpsws([...e.ipsws].map(([d, url]) => ({ device: d, url })), pick),
    });
  }
  return out.sort(byVersion).slice(0, cap);
}

/** A planned release with its IPSWs: the planner's output entry. */
export function toBuild(c: Chosen, pairs: readonly IpswRef[]): PlannedBuild {
  return {
    build: c.build,
    version: c.version,
    label: c.version,
    ...(c.released ? { released: c.released } : {}),
    ...(isPrerelease(c.version) ? { prerelease: true } : {}),
    ipsws: distinctIpsws(pairs, c.device),
  };
}

/**
 * Every image held, again, newest first, so what phones run now is redone
 * first: for when what an extraction keeps has changed. Each keeps its
 * recorded version as its label (a beta's name is the planner's, not the
 * image's) and release day, and leads with `device`'s IPSW when it has one,
 * else the newest phone's. A build no catalogue lists any more is reported in
 * `missing`.
 */
export function planRebuild(
  held: readonly Held[],
  ipswsOf: (build: string) => readonly IpswRef[],
  device: string,
): { builds: PlannedBuild[]; missing: string[] } {
  const builds: PlannedBuild[] = [];
  const missing: string[] = [];
  for (const h of [...held].sort((a, b) => byVersion(b, a))) {
    const pairs = ipswsOf(h.build);
    const devices = pairs.map((p) => p.device).sort(compareProducts);
    const lead = devices.includes(device) ? device : devices.at(-1);
    if (!lead) {
      missing.push(h.build);
      continue;
    }
    builds.push({
      build: h.build,
      version: h.version,
      label: h.version,
      ...(h.released ? { released: h.released } : {}),
      ...(isPrerelease(h.version) ? { prerelease: true } : {}),
      ipsws: distinctIpsws(pairs, lead),
    });
  }
  return { builds, missing };
}
