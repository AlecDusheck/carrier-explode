/**
 * A source's history, shaped the way its platform identifies a version (see
 * the timeline section of ./types.ts): Apple has one line keyed by the
 * bundle's own version (plus a line per model for the few model-specific
 * manifest entries); Android has one line per Pixel, keyed by (device,
 * CarrierSettings.version).
 *
 * Copies come from OS images (Releases) and, for Apple, from the OTA feed
 * (OtaRefs, archived or not). Within a line, copies with equal content merge
 * into one entry: equal file-set content id (Apple image bundles are re-zipped,
 * so their bytes never equal the OTA original; both carry the cid), else equal
 * sha. An unarchived OTA file has neither and stays its own entry until it is
 * archived, when the next index build merges it.
 *
 * Entries are newest first: higher version first, and under one version the
 * content that appeared last first. The newest content under a version takes
 * the bare version as its slug; each older one is named by where it first
 * appeared (versionSlug). Two contents of one version first seen in the same
 * place cannot be named apart: the build fails, naming both.
 *
 * `changed` compares an entry with the one below it on the same line. Distinct
 * contents differ, except that an unarchived OTA file of the entry below's
 * version is taken to be that content: on Apple a version names one content
 * in all but one of 4,434 measured cases.
 */

import { compareVersions, isPrerelease, publishedOn } from "#lib/decode/index.ts";
import type { OtaRef } from "#lib/storage/keys.ts";
import { byPixelRank, defaultDevice } from "./devices.ts";
import {
  decoderFamily, sourceKey, versionSlug,
  type FirstSeen, type Release, type SourceRef, type Timeline, type TimelineCopy, type TimelineEntry,
} from "./types.ts";

/**
 * Every version path segment: a version (starting with a digit), optionally
 * `@<where it first appeared>`. Codenames and tab names never match, which is
 * how the site's param matcher tells a version from a line or a tab.
 */
export const VERSION_SLUG = /^\d[\w.-]*(?:@[\w.-]+)?$/;

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

/** How a release names a first appearance: Apple images by OS version (`ios-26.0`), Pixel builds by id (`cp3a.260905.009`). */
export function releaseLabel(r: Release): string {
  return decoderFamily(r.platform) === "apple" ? `${r.platform}-${r.version.trim().replace(/\s+/g, "-")}` : r.id.toLowerCase();
}

/* -------------------------------------------------------------------- lines */

/** One copy of some content, as found. */
type Found =
  | { readonly via: "image"; readonly release: Release; readonly sha: string; readonly cid?: string | undefined; readonly version: string }
  | { readonly via: "ota"; readonly url: string; readonly refs: readonly OtaRef[]; readonly version: string };

/** OTA copies, one per URL (a file listed under several OS keys is several refs, one file). */
function otaCopies(refs: readonly OtaRef[]): Found[] {
  const byUrl = new Map<string, OtaRef[]>();
  for (const r of refs) byUrl.set(r.url, [...(byUrl.get(r.url) ?? []), r]);
  return [...byUrl].flatMap(([url, listed]): Found[] => {
    const first = listed[0];
    return first ? [{ via: "ota", url, refs: listed, version: first.build }] : [];
  });
}

const otaFacts = (f: Extract<Found, { via: "ota" }>): { sha?: string; cid?: string } => {
  // Every ref of one URL is the same file, archived together.
  const first = f.refs[0];
  return { ...(first?.sha !== undefined ? { sha: first.sha } : {}), ...(first?.cid !== undefined ? { cid: first.cid } : {}) };
};

/** The content a copy holds, or undefined for an unarchived OTA file. */
function contentOf(f: Found): string | undefined {
  const { sha, cid } = f.via === "image" ? f : otaFacts(f);
  return cid !== undefined ? `cid:${cid}` : sha !== undefined ? `sha:${sha}` : undefined;
}

/** When and where a copy appeared: a sortable day ("" when unknown) and its FirstSeen name. */
function appearance(f: Found): { day: string; seen: FirstSeen } {
  if (f.via === "image") return { day: f.release.released ?? "", seen: { via: "image", release: releaseLabel(f.release) } };
  const published = publishedOn(f.url) ?? f.refs.map((r) => r.firstSeen.slice(0, 10)).sort()[0] ?? "";
  return { day: published, seen: { via: "ota", published } };
}

function copyOf(group: readonly Found[]): TimelineCopy[] {
  const images = new Map<string, { releases: Release[]; cid?: string }>();
  const out: TimelineCopy[] = [];
  for (const f of group) {
    if (f.via === "image") {
      const c = images.get(f.sha) ?? { releases: [], ...(f.cid !== undefined ? { cid: f.cid } : {}) };
      c.releases.push(f.release);
      images.set(f.sha, c);
      continue;
    }
    const first = f.refs[0];
    const published = publishedOn(f.url);
    out.push({
      via: "ota",
      os: [...new Set(f.refs.map((r) => r.os).filter((os) => os !== "" && os !== "legacy"))].sort(compareVersions),
      url: f.url,
      ...(published !== undefined ? { published } : {}),
      ...otaFacts(f),
      ...(first?.sha1 !== undefined ? { sha1: first.sha1 } : {}),
      ...(first?.sha384 !== undefined ? { sha384: first.sha384 } : {}),
    });
  }
  const imageCopies = [...images].map(([sha, c]): TimelineCopy => ({
    via: "image",
    releases: [...c.releases].sort((a, b) => compareReleases(b, a)).map((r) => r.id),
    sha,
    ...(c.cid !== undefined ? { cid: c.cid } : {}),
  }));
  return [...imageCopies, ...out];
}

interface Group {
  readonly content: string | undefined;
  readonly version: string;
  readonly found: readonly Found[];
  /** Earliest appearance, and the latest (which orders contents under one version). */
  readonly first: { day: string; seen: FirstSeen };
  readonly last: string;
}

function groupsOf(found: readonly Found[]): Group[] {
  const byContent = new Map<string, Found[]>();
  for (const f of found) {
    const key = contentOf(f) ?? `unarchived:${f.via === "ota" ? f.url : f.sha}`;
    byContent.set(key, [...(byContent.get(key) ?? []), f]);
  }
  return [...byContent].flatMap(([key, list]): Group[] => {
    const seen = list.map(appearance).sort((a, b) => a.day.localeCompare(b.day));
    const head = list[0];
    const first = seen.find((s) => s.day !== "") ?? seen[0];
    if (!head || !first) return [];
    return [{
      content: key.startsWith("unarchived:") ? undefined : key,
      version: head.version,
      found: list,
      first,
      last: seen.map((s) => s.day).sort().at(-1) ?? "",
    }];
  });
}

const shasOf = (g: Group): string =>
  g.found.map((f) => (f.via === "image" ? f.sha : otaFacts(f).sha ?? f.url)).join(", ");

/** One line's entries, newest first. Throws when two contents of one version cannot be named apart. */
function buildLine(found: readonly Found[]): TimelineEntry[] {
  const groups = groupsOf(found).sort((a, b) =>
    compareVersions(b.version || "0", a.version || "0") || b.last.localeCompare(a.last) || Number(b.found.some((f) => f.via === "image")) - Number(a.found.some((f) => f.via === "image")));
  const named = new Map<string, Group>();
  return groups.map((g, i): TimelineEntry => {
    const slug = named.has(versionSlug(g.version)) ? versionSlug(g.version, g.first.seen) : versionSlug(g.version);
    const clash = named.get(slug);
    if (clash) throw new Error(`timeline: two contents of version ${g.version} first seen in the same place (${slug}): ${shasOf(clash)} / ${shasOf(g)}`);
    named.set(slug, g);
    const below = groups[i + 1];
    const assumedSame = below !== undefined && below.version === g.version && (g.content === undefined || below.content === undefined);
    const images = g.found.flatMap((f) => (f.via === "image" ? [f.release] : []));
    return {
      slug,
      version: g.version,
      copies: copyOf(g.found),
      beta: images.length === g.found.length && images.every(isBeta),
      changed: below === undefined || !assumedSame,
    };
  });
}

/* ---------------------------------------------------------------- timelines */

function appleTimeline(key: string, releases: readonly Release[], refs: readonly OtaRef[]): Timeline {
  const images = releases.flatMap((r) => (r.sources[key] ?? []).map((s): Found => ({ via: "image", release: r, sha: s.sha, cid: s.cid, version: s.version })));
  const own = refs.filter((r) => r.source === key);
  const byModel = new Map<string, OtaRef[]>();
  const common: OtaRef[] = [];
  for (const r of own) {
    const model = modelOf(r.productType);
    if (model === undefined) common.push(r);
    else byModel.set(model, [...(byModel.get(model) ?? []), r]);
  }
  return {
    family: "apple",
    entries: buildLine([...images, ...otaCopies(common)]),
    models: Object.fromEntries([...byModel].map(([model, list]) => [model, buildLine(otaCopies(list))])),
  };
}

function androidTimeline(key: string, releases: readonly Release[]): Timeline {
  const byDevice = new Map<string, Found[]>();
  const carriers = new Map<string, Set<string>>();
  for (const r of releases) {
    for (const s of r.sources[key] ?? []) {
      if (!s.devices?.length) throw new Error(`timeline: ${key} in ${r.id} names no devices; Android artifacts are per device`);
      for (const d of s.devices) {
        byDevice.set(d, [...(byDevice.get(d) ?? []), { via: "image", release: r, sha: s.sha, version: s.version }]);
        const holders = carriers.get(s.sha) ?? new Set<string>();
        holders.add(d);
        carriers.set(s.sha, holders);
      }
    }
  }
  return {
    family: "android",
    devices: Object.fromEntries([...byDevice].sort(([a], [b]) => byPixelRank(a, b)).map(([d, found]) => [d, buildLine(found)])),
    canonical: Object.fromEntries([...carriers].flatMap(([sha, ds]) => {
      const newest = defaultDevice([...ds]);
      return newest === undefined ? [] : [[sha, newest]];
    })),
  };
}

/** A source's timeline. `releases` and `refs` may hold everything; only copies of `source` count. */
export function sourceTimeline(source: SourceRef, releases: readonly Release[], refs: readonly OtaRef[]): Timeline {
  const key = sourceKey(source);
  return decoderFamily(source.platform) === "apple" ? appleTimeline(key, releases, refs) : androidTimeline(key, releases);
}

/* ------------------------------------------------------------------- heads */

export interface Located {
  /** Android codename or Apple model; undefined for Apple's main line. */
  readonly line: string | undefined;
  readonly entry: TimelineEntry;
}

/** The newest non-beta entry of a line, else its newest. */
const headOf = (entries: readonly TimelineEntry[]): TimelineEntry | undefined => entries.find((e) => !e.beta) ?? entries[0];

/**
 * The version a page shows when none is named. Apple: the main line's head
 * (or `line`'s, a model). Android: `line`'s head, by default the newest
 * flagship's (./devices.ts).
 */
export function head(timeline: Timeline, line?: string): Located | undefined {
  if (timeline.family === "apple") {
    const entries = line === undefined ? timeline.entries : timeline.models[line] ?? [];
    const entry = headOf(entries);
    return entry ? { line, entry } : undefined;
  }
  const device = line ?? defaultDevice(Object.keys(timeline.devices));
  const entry = device === undefined ? undefined : headOf(timeline.devices[device] ?? []);
  return entry ? { line: device, entry } : undefined;
}

export interface DeviceGroup {
  /** Pixels sharing one file in the newest release carrying the source, newest first. */
  readonly devices: readonly string[];
  /** The line whose URL is canonical for that file. */
  readonly line: string;
  readonly entry: TimelineEntry;
}

/**
 * Which Pixels share a file today: one group per artifact of the newest
 * release carrying the source, newest Pixels first. Empty for Apple sources,
 * whose per-phone differences live inside one bundle (Profile.variants).
 */
export function deviceGroups(source: SourceRef, releases: readonly Release[], timeline: Timeline): DeviceGroup[] {
  if (timeline.family !== "android") return [];
  const key = sourceKey(source);
  const newest = releases.filter((r) => (r.sources[key]?.length ?? 0) > 0).sort(compareReleases).at(-1);
  if (!newest) return [];
  const groups = (newest.sources[key] ?? []).flatMap((src): DeviceGroup[] => {
    const line = timeline.canonical[src.sha];
    const entry = line === undefined ? undefined : timeline.devices[line]?.find((e) => e.copies.some((c) => c.via === "image" && c.sha === src.sha));
    return line !== undefined && entry ? [{ devices: [...(src.devices ?? [])].sort(byPixelRank), line, entry }] : [];
  });
  return groups.sort((a, b) => byPixelRank(a.devices[0] ?? "", b.devices[0] ?? ""));
}
