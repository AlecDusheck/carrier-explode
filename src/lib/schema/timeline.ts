/** Per-source histories: one entry per distinct content on a line, newest first. */

import { compareVersions, isPrerelease } from "#lib/decode/index.ts";
import type { OtaRef } from "#lib/storage/keys.ts";
import { byPixelRank, defaultDevice } from "./devices.ts";
import {
  decoderFamily, sourceKey, versionSlug,
  type AndroidRelease, type AppleRelease, type FirstSeen, type Release, type SourceRef, type Timeline, type TimelineCopy, type TimelineEntry,
} from "./types.ts";

/** A version path segment (`72.0`, `50.1@2022-04-12`); codenames, models and tab names never match. */
export const VERSION_SLUG = /^\d[\w.-]*(?:@[\w.-]+)?$/;

export const isVersionSlug = (s: string): boolean => VERSION_SLUG.test(s);

/** Oldest first; Pixel builds of one Android version order by patch level. */
export function compareReleases(a: Release, b: Release): number {
  const patch = (r: Release): string => (r.platform === "android" ? r.patch : "");
  return compareVersions(a.version, b.version)
    || patch(a).localeCompare(patch(b))
    || (a.released ?? "").localeCompare(b.released ?? "")
    || a.id.localeCompare(b.id);
}

export const isBeta = (r: Release): boolean => r.prerelease || isPrerelease(r.version);

/** How a release names a first appearance: Apple images by OS version (`ios-26.0`), Pixel builds by id. */
export function releaseLabel(r: Release): string {
  return r.platform === "android" ? r.id.toLowerCase() : `${r.platform}-${r.version.trim().replace(/\s+/g, "-")}`;
}

/** A copy as found: an image's artifact, or an OTA file with every ref listing it. */
type Found =
  | { readonly via: "image"; readonly release: Release; readonly sha: string; readonly cid: string | undefined; readonly version: string }
  | { readonly via: "ota"; readonly url: string; readonly refs: readonly [OtaRef, ...OtaRef[]] };

const versionOf = (f: Found): string => (f.via === "image" ? f.version : f.refs[0].build);

/** Equal cid (Apple bundles survive re-zipping by it), else equal sha; an unarchived OTA file is its own content. */
function contentOf(f: Found): string {
  if (f.via === "image") return f.cid !== undefined ? `cid:${f.cid}` : `sha:${f.sha}`;
  const archive = f.refs[0].archive;
  return archive.state === "archived" ? `cid:${archive.cid}` : `url:${f.url}`;
}

function appearance(f: Found): { readonly day: string; readonly seen: FirstSeen } {
  if (f.via === "image") return { day: f.release.released ?? "", seen: { via: "image", release: releaseLabel(f.release) } };
  // Apple's publication date, else the day we first saw the file.
  const published = f.refs[0].published ?? f.refs.map((r) => r.firstSeen.slice(0, 10)).sort()[0] ?? "";
  return { day: published, seen: { via: "ota", published } };
}

function copyOf(f: Found): TimelineCopy {
  if (f.via === "image") return { via: "image", releases: [f.release.id], sha: f.sha, ...(f.cid !== undefined ? { cid: f.cid } : {}) };
  const ref = f.refs[0];
  return {
    via: "ota",
    os: [...new Set(f.refs.map((r) => r.os).filter((os) => os !== "" && os !== "legacy"))].sort(compareVersions),
    url: f.url,
    ...(ref.published !== undefined ? { published: ref.published } : {}),
    ...(ref.digest !== undefined ? { digest: ref.digest } : {}),
    archive: ref.archive,
  };
}

/** Image copies of one sha merge, their releases newest first. */
function mergeCopies(found: readonly [Found, ...Found[]]): readonly [TimelineCopy, ...TimelineCopy[]] {
  const images = new Map<string, Release[]>();
  const others: TimelineCopy[] = [];
  for (const f of found) {
    if (f.via === "image") images.set(f.sha, [...(images.get(f.sha) ?? []), f.release]);
    else others.push(copyOf(f));
  }
  const merged = [...images].map(([sha, releases]): TimelineCopy => {
    const cid = found.find((f) => f.via === "image" && f.sha === sha && f.cid !== undefined);
    return {
      via: "image",
      releases: [...releases].sort((a, b) => compareReleases(b, a)).map((r) => r.id),
      sha,
      ...(cid?.via === "image" && cid.cid !== undefined ? { cid: cid.cid } : {}),
    };
  });
  const [first, ...rest] = [...merged, ...others];
  return first === undefined ? [copyOf(found[0])] : [first, ...rest];
}

interface Content {
  readonly id: string;
  readonly version: string;
  readonly found: readonly [Found, ...Found[]];
  readonly first: { readonly day: string; readonly seen: FirstSeen };
  readonly last: string;
}

function contents(found: readonly Found[]): Content[] {
  const byId = new Map<string, [Found, ...Found[]]>();
  for (const f of found) {
    const list = byId.get(contentOf(f));
    if (list) list.push(f);
    else byId.set(contentOf(f), [f]);
  }
  return [...byId].map(([id, list]) => {
    const seen = list.map(appearance).sort((a, b) => a.day.localeCompare(b.day));
    const dated = seen.find((s) => s.day !== "") ?? appearance(list[0]);
    return { id, version: versionOf(list[0]), found: list, first: dated, last: seen.map((s) => s.day).sort().at(-1) ?? "" };
  });
}

/** One line, newest first. Two contents of one version first seen in one place cannot be named apart: that fails the build. */
function line(found: readonly Found[]): TimelineEntry[] {
  const ordered = contents(found).sort((a, b) => compareVersions(b.version || "0", a.version || "0") || b.last.localeCompare(a.last));
  const named = new Map<string, Content>();
  return ordered.map((c, i): TimelineEntry => {
    const slug = named.has(c.version) ? versionSlug(c.version, c.first.seen) : versionSlug(c.version);
    const clash = named.get(slug);
    if (clash) throw new Error(`timeline: ${slug} names two contents: ${clash.id} and ${c.id}`);
    named.set(slug, c);
    const below = ordered[i + 1];
    // An unarchived OTA file of the version below is that content: Apple versions name one content.
    const sameBelow = below !== undefined && below.version === c.version && (c.id.startsWith("url:") || below.id.startsWith("url:"));
    const images = c.found.flatMap((f) => (f.via === "image" ? [f.release] : []));
    return {
      slug,
      version: c.version,
      copies: mergeCopies(c.found),
      beta: images.length === c.found.length && images.every(isBeta),
      changed: !sameBelow,
    };
  });
}

function otaFiles(refs: readonly OtaRef[]): Found[] {
  const byUrl = new Map<string, [OtaRef, ...OtaRef[]]>();
  for (const r of refs) {
    const list = byUrl.get(r.url);
    if (list) list.push(r);
    else byUrl.set(r.url, [r]);
  }
  return [...byUrl].map(([url, list]): Found => ({ via: "ota", url, refs: list }));
}

function appleTimeline(key: string, releases: readonly AppleRelease[], refs: readonly OtaRef[]): Timeline {
  const images = releases.flatMap((r): Found[] => {
    const a = r.sources[key];
    return a ? [{ via: "image", release: r, sha: a.sha, cid: a.cid, version: a.version }] : [];
  });
  const own = refs.filter((r) => r.source === key);
  const models = [...new Set(own.flatMap((r) => r.model ?? []))].sort();
  return {
    family: "apple",
    entries: line([...images, ...otaFiles(own.filter((r) => r.model === undefined))]),
    models: Object.fromEntries(models.map((m) => [m, line(otaFiles(own.filter((r) => r.model === m)))])),
  };
}

function androidTimeline(key: string, releases: readonly AndroidRelease[]): Timeline {
  const byDevice = new Map<string, Found[]>();
  const holders = new Map<string, string[]>();
  for (const r of releases) {
    for (const a of r.sources[key] ?? []) {
      holders.set(a.sha, [...(holders.get(a.sha) ?? []), ...a.devices]);
      for (const d of a.devices) byDevice.set(d, [...(byDevice.get(d) ?? []), { via: "image", release: r, sha: a.sha, cid: undefined, version: a.version }]);
    }
  }
  return {
    family: "android",
    devices: Object.fromEntries([...byDevice].sort(([a], [b]) => byPixelRank(a, b)).map(([d, found]) => [d, line(found)])),
    canonical: Object.fromEntries([...holders].flatMap(([sha, ds]) => {
      const newest = defaultDevice(ds);
      return newest === undefined ? [] : [[sha, newest]];
    })),
  };
}

const apple = (rs: readonly Release[]): AppleRelease[] => rs.flatMap((r) => (r.platform === "android" ? [] : [r]));
const android = (rs: readonly Release[]): AndroidRelease[] => rs.flatMap((r) => (r.platform === "android" ? [r] : []));

/** A source's timeline; `releases` and `refs` may hold everything. */
export function sourceTimeline(source: SourceRef, releases: readonly Release[], refs: readonly OtaRef[]): Timeline {
  const key = sourceKey(source);
  return decoderFamily(source.platform) === "apple" ? appleTimeline(key, apple(releases), refs) : androidTimeline(key, android(releases));
}

export interface Located {
  /** Android codename or Apple model; undefined for Apple's main line. */
  readonly line: string | undefined;
  readonly entry: TimelineEntry;
}

const headOf = (entries: readonly TimelineEntry[]): TimelineEntry | undefined => entries.find((e) => !e.beta) ?? entries[0];

/** The version a page shows when none is named; Android defaults to the newest flagship's line. */
export function head(timeline: Timeline, lineName?: string): Located | undefined {
  if (timeline.family === "apple") {
    const entry = headOf(lineName === undefined ? timeline.entries : timeline.models[lineName] ?? []);
    return entry ? { line: lineName, entry } : undefined;
  }
  const device = lineName ?? defaultDevice(Object.keys(timeline.devices));
  const entry = device === undefined ? undefined : headOf(timeline.devices[device] ?? []);
  return entry ? { line: device, entry } : undefined;
}

export interface DeviceGroup {
  /** Pixels sharing one file in the newest build carrying the source, newest first. */
  readonly devices: readonly string[];
  /** The line whose URL is canonical for that file. */
  readonly line: string;
  readonly entry: TimelineEntry;
}

/** Which Pixels share a file today. */
export function deviceGroups(source: SourceRef, releases: readonly Release[], timeline: Timeline): DeviceGroup[] {
  if (timeline.family !== "android") return [];
  const key = sourceKey(source);
  const newest = android(releases).filter((r) => (r.sources[key]?.length ?? 0) > 0).sort(compareReleases).at(-1);
  const groups = (newest?.sources[key] ?? []).flatMap((a): DeviceGroup[] => {
    const lineName = timeline.canonical[a.sha];
    const entry = lineName === undefined ? undefined : timeline.devices[lineName]?.find((e) => e.copies.some((c) => c.via === "image" && c.sha === a.sha));
    return lineName !== undefined && entry ? [{ devices: [...a.devices].sort(byPixelRank), line: lineName, entry }] : [];
  });
  return groups.sort((a, b) => byPixelRank(a.devices[0] ?? "", b.devices[0] ?? ""));
}
