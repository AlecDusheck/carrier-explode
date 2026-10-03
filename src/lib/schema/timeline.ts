/**
 * One history per source, from the OS images that carry it (Releases) and,
 * for iOS, Apple's OTA feed (OtaRefs, archived or not).
 *
 * iOS ordering follows the phone: it runs whichever copy has the higher
 * bundle version, and the image copy wins a tie. Per-model OTA variants
 * (`ByProductType`: an iPad build, the iPhone 6's own ATT_US) sink below the
 * main line, since most phones never load them.
 *
 * Android is per device line. A build ships one CarrierSettings file per
 * device group (Release.sources holds one artifact per distinct file, with the
 * Pixels that carry it), and groups split and merge between builds. An entry
 * is one artifact for one exact set of Pixels over consecutive builds; when
 * the set changes (Pixel 9 and 9 Pro Fold part ways, a new Pixel joins) a new
 * entry starts, unchanged in content if the file is the same, so `devices`
 * always says exactly who ran it. Entries order by build, newest first, and
 * within a build by their newest Pixel.
 *
 * `changed` compares an entry with the next older one for the same product
 * type and an overlapping device set, never across generations: by file-set
 * content id when both have one (an image copy is re-zipped, so its bytes
 * never equal the OTA original), else the stored bytes, else the version.
 *
 * Slugs: `ios-<version>` / `android-<build>` for images, `ota-<build>[-<model>]`
 * for OTA files. An Android entry whose devices do not include the build's
 * default device (./devices.ts, the newest flagship) gets `-<codename>` of its
 * newest Pixel: `android-cp3a.260905.009` is the Pixel 10 Pro's file,
 * `android-cp3a.260905.009-oriole` the Pixel 6's. Any remaining clash takes
 * the newest release id (images) or a counter (OTA).
 */

import { compareVersions, isPrerelease } from "#lib/decode/index.ts";
import type { OtaRef } from "#lib/storage/keys.ts";
import { byPixelRank, defaultDevice, pixelRank } from "./devices.ts";
import type { Platform, Release, ReleaseSource, TimelineEntry } from "./types.ts";

/** A release id inside a slug: iOS builds as Apple writes them (v1 URLs did), Android ids lower-cased like the rest of their slug. */
const idSegment = (r: Pick<Release, "platform" | "id">): string => (r.platform === "ios" ? r.id : r.id.toLowerCase());

/** URL segment for an image entry: `ios-27.2-beta-3`, `android-cp3a.260905.009`. */
export function imageSlug(release: Pick<Release, "platform" | "id" | "version">): string {
  return release.platform === "ios"
    ? `ios-${release.version.trim().replace(/\s+/g, "-")}`
    : `android-${idSegment(release)}`;
}

/** Oldest first. Android has no version that orders builds within a month; the patch level and build id do. */
export function compareReleases(a: Release, b: Release): number {
  if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
  if (a.platform === "android") {
    return (a.patch ?? a.released ?? "").localeCompare(b.patch ?? b.released ?? "") || a.id.localeCompare(b.id);
  }
  return compareVersions(a.version, b.version) || (a.released ?? "").localeCompare(b.released ?? "") || a.id.localeCompare(b.id);
}

export const isBeta = (r: Release): boolean => r.prerelease ?? isPrerelease(r.version);

/** Family-level product types name every phone, not one model; only a model makes a variant. */
const isModelVariant = (productType: string | undefined): boolean =>
  productType !== undefined && productType !== "iPhone" && productType !== "Watch";

const sameDevices = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.length === b.length && a.every((d) => b.includes(d));

/** Device sets overlap; a set that is not stated (iOS) overlaps only another unstated one. */
function overlaps(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.some((d) => b.includes(d));
}

function sameArtifact(a: Pick<ReleaseSource, "cid" | "sha">, b: Pick<ReleaseSource, "cid" | "sha">): boolean {
  return a.cid !== undefined && b.cid !== undefined ? a.cid === b.cid : a.sha === b.sha;
}

function sameContent(a: TimelineEntry, b: TimelineEntry): boolean {
  if (a.cid !== undefined && b.cid !== undefined) return a.cid === b.cid;
  if (a.sha !== undefined && b.sha !== undefined) return a.sha === b.sha;
  return a.version === b.version;
}

/** One artifact over consecutive releases (newest first), for one device line. */
interface ImageRun {
  readonly newest: Release;
  readonly releases: Release[];
  readonly src: ReleaseSource;
  readonly devices: readonly string[] | undefined;
}

function imageRuns(key: string, releases: readonly Release[]): ImageRun[] {
  const runs: ImageRun[] = [];
  let open: ImageRun[] = [];
  for (const r of [...releases].sort((a, b) => compareReleases(b, a))) {
    const srcs = r.sources[key];
    if (!srcs?.length) continue;
    const touched: ImageRun[] = [];
    for (const src of srcs) {
      const run = open.find((x) => !touched.includes(x) && sameArtifact(x.src, src) && sameDevices(x.devices, src.devices));
      if (run) {
        run.releases.push(r);
        touched.push(run);
      } else {
        const fresh: ImageRun = { newest: r, releases: [r], src, devices: src.devices ? [...src.devices] : undefined };
        runs.push(fresh);
        touched.push(fresh);
      }
    }
    open = touched;
  }
  return runs;
}

interface Built { entry: TimelineEntry; release?: Release; rank: number }

function imageEntry(run: ImageRun): Built {
  const devices = run.devices ? [...run.devices].sort(byPixelRank) : undefined;
  const flagship = defaultDevice(run.newest.devices);
  const lead = devices?.[0];
  const suffix = devices && lead !== undefined && flagship !== undefined && !devices.includes(flagship) ? `-${lead}` : "";
  const entry: TimelineEntry = {
    slug: `${imageSlug(run.newest)}${suffix}`,
    via: "image",
    version: run.src.version,
    releases: [...run.releases].sort(compareReleases).map((r) => r.id),
    sha: run.src.sha,
    ...(run.src.cid !== undefined ? { cid: run.src.cid } : {}),
    ...(devices ? { devices } : {}),
    ...(run.releases.every(isBeta) ? { beta: true } : {}),
    changed: true,
  };
  return { entry, release: run.newest, rank: lead === undefined ? 0 : pixelRank(lead) };
}

function otaEntries(key: string, refs: readonly OtaRef[]): Built[] {
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
  return [...byUrl.values()].map((e) => ({ entry: { ...e, releases: [...e.releases].sort(compareVersions) }, rank: 0 }));
}

/** iOS: by bundle version as the phone picks, variants last, image first on a tie. */
function iosOrder(a: Built, b: Built): number {
  return Number(isModelVariant(a.entry.productType)) - Number(isModelVariant(b.entry.productType)) ||
    compareVersions(b.entry.version || "0", a.entry.version || "0") ||
    Number(b.entry.via === "image") - Number(a.entry.via === "image");
}

/** Android: by build, newest first; within a build, the newest Pixels' file first. */
function androidOrder(a: Built, b: Built): number {
  if (a.release && b.release) return compareReleases(b.release, a.release) || b.rank - a.rank;
  return 0;
}

export interface SourceTimeline {
  readonly entries: TimelineEntry[];
  /** Newest day any entry changed the content, YYYY-MM-DD; undefined when nothing carries a date. */
  readonly updated: string | undefined;
}

/**
 * The timeline of one source, newest first. `releases` may hold every
 * release of every platform; only those of `platform` carrying `key` contribute.
 */
export function sourceTimeline(key: string, platform: Platform, releases: readonly Release[], refs: readonly OtaRef[]): SourceTimeline {
  const built = [
    ...imageRuns(key, releases.filter((r) => r.platform === platform)).map(imageEntry),
    ...(platform === "ios" ? otaEntries(key, refs) : []),
  ].sort(platform === "ios" ? iosOrder : androidOrder);

  const changed = built.map(({ entry: e }, i) => {
    const below = built.slice(i + 1).find(({ entry: x }) => x.productType === e.productType && overlaps(x.devices, e.devices));
    return below === undefined || !sameContent(e, below.entry);
  });

  const seen = new Map<string, number>();
  const entries = built.map(({ entry: e, release }, i): TimelineEntry => {
    const n = (seen.get(e.slug) ?? 0) + 1;
    seen.set(e.slug, n);
    const slug = n === 1 ? e.slug : release ? `${e.slug}-${idSegment(release)}` : `${e.slug}-${n}`;
    return { ...e, slug, changed: changed[i] ?? true };
  });

  const firstSeen = new Map(refs.filter((r) => r.source === key).map((r) => [r.url, r.firstSeen]));
  const dates = built.flatMap(({ entry: e, release }, i) => {
    if (!changed[i]) return [];
    const day = release ? release.released : e.url !== undefined ? firstSeen.get(e.url) : undefined;
    return day ? [day.slice(0, 10)] : [];
  });
  return { entries, updated: dates.sort().at(-1) };
}

/* ------------------------------------------------------------ device picks */

/**
 * The entry a page shows when none is named. iOS: the newest plain copy a
 * release carries (beta-only copies and per-model variants are one click
 * away). Android: the newest entry for `device`, by default the newest
 * flagship of the newest build.
 */
export function headIndex(timeline: readonly TimelineEntry[], device?: string): number {
  if (timeline.some((e) => e.devices !== undefined)) {
    const want = device ?? defaultDevice(deviceGroups(timeline).flatMap((g) => g.devices));
    const i = want === undefined ? -1 : entryForDevice(timeline, want);
    if (i >= 0) return i;
  }
  const i = timeline.findIndex((e) => !isModelVariant(e.productType) && !e.beta);
  return i >= 0 ? i : Math.max(0, timeline.findIndex((e) => !isModelVariant(e.productType)));
}

/** Index of the newest non-beta entry that applies to `device` (else the newest at all), or -1. */
export function entryForDevice(timeline: readonly TimelineEntry[], device: string): number {
  const fits = (e: TimelineEntry): boolean => e.devices?.includes(device) ?? false;
  const i = timeline.findIndex((e) => fits(e) && !e.beta);
  return i >= 0 ? i : timeline.findIndex(fits);
}

export interface DeviceGroup {
  /** Devices sharing one file in the newest release, newest Pixel first. */
  readonly devices: readonly string[];
  /** Their entry in the timeline. */
  readonly index: number;
}

/**
 * The device groups of the newest release that carries the source: which
 * Pixels share a file today. Empty for timelines without devices (iOS).
 */
export function deviceGroups(timeline: readonly TimelineEntry[]): DeviceGroup[] {
  const newest = timeline.find((e) => e.devices !== undefined && e.via === "image")?.releases.at(-1);
  if (newest === undefined) return [];
  return timeline.flatMap((e, index) =>
    e.devices !== undefined && e.releases.includes(newest) ? [{ devices: [...e.devices].sort(byPixelRank), index }] : []);
}
