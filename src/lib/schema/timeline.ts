/**
 * One history per source: one entry per distinct content, however many copies
 * of it exist. Copies come from OS images (Releases: an iOS build, a Pixel
 * build) and, for Apple sources, from Apple's OTA feed (OtaRefs, archived or
 * not). Copies are the same content when their file-set content ids are equal
 * (an image copy is re-zipped, so its bytes never equal the OTA original), or
 * else their stored bytes. An OTA file not archived yet has neither: it is
 * its own entry until its bytes are stored.
 *
 * Order is precedence, newest first: the higher version wins, as a phone picks
 * between its image copy and a downloaded one, and on a tie the entry with an
 * image copy wins (the phone prefers the image copy). Entries for named devices
 * only (the iPhone 6's own ATT_US builds) sink below the entries every device
 * gets; when every entry names devices (Android, one file per device
 * generation) the order is by version alone.
 *
 * `devices` is every device that carried the content. `changed` compares an
 * entry with the next one below it for an overlapping device set, never across
 * device generations: distinct contents always differ, except that an
 * unarchived OTA file of the same version as the entry below is taken to be
 * that content until its bytes say otherwise.
 *
 * Slugs are the source's own version (`72.0`, `79000000034`). When two
 * contents share a version, the one with precedence keeps it and each other
 * gets `<version>+<first 8 hex of its sha, or upstream sha1>` (semver's build
 * metadata: same version, different build). VERSION_SLUG is that grammar.
 */

import { compareVersions, isPrerelease } from "#lib/decode/index.ts";
import type { OtaRef } from "#lib/storage/keys.ts";
import { byPixelRank, defaultDevice } from "./devices.ts";
import type { Release, ReleaseSource, TimelineCopy, TimelineEntry } from "./types.ts";

/** Every timeline slug matches: a version starting with a digit, optionally `+<8 hex>`. Tab names never do. */
export const VERSION_SLUG = /^\d[\w.-]*(?:\+[0-9a-f]{8})?$/;

export const isVersionSlug = (s: string): boolean => VERSION_SLUG.test(s);

/** Oldest first. Android has no OS version that orders builds within a month; its patch level and build id do. */
export function compareReleases(a: Release, b: Release): number {
  return compareVersions(a.version, b.version)
    || (a.patch ?? "").localeCompare(b.patch ?? "")
    || (a.released ?? "").localeCompare(b.released ?? "")
    || a.id.localeCompare(b.id);
}

export const isBeta = (r: Release): boolean => r.prerelease ?? isPrerelease(r.version);

/** A model the manifest names (`iPhone7,1`); family names (`iPad`, `Watch`) are already the platform. */
export const modelOf = (productType: string | undefined): string | undefined => (productType?.includes(",") ? productType : undefined);

/** Device sets overlap; "every device" (undefined) overlaps only itself. */
function overlaps(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.some((d) => b.includes(d));
}

/** A content while its copies are gathered. `known` is false for an unarchived OTA file. */
interface Draft {
  readonly id: string;
  readonly known: boolean;
  readonly version: string;
  /** Undefined: every device. */
  devices: Set<string> | undefined;
  readonly images: Map<string, { releases: Release[]; sha: string; cid?: string }>;
  readonly otas: Map<string, OtaRef[]>;
}

const contentId = (x: { readonly cid?: string | undefined; readonly sha?: string | undefined }): string | undefined =>
  x.cid !== undefined ? `cid:${x.cid}` : x.sha !== undefined ? `sha:${x.sha}` : undefined;

function collect(key: string, releases: readonly Release[], refs: readonly OtaRef[]): Draft[] {
  const drafts = new Map<string, Draft>();
  /** The draft for a content, with `devices` widened by this copy's (a copy for every device makes it every device's). */
  const place = (id: string, known: boolean, version: string, devices: readonly string[] | undefined): Draft => {
    const existing = drafts.get(id);
    if (!existing) {
      const d: Draft = { id, known, version, devices: devices ? new Set(devices) : undefined, images: new Map(), otas: new Map() };
      drafts.set(id, d);
      return d;
    }
    if (devices === undefined) existing.devices = undefined;
    else if (existing.devices) for (const x of devices) existing.devices.add(x);
    return existing;
  };
  for (const r of releases) {
    for (const src of r.sources[key] ?? []) {
      const d = place(contentId(src) ?? `sha:${src.sha}`, true, src.version, src.devices);
      const copy = d.images.get(src.sha) ?? { releases: [], sha: src.sha, ...(src.cid !== undefined ? { cid: src.cid } : {}) };
      copy.releases.push(r);
      d.images.set(src.sha, copy);
    }
  }
  for (const ref of refs) {
    if (ref.source !== key) continue;
    const id = contentId(ref);
    const model = modelOf(ref.productType);
    const d = place(id ?? `url:${ref.url}`, id !== undefined, ref.build, model === undefined ? undefined : [model]);
    d.otas.set(ref.url, [...(d.otas.get(ref.url) ?? []), ref]);
  }
  return [...drafts.values()];
}

function copiesOf(d: Draft): TimelineCopy[] {
  const images = [...d.images.values()].map((c): TimelineCopy => ({
    via: "image",
    releases: [...c.releases].sort(compareReleases).map((r) => r.id),
    sha: c.sha,
    ...(c.cid !== undefined ? { cid: c.cid } : {}),
  }));
  const otas = [...d.otas.entries()].map(([url, listed]): TimelineCopy => {
    // One URL is one file: every ref listing it carries the same digests and archive state.
    const first = listed[0];
    return {
      via: "ota",
      os: [...new Set(listed.map((r) => r.os).filter((os) => os !== "" && os !== "legacy"))].sort(compareVersions),
      url,
      ...(first?.sha !== undefined ? { sha: first.sha } : {}),
      ...(first?.cid !== undefined ? { cid: first.cid } : {}),
      ...(first?.sha1 !== undefined ? { sha1: first.sha1 } : {}),
      ...(first?.sha384 !== undefined ? { sha384: first.sha384 } : {}),
    };
  });
  return [...images, ...otas];
}

/** Precedence, highest first. */
function precedence(a: Draft, b: Draft): number {
  const named = (d: Draft): number => Number(d.devices !== undefined);
  return named(a) - named(b)
    || compareVersions(b.version || "0", a.version || "0")
    || Number(b.images.size > 0) - Number(a.images.size > 0)
    || a.id.localeCompare(b.id);
}

/** The 8 hex a `+` slug carries: a stored sha, else Apple's sha1, else the content id. */
function hash8(d: Draft, copies: readonly TimelineCopy[]): string {
  const sha = copies.find((c) => c.sha !== undefined)?.sha;
  const sha1 = copies.flatMap((c) => (c.via === "ota" && c.sha1 !== undefined ? [c.sha1] : []))[0];
  const hex = (sha ?? sha1 ?? d.id.replace(/[^0-9a-f]/g, "")).toLowerCase();
  return hex.slice(0, 8).padEnd(8, "0");
}

const devicesOf = (d: Draft): string[] | undefined => (d.devices ? [...d.devices].sort(byPixelRank) : undefined);

/** The timeline of one source, newest first. `releases` and `refs` may hold everything; only copies of `key` count. */
export function sourceTimeline(key: string, releases: readonly Release[], refs: readonly OtaRef[]): TimelineEntry[] {
  const drafts = collect(key, releases, refs).sort(precedence);
  const taken = new Set<string>();
  return drafts.map((d, i): TimelineEntry => {
    const copies = copiesOf(d);
    const devices = devicesOf(d);
    const below = drafts.slice(i + 1).find((x) => overlaps(devicesOf(x), devices));
    const assumedSame = below !== undefined && below.version === d.version && (!d.known || !below.known);
    const version = d.version || "0";
    const slug = taken.has(version) ? `${version}+${hash8(d, copies)}` : version;
    taken.add(slug);
    const imageReleases = [...d.images.values()].flatMap((c) => c.releases);
    return {
      slug,
      version: d.version,
      copies,
      ...(devices !== undefined ? { devices } : {}),
      beta: d.otas.size === 0 && imageReleases.length > 0 && imageReleases.every(isBeta),
      changed: below === undefined || !assumedSame,
    };
  });
}

/* ------------------------------------------------------------ device picks */

/** Index of the newest non-beta entry that applies to `device` (else the newest at all), or -1. */
export function entryForDevice(timeline: readonly TimelineEntry[], device: string): number {
  const fits = (e: TimelineEntry): boolean => e.devices?.includes(device) ?? false;
  const i = timeline.findIndex((e) => fits(e) && !e.beta);
  return i >= 0 ? i : timeline.findIndex(fits);
}

/**
 * The entry a page shows when none is named. With `device`, that device's
 * newest. Otherwise the newest non-beta entry every device gets; for a
 * timeline whose entries all name devices, the newest for the default device
 * (./devices.ts: the newest flagship).
 */
export function headIndex(timeline: readonly TimelineEntry[], device?: string): number {
  const everyDevice = timeline.some((e) => e.devices === undefined);
  const want = device ?? (everyDevice ? undefined : defaultDevice(timeline.flatMap((e) => e.devices ?? [])));
  if (want !== undefined) {
    const i = entryForDevice(timeline, want);
    if (i >= 0) return i;
  }
  const i = timeline.findIndex((e) => e.devices === undefined && !e.beta);
  return i >= 0 ? i : Math.max(0, timeline.findIndex((e) => e.devices === undefined));
}

export interface DeviceGroup {
  /** Devices sharing one file in the newest release carrying the source, newest first. */
  readonly devices: readonly string[];
  /** Their entry in the timeline. */
  readonly index: number;
}

/**
 * Which devices share a file today: the device groups of the newest release
 * that carries `key`, each with its timeline entry, newest devices first.
 * Empty when that release has one file for every device.
 */
export function deviceGroups(key: string, releases: readonly Release[], timeline: readonly TimelineEntry[]): DeviceGroup[] {
  const newest = releases.filter((r) => (r.sources[key]?.length ?? 0) > 0).sort(compareReleases).at(-1);
  if (newest === undefined) return [];
  const sources: readonly ReleaseSource[] = newest.sources[key] ?? [];
  const groups = sources.flatMap((src): DeviceGroup[] => {
    if (src.devices === undefined) return [];
    const index = timeline.findIndex((e) => e.copies.some((c) => c.via === "image" && c.sha === src.sha && c.releases.includes(newest.id)));
    return index < 0 ? [] : [{ devices: [...src.devices].sort(byPixelRank), index }];
  });
  return groups.sort((a, b) => byPixelRank(a.devices[0] ?? "", b.devices[0] ?? ""));
}
