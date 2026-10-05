/** Per-source histories: one entry per distinct content on a line, newest first. */

import { newestOf, type DeviceOrder } from "./devices.ts";
import {
  sourceKey, versionSlug,
  type AndroidArtifact, type AndroidRelease, type AppleRelease, type EntryRef, type FirstSeen, type Line, type OtaFile, type OtaListing, type Release,
  type SourceRef, type Timeline, type TimelineCopy, type TimelineEntry,
} from "./types.ts";
import { compareDotted } from "./versions.ts";

/** Oldest first; Pixel builds of one Android version order by patch level. */
export function compareReleases(a: Release, b: Release): number {
  const patch = (r: Release): string => (r.platform === "android" ? r.patch : "");
  return compareDotted(a.version, b.version)
    || patch(a).localeCompare(patch(b))
    || (a.released ?? "").localeCompare(b.released ?? "")
    || a.id.localeCompare(b.id);
}

/** A release's artifacts for one source; sources are keyed by sourceKey. */
export const artifactsOf = <A>(sources: Readonly<Record<string, A>>, key: string): A | undefined => sources[key];

/** A copy as found: an image's artifact, or an OTA file with this source's listings of it. */
type Found =
  | { readonly kind: "image"; readonly release: Release; readonly sha: string; readonly cid: string | undefined; readonly version: string }
  | { readonly kind: "ota"; readonly file: OtaFile; readonly listings: readonly OtaListing[] };

const versionOf = (f: Found): string => (f.kind === "image" ? f.version : f.file.version);

/** Equal cid (Apple bundles keep it across re-zipping), else equal sha. */
function contentOf(f: Found): string {
  if (f.kind === "image") return f.cid === undefined ? `sha:${f.sha}` : `cid:${f.cid}`;
  return `cid:${f.file.cid}`;
}

/** Apple's publication date, else the day the file was first listed, or the image's release. */
function appearance(f: Found): { readonly day: string; readonly seen: FirstSeen } {
  if (f.kind === "image") return { day: f.release.released ?? "", seen: { kind: "image", build: f.release.id } };
  const day = f.file.published ?? f.listings.map((l) => l.firstSeenAt.slice(0, 10)).sort()[0] ?? "";
  return { day, seen: { kind: "ota", day } };
}

const shaOf = (f: Found): string => (f.kind === "image" ? f.sha : f.file.sha);

const isBeta = (f: Found): boolean => f.kind === "image" && f.release.platform === "ios" && f.release.prerelease;

/** Image copies of one sha merge, their releases newest first. */
function copiesOf(found: readonly [Found, ...Found[]]): readonly [TimelineCopy, ...TimelineCopy[]] {
  const images = new Map<string, Release[]>();
  const otas: TimelineCopy[] = [];
  for (const f of found) {
    if (f.kind === "image") {
      images.set(f.sha, [...(images.get(f.sha) ?? []), f.release]);
      continue;
    }
    const os = [...new Set(f.listings.flatMap((l) => l.os ?? []))].sort(compareDotted);
    const { url, digests, published } = f.file;
    otas.push({ kind: "ota", os, url, digests, ...(published === undefined ? {} : { published }) });
  }
  const imageCopies = [...images].map(([sha, rs]): TimelineCopy => ({
    kind: "image", sha, releases: [...rs].sort((a, b) => compareReleases(b, a)).map((r) => r.id),
  }));
  const [first, ...rest] = [...imageCopies, ...otas];
  if (first === undefined) throw new Error("timeline: an entry with no copies");
  return [first, ...rest];
}

interface Content {
  readonly id: string;
  readonly version: string;
  readonly found: readonly [Found, ...Found[]];
  readonly firstSeen: FirstSeen;
  readonly lastDay: string;
}

/** One per (content, version): identical bytes reappear under new versions (others.pb parts take others.pb's). */
function contents(found: readonly Found[]): Content[] {
  const byKey = new Map<string, [Found, ...Found[]]>();
  for (const f of found) {
    const key = `${contentOf(f)}@${versionOf(f)}`;
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [f]);
    else list.push(f);
  }
  return [...byKey.values()].map((list) => {
    const seen = list.map(appearance).sort((a, b) => a.day.localeCompare(b.day));
    const first = seen.find((s) => s.day !== "") ?? appearance(list[0]);
    return { id: contentOf(list[0]), version: versionOf(list[0]), found: list, firstSeen: first.seen, lastDay: seen.at(-1)?.day ?? "" };
  });
}

/** Newest first. A reused version names its older contents by first appearance; two it cannot tell apart fail the build. */
function line(found: readonly Found[]): Line {
  const ordered = contents(found).sort((a, b) =>
    compareDotted(b.version, a.version) || b.lastDay.localeCompare(a.lastDay) || a.id.localeCompare(b.id));
  const named = new Map<string, Content>();
  return ordered.map((c, i): TimelineEntry => {
    const slug = versionSlug(c.version, named.has(c.version) ? c.firstSeen : undefined);
    const clash = named.get(slug);
    if (clash !== undefined) throw new Error(`timeline: ${slug} names two contents: ${clash.id} and ${c.id}`);
    named.set(slug, c);
    const below = ordered[i + 1];
    return {
      slug,
      version: c.version,
      sha: shaOf(c.found[0]),
      copies: copiesOf(c.found),
      beta: c.found.every(isBeta),
      changed: below?.id !== c.id,
    };
  });
}

function otaCopies(key: string, files: readonly OtaFile[], model: string | undefined): Found[] {
  return files.flatMap((file): Found[] => {
    const listings = file.listings.filter((l) => l.source === key && l.model === model);
    return listings.length > 0 ? [{ kind: "ota", file, listings }] : [];
  });
}

function appleTimeline(source: SourceRef, releases: readonly AppleRelease[], files: readonly OtaFile[], order: DeviceOrder): Timeline {
  const key = sourceKey(source);
  const images = releases.flatMap((r): Found[] => {
    const a = artifactsOf(r.sources, key);
    return a === undefined ? [] : [{ kind: "image", release: r, sha: a.sha, cid: a.cid, version: a.version }];
  });
  const models = [...new Set(files.flatMap((f) => f.listings.flatMap((l) => (l.source === key && l.model !== undefined ? [l.model] : []))))].sort(order);
  return {
    kind: "apple",
    main: line([...images, ...otaCopies(key, files, undefined)]),
    models: Object.fromEntries(models.map((m) => [m, line(otaCopies(key, files, m))])),
  };
}

/** Lines newest device first, so a line's place is its device's; each sha's canonical line is its newest device's. */
function androidTimeline(source: SourceRef, releases: readonly AndroidRelease[], order: DeviceOrder): Timeline {
  const key = sourceKey(source);
  const byDevice = new Map<string, Found[]>();
  const holders = new Map<string, string[]>();
  for (const r of releases) {
    for (const a of artifactsOf(r.sources, key) ?? []) {
      holders.set(a.sha, [...(holders.get(a.sha) ?? []), ...a.devices]);
      for (const d of a.devices) byDevice.set(d, [...(byDevice.get(d) ?? []), { kind: "image", release: r, sha: a.sha, cid: undefined, version: a.version }]);
    }
  }
  return {
    kind: "android",
    devices: Object.fromEntries([...byDevice].sort(([a], [b]) => order(a, b)).map(([d, found]) => [d, line(found)])),
    canonical: Object.fromEntries([...holders].flatMap(([sha, ds]) => {
      const newest = newestOf(order, ds);
      return newest === undefined ? [] : [[sha, newest]];
    })),
  };
}

const appleReleases = (rs: readonly Release[]): AppleRelease[] => rs.flatMap((r) => (r.platform === "ios" ? [r] : []));
const androidReleases = (rs: readonly Release[]): AndroidRelease[] => rs.flatMap((r) => (r.platform === "android" ? [r] : []));

/** A source's timeline; `releases` and `files` may hold everything. */
export function sourceTimeline(source: SourceRef, releases: readonly Release[], files: readonly OtaFile[], order: DeviceOrder): Timeline {
  return source.platform === "android" ? androidTimeline(source, androidReleases(releases), order) : appleTimeline(source, appleReleases(releases), files, order);
}

/** A line by name: an Android codename, an Apple model, or null for Apple's main line. */
export function lineOf(timeline: Timeline, name: string | null): Line {
  if (timeline.kind === "apple") return name === null ? timeline.main : timeline.models[name] ?? [];
  return name === null ? [] : timeline.devices[name] ?? [];
}

/** Every line of a source, the default first: null for Apple's main line, then its models newest first; Android's Pixels, newest first. */
export function linesOf(timeline: Timeline): Array<string | null> {
  return timeline.kind === "apple" ? [null, ...Object.keys(timeline.models)] : Object.keys(timeline.devices);
}

/** Where the version holding `sha` is canonical: on Android, its newest Pixel's line; an Apple version is canonical where it is. */
export function canonicalLine(timeline: Timeline, sha: string): EntryRef | undefined {
  if (timeline.kind !== "android") return undefined;
  const line = timeline.canonical[sha];
  const entry = line === undefined ? undefined : lineOf(timeline, line).find((e) => e.sha === sha);
  return line === undefined || entry === undefined ? undefined : { line, slug: entry.slug };
}

export interface Located {
  readonly line: string | null;
  readonly entry: TimelineEntry;
}

/** The version a page shows when none is named: the newest release, else the newest beta. Android defaults to the newest device's line. */
export function head(timeline: Timeline, name: string | null = null): Located | undefined {
  const line = timeline.kind === "android" ? name ?? Object.keys(timeline.devices)[0] ?? null : name;
  const entries = lineOf(timeline, line);
  const entry = entries.find((e) => !e.beta) ?? entries[0];
  return entry === undefined ? undefined : { line, entry };
}

/** A version on a line, the one before it, and the line's head; or what the timeline lacks. */
export type VersionLookup =
  | {
      readonly found: true;
      readonly line: string | null;
      readonly entries: Line;
      readonly entry: TimelineEntry;
      readonly previous: TimelineEntry | null;
      readonly latest: TimelineEntry;
    }
  | { readonly found: false; readonly missing: "line" | "version" };

/** The version `slug` names on line `name` (Android's default: its newest device), or the line's head without a slug. */
export function versionOn(timeline: Timeline, name: string | null, slug: string | undefined): VersionLookup {
  const at = head(timeline, name);
  if (!at) return { found: false, missing: "line" };
  const entries = lineOf(timeline, at.line);
  const i = slug === undefined ? entries.indexOf(at.entry) : entries.findIndex((e) => e.slug === slug);
  const entry = entries[i];
  if (!entry) return { found: false, missing: "version" };
  return { found: true, line: at.line, entries, entry, previous: entries[i + 1] ?? null, latest: at.entry };
}

interface PixelGroup {
  /** Pixels sharing one file in the newest build carrying the source, newest first. */
  readonly devices: readonly [string, ...string[]];
  /** The line whose URL is canonical for that file. */
  readonly line: string;
  readonly entry: TimelineEntry;
}

/** Which Pixels share a file today. */
export function pixelGroups(source: SourceRef, releases: readonly Release[], timeline: Timeline, order: DeviceOrder): PixelGroup[] {
  if (timeline.kind !== "android") return [];
  const key = sourceKey(source);
  const carrying = (r: AndroidRelease): readonly AndroidArtifact[] => artifactsOf(r.sources, key) ?? [];
  const newest = androidReleases(releases).filter((r) => carrying(r).length > 0).sort(compareReleases).at(-1);
  const groups = (newest === undefined ? [] : carrying(newest)).flatMap((a): PixelGroup[] => {
    const canonical = timeline.canonical[a.sha];
    const entry = canonical === undefined ? undefined : lineOf(timeline, canonical).find((e) => e.copies.some((c) => c.kind === "image" && c.sha === a.sha));
    const [first, ...rest] = a.devices.toSorted(order);
    return canonical !== undefined && entry !== undefined && first !== undefined ? [{ devices: [first, ...rest], line: canonical, entry }] : [];
  });
  return groups.sort((a, b) => order(a.devices[0], b.devices[0]));
}
