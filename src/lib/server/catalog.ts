/**
 * The index the extractor's `index` job writes (index/*). All derived and
 * rebuilt whole by that job: the site only reads and picks from it, and a
 * bucket without one reads as an empty site.
 */

import { error } from "@sveltejs/kit";
import { keys, type CarrierSummary, type CountrySummary, type ReleaseSummary } from "#lib/storage/keys.ts";
import { byPixelRank, defaultDevice } from "#lib/schema/index.ts";
import {
  parseSourceKey, versionPath, type CarrierDoc, type DeviceStates, type LegacyRoute, type Platform, type SourceRef, type Timeline, type TimelineEntry,
} from "#lib/schema/types.ts";
import type { Version } from "#lib/types.ts";
import { perRequest } from "./cache";
import { readJson } from "./store";
import * as records from "./records";

export const carrierList = perRequest(async (): Promise<CarrierSummary[]> => (await readJson(keys.carrierIndex(), records.carrierSummaries)) ?? []);
export const countryList = perRequest(async (): Promise<CountrySummary[]> => (await readJson(keys.countryIndex(), records.countrySummaries)) ?? []);
/** Every platform, newest first. */
export const releaseList = perRequest(async (): Promise<ReleaseSummary[]> => (await readJson(keys.releaseIndex(), records.releaseSummaries)) ?? []);
/** sourceKey -> carrier id. */
const sourceIndex = perRequest(async (): Promise<Readonly<Record<string, string>>> => (await readJson(keys.sourceIndex(), records.sourceIndex)) ?? {});
export const legacyRoutes = perRequest(async (): Promise<readonly LegacyRoute[]> => (await readJson(keys.legacy(), records.legacyRoutes)) ?? []);

const docOf = perRequest((id: string) => readJson(keys.carrier(id), records.carrierDoc));

const NOT_INDEXED_YET = "Something Apple or Google only just published shows up after the next index run, within the hour.";

export const isIndexed = async (key: string): Promise<boolean> => key in (await sourceIndex());

/** A source and the carrier document that holds its timeline. */
export interface Located {
  readonly key: string;
  readonly ref: SourceRef;
  readonly doc: CarrierDoc;
  readonly timeline: Timeline;
  readonly states: readonly DeviceStates[];
}

export const locate = perRequest(async (key: string): Promise<Located> => {
  const ref = parseSourceKey(key);
  if (!ref) error(400, `Not a source key: ${key}`);
  const id = (await sourceIndex())[key];
  const doc = id === undefined ? null : await docOf(id);
  const timeline = doc?.timelines[key];
  if (!doc || !timeline) error(404, `No ${ref.name} on ${ref.platform}. ${NOT_INDEXED_YET}`);
  return { key, ref, doc, timeline, states: doc.states[key] ?? [] };
});

/** A source's lines besides Apple's main one: Android's Pixels (newest first), Apple's model-specific bundles. */
export const linesOf = (t: Timeline): string[] =>
  t.family === "android" ? Object.keys(t.devices).sort(byPixelRank) : Object.keys(t.models).sort();

/** The line a URL without one means: Apple's main line, Android's newest flagship. */
export const defaultLine = (t: Timeline): string | undefined => (t.family === "android" ? defaultDevice(Object.keys(t.devices)) : undefined);

function entriesOf(t: Timeline, line: string | undefined): readonly TimelineEntry[] | undefined {
  if (t.family === "android") return line === undefined ? undefined : t.devices[line];
  return line === undefined ? t.entries : t.models[line];
}

/** A version as a URL names it: source, line, and version (absent: the line's head). */
export interface Ver {
  readonly source: string;
  readonly line?: string | undefined;
  readonly slug?: string | undefined;
}

export interface Resolved extends Located {
  readonly line: string | undefined;
  readonly entries: readonly TimelineEntry[];
  readonly entry: TimelineEntry;
  readonly previous: TimelineEntry | null;
  /** The line's newest non-beta version. */
  readonly head: TimelineEntry;
}

export async function resolve(v: Ver): Promise<Resolved> {
  const located = await locate(v.source);
  const line = v.line ?? defaultLine(located.timeline);
  const entries = entriesOf(located.timeline, line);
  const head = entries?.find((e) => !e.beta) ?? entries?.[0];
  if (!entries || !head) error(404, `${located.ref.name} has no line ${line ?? ""}. ${NOT_INDEXED_YET}`);
  const i = v.slug === undefined ? entries.indexOf(head) : entries.findIndex((e) => e.slug === v.slug);
  const entry = entries[i];
  if (!entry) error(404, `${located.ref.name} has no version ${v.slug ?? ""}. ${NOT_INDEXED_YET}`);
  return { ...located, line, entries, entry, previous: entries[i + 1] ?? null, head };
}

/** The sha of a version's bytes in the bucket: any image copy, or an archived OTA copy. */
export function archivedSha(e: TimelineEntry): string | undefined {
  for (const c of e.copies) {
    if (c.via === "image") return c.sha;
    if (c.archive.state === "archived") return c.archive.sha;
  }
  return undefined;
}

/** Several Pixels often carry one file; the index names the device its page is canonical under. */
export function canonicalPath(r: Resolved): string {
  const sha = archivedSha(r.entry);
  const device = r.timeline.family === "android" && sha !== undefined ? r.timeline.canonical[sha] : undefined;
  const there = device === undefined ? undefined : entriesOf(r.timeline, device)?.find((e) => archivedSha(e) === sha);
  return there ? versionPath(r.ref, there.slug, device) : versionPath(r.ref, r.entry.slug, r.line);
}

/** The same carrier's sources of the same kind on the other platforms. */
export const counterparts = (l: Located): SourceRef[] => l.doc.carrier.members.filter((m) => m.platform !== l.ref.platform && m.kind === l.ref.kind);

const releaseNames = perRequest(async (): Promise<ReadonlyMap<string, string>> =>
  new Map((await releaseList()).map((r) => [`${r.platform}:${r.id}`, r.version])));

/** The newest release of a platform that is not a prerelease. */
export async function currentRelease(platform: Platform): Promise<ReleaseSummary | null> {
  const mine = (await releaseList()).filter((r) => r.platform === platform);
  return mine.find((r) => !r.prerelease) ?? mine[0] ?? null;
}

/** Entries with their copies' releases named by OS version, as pages show them. */
export async function versionsOf(platform: Platform, entries: readonly TimelineEntry[]): Promise<Version[]> {
  const names = await releaseNames();
  return entries.map((e) => ({
    ...e,
    platform,
    images: e.copies.flatMap((c) => (c.via === "image" ? [...c.releases].reverse().map((id) => names.get(`${platform}:${id}`) ?? id) : [])),
    ota: e.copies.flatMap((c) => (c.via === "ota" ? c.os : [])),
  }));
}

export async function versionOf(platform: Platform, entry: TimelineEntry): Promise<Version> {
  const [v] = await versionsOf(platform, [entry]);
  if (!v) error(500, `no version for ${entry.slug}`);
  return v;
}
