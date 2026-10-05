/** Which iOS builds to extract. Pure: the check fetches, this decides. */

import { compareProducts, compareVersions, isPrerelease, newestProduct } from "@carrier-explode/decode-ios";
import type { AppleReleaseHeader } from "@carrier-explode/schema/types";
import type * as v from "valibot";
import type { iosBuildSchema } from "../../jobs.ts";
import type { AppleDbEntry, Firmware, IpswRef } from "./catalog.ts";

/** The first IPSW names the image. */
export type PlannedBuild = v.InferOutput<typeof iosBuildSchema>;

/** A release the bucket holds; its `label` is the version the planner named it by. */
export type Held = Pick<AppleReleaseHeader, "id" | "version" | "label" | "devices" | "released" | "prerelease">;

export interface PlanOptions {
  /** Exactly this version, held or not. */
  readonly only?: string | undefined;
  /** Floor; default the oldest release held. */
  readonly since?: string | undefined;
}

const byVersion = (a: { readonly version: string }, b: { readonly version: string }): number => compareVersions(a.version, b.version);
const released = (day: string | undefined): { released?: string } => (day ? { released: day } : {});

/**
 * Releases to extract, oldest first so history fills in order: every one above the floor not held.
 * `preferred` keeps images comparable; `fallback` (the newest iPhone) covers releases it no longer gets.
 */
export function plan(held: readonly Held[], preferred: readonly Firmware[], fallback: readonly Firmware[], o: PlanOptions): Firmware[] {
  const builds = new Set(held.map((h) => h.id));
  const heldFrom = new Map(held.map((h) => [h.label, h.devices]));
  const floor = o.since ?? held.map((h) => h.label).sort(compareVersions)[0];

  const chosen = new Map<string, Firmware>();
  // Preferred last, so it wins a version both list.
  for (const fw of [...fallback, ...preferred]) {
    if (o.only !== undefined) {
      if (fw.version !== o.only) continue;
    } else {
      if (builds.has(fw.build)) continue;
      if (floor !== undefined && compareVersions(fw.version, floor) < 0) continue;
      // Held from another phone, whose build of the version differs for that reason alone; from this phone, it is a re-issue.
      if (heldFrom.get(fw.version)?.includes(fw.device) === false) continue;
    }
    chosen.set(fw.version, fw);
  }
  const out = [...chosen.values()].sort(byVersion);
  // An empty bucket starts from the newest, not from all of history.
  if (floor === undefined && o.only === undefined) return out.slice(-1);
  return out;
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
  const [, major, letter] = BETA_BUILD.exec(build) ?? RELEASE_BUILD.exec(build) ?? [];
  if (major === undefined || letter === undefined) return undefined;
  return Number(major) * 26 + (letter.charCodeAt(0) - 65);
}

/** AppleDB beta builds past the newest public release's train, not held: betas of what comes next. */
export function betaCandidates(keys: readonly string[], held: readonly Held[], releases: readonly Firmware[]): string[] {
  const have = new Set(held.map((h) => h.id));
  const trains = releases.flatMap((f) => train(f.build) ?? []);
  const newest = trains.length ? Math.max(...trains) : undefined;
  return keys.flatMap((k) => {
    const [os, build = ""] = k.split(";");
    if (os !== "iOS" || !BETA_BUILD.test(build) || have.has(build)) return [];
    const t = train(build);
    return newest === undefined || (t !== undefined && t > newest) ? [build] : [];
  });
}

/** Betas to extract, oldest first; `device`'s IPSW leads, else the newest iPhone's. */
export function planBetas(entries: readonly AppleDbEntry[], device: string): PlannedBuild[] {
  const out: PlannedBuild[] = [];
  for (const e of entries) {
    const newest = newestProduct([...e.ipsws.keys()]);
    if (!e.beta || newest === undefined) continue;
    const pairs = [...e.ipsws].map(([d, url]) => ({ device: d, url }));
    const lead = e.ipsws.has(device) ? device : newest;
    out.push({ build: e.build, version: e.version, label: e.version, prerelease: true, ...released(e.released), ipsws: distinctIpsws(pairs, lead) });
  }
  return out.sort(byVersion);
}

export function toBuild(fw: Firmware, pairs: readonly IpswRef[]): PlannedBuild {
  return {
    build: fw.build,
    version: fw.version,
    label: fw.version,
    prerelease: isPrerelease(fw.version),
    ...released(fw.released),
    ipsws: distinctIpsws(pairs, fw.device),
  };
}

/** Every held release again, newest first, keeping its label and day; builds no catalogue lists any more come back in `missing`. */
export function planRebuild(held: readonly Held[], ipswsOf: (build: string) => readonly IpswRef[], device: string): { builds: PlannedBuild[]; missing: string[] } {
  const builds: PlannedBuild[] = [];
  const missing: string[] = [];
  for (const h of [...held].sort((a, b) => compareVersions(b.label, a.label))) {
    const pairs = ipswsOf(h.id);
    const devices = pairs.map((p) => p.device).sort(compareProducts);
    const lead = devices.includes(device) ? device : devices.at(-1);
    if (lead === undefined) {
      missing.push(h.id);
      continue;
    }
    builds.push({ build: h.id, version: h.version, label: h.label, prerelease: h.prerelease, ...released(h.released), ipsws: distinctIpsws(pairs, lead) });
  }
  return { builds, missing };
}
