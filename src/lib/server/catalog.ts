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
import { headIndex } from "#lib/schema/index.ts";
import { parseSourceKey, type CarrierDoc, type DeviceStates, type LegacyRoute, type Platform, type SourceRef, type TimelineEntry } from "#lib/schema/types.ts";
import type { Version } from "#lib/types.ts";
import { perRequest } from "./cache";
import { named } from "./devices";
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
  readonly timeline: readonly TimelineEntry[];
  /** Its feature states per device group, at the head. */
  readonly states: readonly DeviceStates[];
}

export const locate = perRequest(async (key: string): Promise<Located> => {
  const ref = parseSourceKey(key);
  if (!ref) error(400, `Not a source key: ${key}`);
  const id = (await sourceSlugs())[key];
  const doc = id === undefined ? null : await docOf(id);
  const timeline = doc?.timelines[key];
  if (!doc || !timeline?.length) error(404, `No ${ref.name} on ${ref.platform}. ${NOT_INDEXED_YET}`);
  return { key, ref, doc, timeline, states: doc.states[key] ?? [] };
});

/** One version of a source, the one before it on the same line, and the head. */
export interface Resolved extends Located {
  readonly entry: TimelineEntry;
  readonly previous: TimelineEntry | null;
  readonly head: TimelineEntry;
}

/** Whether `b` is an older copy of what `a` is for: entries for disjoint devices are separate lines. */
const sameLine = (a: TimelineEntry, b: TimelineEntry): boolean =>
  !a.devices || !b.devices || a.devices.some((d) => b.devices?.includes(d));

function pick(timeline: readonly TimelineEntry[], i: number, what: string): TimelineEntry {
  const e = timeline[i];
  if (!e) error(404, `${what}. ${NOT_INDEXED_YET}`);
  return e;
}

export async function resolve(key: string, slug?: string): Promise<Resolved> {
  const located = await locate(key);
  const { timeline, ref } = located;
  const head = headIndex(timeline);
  const at = slug === undefined ? head : timeline.findIndex((e) => e.slug === slug);
  const entry = pick(timeline, at, `${ref.name} has no version ${slug ?? ""}`);
  const previous = timeline.slice(at + 1).find((e) => sameLine(entry, e)) ?? null;
  return { ...located, entry, previous, head: pick(timeline, head, `${ref.name} has no versions`) };
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

/** Entries as pages show them: with the OS versions of the images carrying each, the OS keys it is published for, and the phones it is for. */
export async function versionsOf(platform: Platform, entries: readonly TimelineEntry[]): Promise<Version[]> {
  const names = await releaseVersions();
  return entries.map((e) => ({
    ...e,
    platform,
    images: e.copies.flatMap((c) => (c.via === "image" ? c.releases.map((id) => names.get(`${platform}:${id}`) ?? id) : [])),
    ota: e.copies.flatMap((c) => (c.via === "ota" ? c.os : [])),
    phones: named(platform, e.devices ?? []).map((d) => d.name),
  }));
}

export async function versionOf(platform: Platform, entry: TimelineEntry): Promise<Version> {
  const [v] = await versionsOf(platform, [entry]);
  if (!v) error(500, `no version for ${entry.slug}`);
  return v;
}
