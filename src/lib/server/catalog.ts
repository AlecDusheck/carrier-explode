/**
 * The index the extractor's `index` job writes (index/*): the carrier and
 * country lists, one document per carrier with every member's timeline, the
 * release list, and which carrier each source belongs to. All derived, all
 * rebuilt whole by that job; the site only reads and picks from it. A bucket
 * without an index yet reads as an empty site.
 */

import { error } from "@sveltejs/kit";
import { keys, type CarrierSummary, type CountrySummary, type ReleaseSummary } from "#lib/storage/keys.ts";
import { parseSourceKey, type CarrierDoc, type Platform, type SourceRef, type TimelineEntry } from "#lib/schema/types.ts";
import type { Place, Version } from "#lib/types.ts";
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

/** sourceKey -> the slug of the carrier document holding its timeline. */
export const sourceSlugs = perRequest(async (): Promise<Readonly<Record<string, string>>> =>
  (await readJson(keys.sources(), records.sourceSlugs)) ?? {});

const docOf = perRequest((slug: string) => readJson(keys.carrier(slug), records.carrierDoc));

/** Why a version that does exist can be missing. */
const NOT_INDEXED_YET = "A file Apple or Google only just published shows up after the next index run, within the hour.";

export async function carrierDoc(slug: string): Promise<CarrierDoc> {
  const doc = await docOf(slug);
  if (!doc) error(404, `No carrier ${slug}.`);
  return doc;
}

/** A source with the document its timeline is kept in. */
export interface Located {
  readonly key: string;
  readonly ref: SourceRef;
  readonly doc: CarrierDoc;
  readonly timeline: readonly TimelineEntry[];
}

export const locate = perRequest(async (key: string): Promise<Located> => {
  const ref = parseSourceKey(key);
  if (!ref) error(400, `Not a source key: ${key}`);
  const slug = (await sourceSlugs())[key];
  const doc = slug === undefined ? null : await docOf(slug);
  const timeline = doc?.timelines[key];
  if (!doc || !timeline?.length) error(404, `No source ${key}. ${NOT_INDEXED_YET}`);
  return { key, ref, doc, timeline };
});

/**
 * The version a page shows when none is named: the newest plain copy a
 * release carries. Beta-only builds and per-model variants are one click away
 * in the timeline, but they are not what most phones run.
 */
export function headIndex(timeline: readonly TimelineEntry[]): number {
  const plain = timeline.findIndex((e) => !e.productType && !e.beta);
  return plain >= 0 ? plain : Math.max(0, timeline.findIndex((e) => !e.productType));
}

/** One version of a source, the one before it, and the head. */
export interface Resolved extends Located {
  readonly entry: TimelineEntry;
  readonly previous: TimelineEntry | null;
  readonly head: TimelineEntry;
}

function pick(timeline: readonly TimelineEntry[], i: number, what: string): TimelineEntry {
  const e = timeline[i];
  if (!e) error(404, `${what}. ${NOT_INDEXED_YET}`);
  return e;
}

export async function resolve(key: string, slug?: string): Promise<Resolved> {
  const located = await locate(key);
  const { timeline } = located;
  const at = slug === undefined ? headIndex(timeline) : timeline.findIndex((e) => e.slug === slug);
  const entry = pick(timeline, at, `${located.ref.name} has no version ${slug ?? ""}`);
  // "Previous" skips per-model variants unless this is one.
  const previous = timeline.slice(at + 1).find((e) => e.productType === entry.productType) ?? null;
  return { ...located, entry, previous, head: pick(timeline, headIndex(timeline), `${located.ref.name} has no versions`) };
}

/** Where a source's pages live: its country (iOS country bundles) or its carrier. */
export async function placeOf(key: string): Promise<Place | null> {
  const ref = parseSourceKey(key);
  if (ref?.kind === "country") {
    const country = (await countryList()).find((c) => c.countryBundles.includes(key));
    return country ? { group: "countries", id: country.iso } : null;
  }
  const slug = (await sourceSlugs())[key];
  return slug === undefined ? null : { group: "carriers", id: slug };
}

/** Release id -> version, per platform: what an image entry's `releases` read as. */
export const releaseVersions = perRequest(async (): Promise<Readonly<Record<Platform, ReadonlyMap<string, string>>>> => {
  const all = await releaseList();
  const of = (p: Platform): Map<string, string> => new Map(all.filter((r) => r.platform === p).map((r) => [r.id, r.version]));
  return { ios: of("ios"), android: of("android") };
});

/** The newest release of a platform that is not a prerelease: what "current" means. */
export async function currentRelease(platform: Platform): Promise<ReleaseSummary | null> {
  const mine = (await releaseList()).filter((r) => r.platform === platform);
  return mine.find((r) => !r.prerelease) ?? mine[0] ?? null;
}

/** Entries as pages show them, with the OS versions each one's releases are. */
export async function versionsOf(platform: Platform, entries: readonly TimelineEntry[]): Promise<Version[]> {
  const names = (await releaseVersions())[platform];
  return entries.map((e) => ({ ...e, os: e.via === "image" ? e.releases.map((id) => names.get(id) ?? id) : e.releases }));
}
