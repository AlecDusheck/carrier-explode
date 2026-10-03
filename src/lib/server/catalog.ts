/**
 * The index the extractor's `index` job writes (index/*): the carrier and
 * country lists, one document per carrier with every member's timeline and
 * feature states, the release list, which document each source is in, and the
 * v1 redirect table. All derived, all rebuilt whole by that job; the site only
 * reads and picks from it. A bucket without an index yet reads as an empty site.
 *
 * Pages are per source (sourcePath: /carriers/ios/Verizon_LTE/72.0/). A
 * carrier document is what links a source to the same carrier's sources on
 * the other platforms.
 */

import { error } from "@sveltejs/kit";
import { keys, type CarrierSummary, type CountrySummary, type ReleaseSummary } from "#lib/storage/keys.ts";
import { byPixelRank, defaultDevice } from "#lib/schema/index.ts";
import { parseSourceKey, versionPath, type CarrierDoc, type DeviceStates, type LegacyRoute, type Platform, type SourceRef, type Timeline, type TimelineEntry } from "#lib/schema/types.ts";
import type { Version } from "#lib/types.ts";
import { perRequest } from "./cache";
import { readJson } from "./store";
import * as records from "./records";

export const carrierList = perRequest(async (): Promise<CarrierSummary[]> =>
  (await readJson(keys.carriers(), records.carrierSummaries)) ?? []);

export const countryList = perRequest(async (): Promise<CountrySummary[]> =>
  (await readJson(keys.countries(), records.countrySummaries)) ?? []);

/** Both platforms, newest first. */
export const releaseList = perRequest(async (): Promise<ReleaseSummary[]> =>
  (await readJson(keys.releases(), records.releaseSummaries)) ?? []);

/** sourceKey -> the id of the carrier document holding its timeline. */
export const sourceSlugs = perRequest(async (): Promise<Readonly<Record<string, string>>> =>
  (await readJson(keys.sources(), records.sourceSlugs)) ?? {});

/** v1 path -> v2 path. */
export const legacyRoutes = perRequest(async (): Promise<readonly LegacyRoute[]> =>
  (await readJson(keys.legacy(), records.legacyRoutes)) ?? []);

const docOf = perRequest((id: string) => readJson(keys.carrier(id), records.carrierDoc));

/** Why a source or version that does exist can be missing. */
const NOT_INDEXED_YET = "If Apple or Google only just published it, it shows up after the next index run, within the hour.";

/** A source with the carrier document its timeline is kept in. */
export interface Located {
  readonly key: string;
  readonly ref: SourceRef;
  readonly doc: CarrierDoc;
  readonly timeline: Timeline;
  /** Its feature states per device group, at the head. */
  readonly states: readonly DeviceStates[];
}

export const locate = perRequest(async (key: string): Promise<Located> => {
  const ref = parseSourceKey(key);
  if (!ref) error(400, `Not a source key: ${key}`);
  const id = (await sourceSlugs())[key];
  const doc = id === undefined ? null : await docOf(id);
  const timeline = doc?.timelines[key];
  if (!doc || !timeline) error(404, `No ${ref.name} on ${ref.platform}. ${NOT_INDEXED_YET}`);
  return { key, ref, doc, timeline, states: doc.states[key] ?? [] };
});

/** A source's lines besides its main one: Android's devices (newest Pixel first), Apple's model-specific bundles. */
export function linesOf(t: Timeline): string[] {
  return t.family === "android" ? Object.keys(t.devices).sort(byPixelRank) : Object.keys(t.models).sort();
}

/** The line a page without one shows: Apple's main line, Android's newest flagship. */
export const defaultLine = (t: Timeline): string | undefined => (t.family === "android" ? defaultDevice(Object.keys(t.devices)) : undefined);

/** The entries of one line, newest first; undefined for a line the source does not have. */
export function entriesOf(t: Timeline, line: string | undefined): readonly TimelineEntry[] | undefined {
  if (t.family === "android") return line === undefined ? undefined : t.devices[line];
  return line === undefined ? t.entries : t.models[line];
}

/** One version of a source on one line, the one before it, and the line's head (its newest non-beta version). */
export interface Resolved extends Located {
  readonly line: string | undefined;
  readonly entries: readonly TimelineEntry[];
  readonly entry: TimelineEntry;
  readonly previous: TimelineEntry | null;
  readonly head: TimelineEntry;
}

/** A version of a source as a URL names it: the source, its line, and the version on it (absent: the line's head). */
export interface Ver {
  readonly source: string;
  readonly line?: string | undefined;
  readonly slug?: string | undefined;
}

export const resolveVer = (v: Ver): Promise<Resolved> => resolve(v.source, v.line, v.slug);

export async function resolve(key: string, line?: string, slug?: string): Promise<Resolved> {
  const located = await locate(key);
  const { timeline, ref } = located;
  const at = line ?? defaultLine(timeline);
  const entries = entriesOf(timeline, at);
  const head = entries?.find((e) => !e.beta) ?? entries?.[0];
  if (!entries || !head) error(404, `${ref.name} has no ${at ?? "main"} line. ${NOT_INDEXED_YET}`);
  const i = slug === undefined ? entries.indexOf(head) : entries.findIndex((e) => e.slug === slug);
  const entry = entries[i];
  if (!entry) error(404, `${ref.name} has no version ${slug ?? ""}${at ? ` on ${at}` : ""}. ${NOT_INDEXED_YET}`);
  return { ...located, line: at, entries, entry, previous: entries[i + 1] ?? null, head };
}

/** The archived sha of a version, when the bucket holds its bytes: every image copy, and OTA copies once archived. */
export const archivedSha = (e: TimelineEntry): string | undefined => e.copies.flatMap((c) => c.sha ?? [])[0];

/**
 * The URL a version's content is canonical at. Several Pixels often carry one
 * file, and each device's line serves it; the index names the newest of them.
 */
export function canonicalPath(r: Resolved): string {
  const sha = archivedSha(r.entry);
  const device = r.timeline.family === "android" && sha !== undefined ? r.timeline.canonical[sha] : undefined;
  const there = device === undefined ? undefined : entriesOf(r.timeline, device)?.find((e) => e.copies.some((c) => c.sha === sha));
  return there && device !== undefined ? versionPath(r.ref, there.slug, device) : versionPath(r.ref, r.entry.slug, r.line);
}

/** The same carrier's sources on the other platforms, for the bundle head's links. */
export function counterparts(l: Located): SourceRef[] {
  return l.doc.carrier.members.filter((m) => m.platform !== l.ref.platform && m.kind === l.ref.kind);
}

/* -------------------------------------------------------------- releases */

/** Release id -> version, per platform: what an image copy's `releases` read as. */
const releaseVersions = perRequest(async (): Promise<ReadonlyMap<string, string>> =>
  new Map((await releaseList()).map((r) => [`${r.platform}:${r.id}`, r.version])));

/** The newest release of a platform that is not a prerelease: what "current" means. */
export async function currentRelease(platform: Platform): Promise<ReleaseSummary | null> {
  const mine = (await releaseList()).filter((r) => r.platform === platform);
  return mine.find((r) => !r.prerelease) ?? mine[0] ?? null;
}

/** Entries as pages show them: with the OS versions of the images carrying each, and the OS keys it is published under. */
export async function versionsOf(platform: Platform, entries: readonly TimelineEntry[]): Promise<Version[]> {
  const names = await releaseVersions();
  return entries.map((e) => ({
    ...e,
    platform,
    images: e.copies.flatMap((c) => (c.via === "image" ? c.releases.map((id) => names.get(`${platform}:${id}`) ?? id) : [])),
    ota: e.copies.flatMap((c) => (c.via === "ota" ? c.os : [])),
  }));
}

export async function versionOf(platform: Platform, entry: TimelineEntry): Promise<Version> {
  const [v] = await versionsOf(platform, [entry]);
  if (!v) error(500, `no version for ${entry.slug}`);
  return v;
}
