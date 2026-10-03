/**
 * One history per source, from the OS images that carry it (Releases) and,
 * for iOS, Apple's OTA feed (OtaRefs, archived or not).
 *
 * Ordering follows the phone: an iPhone runs whichever copy has the higher
 * bundle version, and the image copy wins a tie. Per-model OTA variants
 * (`ByProductType`: an iPad build, the iPhone 6's own ATT_US) sink below the
 * main line, since most phones never load them. An entry is `changed` unless
 * the entry below it for the same product type holds the same content: the
 * file-set content id when both have one (an image copy is re-zipped, so its
 * bytes never equal the OTA original), else the stored bytes, else the
 * version number.
 */

import { compareVersions, isPrerelease } from "#lib/decode/index.ts";
import type { OtaRef } from "#lib/storage/keys.ts";
import type { Platform, Release, ReleaseSource, TimelineEntry } from "./types.ts";

/** URL segment for an image entry: `ios-27.2-beta-3`, `android-cp3a.260905.009`. */
export function imageSlug(release: Pick<Release, "platform" | "id" | "version">): string {
  return release.platform === "ios"
    ? `ios-${release.version.trim().replace(/\s+/g, "-")}`
    : `android-${idSegment(release)}`;
}

/** A release id inside a slug: iOS builds as Apple writes them (v1 URLs did), Android ids lower-cased like the rest of their slug. */
const idSegment = (r: Pick<Release, "platform" | "id">): string => (r.platform === "ios" ? r.id : r.id.toLowerCase());

/** Android releases have no version that orders builds within a month; the patch level and build id do. */
function androidOrder(a: Release, b: Release): number {
  return (a.patch ?? a.released ?? "").localeCompare(b.patch ?? b.released ?? "") || a.id.localeCompare(b.id);
}

/** Oldest first. */
export function compareReleases(a: Release, b: Release): number {
  if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
  if (a.platform === "android") return androidOrder(a, b);
  return compareVersions(a.version, b.version) || (a.released ?? "").localeCompare(b.released ?? "") || a.id.localeCompare(b.id);
}

export const isBeta = (r: Release): boolean => r.prerelease ?? isPrerelease(r.version);

/** Family-level product types name every phone, not one model; only a model makes a variant. */
const isModelVariant = (productType: string | undefined): boolean =>
  productType !== undefined && productType !== "iPhone" && productType !== "Watch";

/** Same content, by the strongest identity both entries carry. */
function sameContent(a: TimelineEntry, b: TimelineEntry): boolean {
  if (a.cid !== undefined && b.cid !== undefined) return a.cid === b.cid;
  if (a.sha !== undefined && b.sha !== undefined) return a.sha === b.sha;
  return a.version === b.version;
}

interface ImageRun { releases: Release[]; src: ReleaseSource }

/** Consecutive releases (newest first) carrying the same content collapse into one run. */
function imageRuns(key: string, releases: readonly Release[]): ImageRun[] {
  const runs: ImageRun[] = [];
  for (const r of [...releases].sort((a, b) => compareReleases(b, a))) {
    const src = r.sources[key];
    if (!src) continue;
    const last = runs.at(-1);
    const same = last && (src.cid !== undefined && last.src.cid !== undefined ? src.cid === last.src.cid : src.sha === last.src.sha);
    if (last && same) last.releases.push(r);
    else runs.push({ releases: [r], src });
  }
  return runs;
}

function imageEntry(run: ImageRun): { entry: TimelineEntry; newest: Release } {
  const newest = run.releases[0];
  if (!newest) throw new Error("image run without a release");
  const oldestFirst = [...run.releases].sort(compareReleases);
  const entry: TimelineEntry = {
    slug: imageSlug(newest),
    via: "image",
    version: run.src.version,
    releases: oldestFirst.map((r) => r.id),
    sha: run.src.sha,
    ...(run.src.cid !== undefined ? { cid: run.src.cid } : {}),
    ...(run.releases.every(isBeta) ? { beta: true } : {}),
    changed: true,
  };
  return { entry, newest };
}

function otaEntries(key: string, refs: readonly OtaRef[]): TimelineEntry[] {
  const byUrl = new Map<string, TimelineEntry>();
  for (const r of refs) {
    if (r.source !== key) continue;
    const known = byUrl.get(r.url);
    const os = r.os !== "legacy" && r.os !== "" ? [r.os] : [];
    if (known) {
      for (const o of os) if (!known.releases.includes(o)) known.releases.push(o);
      continue;
    }
    const model = isModelVariant(r.productType) ? `-${r.productType}` : "";
    byUrl.set(r.url, {
      slug: r.os === "legacy" ? "ota-legacy" : `ota-${r.build}${model}`,
      via: "ota",
      version: r.build,
      releases: os,
      url: r.url,
      ...(r.sha !== undefined ? { sha: r.sha } : {}),
      ...(r.sha1 !== undefined ? { sha1: r.sha1 } : {}),
      ...(r.sha384 !== undefined ? { sha384: r.sha384 } : {}),
      ...(r.cid !== undefined ? { cid: r.cid } : {}),
      ...(r.productType !== undefined ? { productType: r.productType } : {}),
      changed: true,
    });
  }
  return [...byUrl.values()].map((e) => ({ ...e, releases: [...e.releases].sort(compareVersions) }));
}

export interface SourceTimeline {
  readonly entries: TimelineEntry[];
  /** Newest day any entry changed the content, YYYY-MM-DD; undefined when nothing carries a date. */
  readonly updated: string | undefined;
}

/**
 * The timeline of one source, newest first. `releases` may hold every
 * release of every platform; only those carrying `key` contribute.
 */
export function sourceTimeline(key: string, platform: Platform, releases: readonly Release[], refs: readonly OtaRef[]): SourceTimeline {
  const images = imageRuns(key, releases.filter((r) => r.platform === platform)).map(imageEntry);
  const newestRelease = new Map(images.map(({ entry, newest }) => [entry, newest]));
  const firstSeen = new Map(refs.filter((r) => r.source === key).map((r) => [r.url, r.firstSeen.slice(0, 10)]));
  const entries = [...images.map((i) => i.entry), ...otaEntries(key, refs)];

  entries.sort((a, b) =>
    Number(isModelVariant(a.productType)) - Number(isModelVariant(b.productType)) ||
    compareVersions(b.version || "0", a.version || "0") ||
    Number(b.via === "image") - Number(a.via === "image"));

  const changed = entries.map((e, i) => {
    const below = entries.slice(i + 1).find((x) => x.productType === e.productType);
    return below === undefined || !sameContent(e, below);
  });

  // Two images of one version, or two OTA files of one build, must not share a URL; the newest keeps the clean slug.
  const seen = new Map<string, number>();
  const out = entries.map((e, i): TimelineEntry => {
    const n = (seen.get(e.slug) ?? 0) + 1;
    seen.set(e.slug, n);
    const release = newestRelease.get(e);
    const slug = n === 1 ? e.slug : release ? `${e.slug}-${idSegment(release)}` : `${e.slug}-${n}`;
    return { ...e, slug, changed: changed[i] ?? true };
  });

  const dates = entries.flatMap((e, i) => {
    if (!changed[i]) return [];
    const release = newestRelease.get(e);
    const day = release ? release.released : e.url !== undefined ? firstSeen.get(e.url) : undefined;
    return day ? [day.slice(0, 10)] : [];
  });
  return { entries: out, updated: dates.sort().at(-1) };
}

/**
 * The entry a page shows when none is named: the newest plain copy a release
 * carries. Beta-only copies and per-model variants are one click away, but
 * they are not what most phones run.
 */
export function headIndex(timeline: readonly TimelineEntry[]): number {
  const i = timeline.findIndex((e) => !isModelVariant(e.productType) && !e.beta);
  return i >= 0 ? i : Math.max(0, timeline.findIndex((e) => !isModelVariant(e.productType)));
}
