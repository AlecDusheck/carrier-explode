/**
 * The index the extractor's `index` job writes (index/*): the carrier and
 * country lists, one document per carrier (and per iOS country bundle) with
 * every member's timeline, the release list, and which document each source
 * is in. All derived, all rebuilt whole by that job; the site only reads and
 * picks from it. A bucket without an index yet reads as an empty site.
 *
 * A page (/carriers/<name>) shows one iOS bundle and its carrier's Android
 * settings in one version strip: the iOS line and the Android line. A carrier
 * with no iOS bundle has only the Android line, under its slug.
 */

import { error } from "@sveltejs/kit";
import { keys, type CarrierSummary, type CountrySummary, type ReleaseSummary } from "#lib/storage/keys.ts";
import { byPixelRank, headIndex, pixelName } from "#lib/schema/index.ts";
import { parseSourceKey, sourceKey, type CarrierDoc, type Platform, type SourceRef, type TimelineEntry } from "#lib/schema/types.ts";
import type { Kind, Version } from "#lib/types.ts";
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

/** sourceKey -> the slug of the document holding its timeline. */
export const sourceSlugs = perRequest(async (): Promise<Readonly<Record<string, string>>> =>
  (await readJson(keys.sources(), records.sourceSlugs)) ?? {});

const docOf = perRequest((slug: string) => readJson(keys.carrier(slug), records.carrierDoc));

/** Why a page or version that does exist can be missing. */
export const NOT_INDEXED_YET = "If Apple or Google only just published it, it shows up after the next index run, within the hour.";

/* ------------------------------------------------------------------ pages */

/** One page: its document, and the source each platform's line of the version strip is. */
export interface Page {
  readonly kind: Kind;
  readonly name: string;
  readonly doc: CarrierDoc;
  readonly lines: Readonly<Partial<Record<Platform, string>>>;
}

const keyOf = (ref: SourceRef): string => sourceKey(ref);

/** The Android source a carrier's page shows: its first Android carrier member (the index lists the primary first). */
const androidLine = (doc: CarrierDoc): string | undefined => {
  const ref = doc.carrier.members.find((m) => m.platform === "android" && m.kind === "carrier");
  return ref && keyOf(ref);
};

/** The iOS source a page name is, by kind. */
function iosKey(kind: Kind, name: string): string {
  if (kind === "countries") return keyOf({ platform: "ios", kind: "country", name });
  return keyOf({ platform: "ios", kind: "carrier", name, ...(kind === "watch" ? { family: "Watch" as const } : {}) });
}

export const pageOf = perRequest(async (kind: Kind, name: string): Promise<Page> => {
  const slugs = await sourceSlugs();
  const ios = iosKey(kind, name);
  const slug = slugs[ios];
  if (slug !== undefined) {
    const doc = await docOf(slug);
    if (!doc) error(404, `No ${name}. ${NOT_INDEXED_YET}`);
    // Watch and country bundles have no Android counterpart; a carrier bundle shares its carrier's.
    const android = kind === "carriers" ? androidLine(doc) : undefined;
    return { kind, name, doc, lines: { ios, ...(android ? { android } : {}) } };
  }
  // A carrier with no iOS bundle: its page is its slug.
  const doc = kind === "carriers" ? await docOf(name) : null;
  const android = doc && androidLine(doc);
  if (!doc || !android || doc.carrier.members.some((m) => m.platform === "ios" && m.kind === "carrier" && !m.family)) {
    error(404, `No bundle named ${name}. ${NOT_INDEXED_YET}`);
  }
  return { kind, name, doc, lines: { android } };
});

/** Which platform a version slug is on: Android slugs say so; every other is iOS. */
export const platformOfSlug = (slug: string): Platform => (slug.startsWith("android-") ? "android" : "ios");

/** The platform a page opens on: iOS where it has a bundle. */
export const homePlatform = (page: Page): Platform => (page.lines.ios ? "ios" : "android");

/** The source a version of a page is: the line of the slug's platform, or the page's home line for its head. */
export function lineOf(page: Page, slug?: string): { readonly platform: Platform; readonly source: string } {
  const platform = slug ? platformOfSlug(slug) : homePlatform(page);
  const source = page.lines[platform];
  if (!source) error(404, `${page.name} has no ${platform === "ios" ? "iOS" : "Android"} versions.`);
  return { platform, source };
}

/** Where a source's page is, for links from places that only know a source key (scans, releases, the SIM table). */
export async function pageFor(key: string): Promise<{ kind: Kind; name: string } | null> {
  const ref = parseSourceKey(key);
  if (!ref) return null;
  if (ref.platform === "ios") {
    const kind: Kind = ref.kind === "country" ? "countries" : ref.family ? "watch" : "carriers";
    return { kind, name: ref.name };
  }
  const slug = (await sourceSlugs())[key];
  return slug === undefined ? null : { kind: "carriers", name: slug };
}

/* -------------------------------------------------------------- versions */

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

/** One version of a source, the one before it on the same line, and the head. */
export interface Resolved extends Located {
  readonly entry: TimelineEntry;
  readonly previous: TimelineEntry | null;
  readonly head: TimelineEntry;
}

/**
 * Whether `b` is an older copy of what `a` is: per-model iOS variants only
 * follow their own model, and an Android entry only an entry for some of the
 * same Pixels (each generation reads its own file).
 */
const sameLine = (a: TimelineEntry, b: TimelineEntry): boolean =>
  a.productType === b.productType && (!a.devices || !b.devices || a.devices.some((d) => b.devices?.includes(d)));

function pick(timeline: readonly TimelineEntry[], i: number, what: string): TimelineEntry {
  const e = timeline[i];
  if (!e) error(404, `${what}. ${NOT_INDEXED_YET}`);
  return e;
}

export async function resolve(key: string, slug?: string): Promise<Resolved> {
  const located = await locate(key);
  const { timeline } = located;
  const head = headIndex(timeline);
  const at = slug === undefined ? head : timeline.findIndex((e) => e.slug === slug);
  const entry = pick(timeline, at, `${located.ref.name} has no version ${slug ?? ""}`);
  const previous = timeline.slice(at + 1).find((e) => sameLine(entry, e)) ?? null;
  return { ...located, entry, previous, head: pick(timeline, head, `${located.ref.name} has no versions`) };
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
  return entries.map((e) => ({
    ...e,
    platform,
    os: e.via === "image" ? e.releases.map((id) => names.get(id) ?? id) : e.releases,
    ...(e.devices ? { phones: [...e.devices].sort(byPixelRank).map(pixelName) } : {}),
  }));
}

/** One entry as a page shows it. */
export async function versionOf(platform: Platform, entry: TimelineEntry): Promise<Version> {
  const [v] = await versionsOf(platform, [entry]);
  if (!v) error(500, "no version");
  return v;
}
