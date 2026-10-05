/** The index in D1, as pages read it. A bucket the extractor has not published yet reads as an empty site. */

import { error } from "@sveltejs/kit";
import { getRequestEvent } from "$app/server";
import { carrierSummaries, countrySummaries, releaseList as releases, sourceOf } from "@carrier-explode/db/d1";
import {
  canonicalLine, currentRelease as currentOf, parseSourceKey, sourceKey, versionOn, versionPath,
  type Carrier, type CarrierModem, type CarrierSummary, type CountrySummary, type EntryRef, type Line, type Platform, type ReleasePlatform, type ReleaseSummary, type SourceKey, type SourceRef, type Timeline, type TimelineEntry,
} from "@carrier-explode/schema";
import { NAMING, releaseOs } from "#lib/naming.ts";
import type { Ver, Version } from "#lib/types.ts";
import { perRequest } from "./cache";
import { db } from "./db";

export const carrierList = perRequest(async (): Promise<readonly CarrierSummary[]> => carrierSummaries(await db()));
export const countryList = perRequest(async (): Promise<readonly CountrySummary[]> => countrySummaries(await db()));
/** Both platforms with OS images, newest first. */
export const releaseList = perRequest(async (): Promise<readonly ReleaseSummary[]> => releases(await db()));

const NOT_INDEXED_YET = "Something Apple or Google only just published shows up after the next index run, within the hour.";

const sourceRow = perRequest(async (key: SourceKey) => sourceOf(await db(), key));

export const isIndexed = async (key: SourceKey): Promise<boolean> => (await sourceRow(key)) !== undefined;

/** A source, its timeline, and the carrier holding it. */
export interface Located {
  readonly key: SourceKey;
  readonly ref: SourceRef;
  readonly carrier: Carrier;
  readonly modems: readonly CarrierModem[];
  readonly timeline: Timeline;
}

/** `key` is untrusted: it comes from a URL or a query argument. */
export const locate = perRequest(async (key: string): Promise<Located> => {
  const ref = parseSourceKey(key);
  if (!ref) error(400, `Not a source key: ${key}`);
  const typed = sourceKey(ref);
  const row = await sourceRow(typed);
  if (!row) error(404, `No ${ref.name} on ${ref.platform}. ${NOT_INDEXED_YET}`);
  getRequestEvent().locals.sources.add(typed);
  return { key: typed, ref, carrier: row.carrier, modems: row.modems, timeline: row.timeline };
});

/** A Ver from the strings a per-request cache keys by, where "" is a missing line or version. */
export const verFrom = (source: string, line: string, slug: string): Ver => ({ source, ...(line ? { line } : {}), ...(slug ? { slug } : {}) });

/** A resolved version as query args again: Apple's main line has no line segment. */
export const verAt = (source: string, at: EntryRef): Ver => (at.line === null ? { source, slug: at.slug } : { source, line: at.line, slug: at.slug });

export interface Resolved extends Located {
  readonly line: string | null;
  readonly entries: Line;
  readonly entry: TimelineEntry;
  readonly previous: TimelineEntry | null;
  /** The line's newest non-beta version. */
  readonly latest: TimelineEntry;
}

export async function resolve(v: Ver): Promise<Resolved> {
  const located = await locate(v.source);
  const at = versionOn(located.timeline, v.line ?? null, v.slug);
  if (!at.found) error(404, `${located.ref.name} has no ${at.missing} ${(at.missing === "line" ? v.line : v.slug) ?? ""}. ${NOT_INDEXED_YET}`);
  const { line, entries, entry, previous, latest } = at;
  return { ...located, line, entries, entry, previous, latest };
}

/** Several Pixels often carry one file; the index names the device its page is canonical under. */
export const canonicalPath = (r: Resolved): string => versionPath(r.ref, canonicalLine(r.timeline, r.entry.sha) ?? { line: r.line, slug: r.entry.slug });

const releaseNames = perRequest(async (): Promise<ReadonlyMap<string, string>> =>
  new Map((await releaseList()).map((r) => [`${r.platform}:${r.id}`, releaseOs(r)])));

/** The OS images whose devices are a platform's phones: iPads and watches ship in none. */
export const PHONE_IMAGES = { ios: "ios", ipados: null, watchos: null, android: "android" } as const satisfies Record<Platform, ReleasePlatform | null>;

/** The newest release of a platform that is not a prerelease. */
export const currentRelease = async (platform: ReleasePlatform): Promise<ReleaseSummary | null> => currentOf(await releaseList(), platform) ?? null;

/** Entries named by their copies' releases, as pages show them. */
export async function versionsOf(platform: Platform, entries: readonly TimelineEntry[]): Promise<Version[]> {
  const names = await releaseNames();
  // Only phones' platforms ship in OS images.
  const images = PHONE_IMAGES[platform];
  const naming = NAMING[platform];
  return entries.map((e) => {
    const carried = {
      images: e.copies.flatMap((c) => (c.kind === "image" && images !== null ? [...c.releases].reverse().map((id) => names.get(`${images}:${id}`) ?? id) : [])),
      ota: e.copies.flatMap((c) => (c.kind === "ota" ? c.os : [])),
      version: e.version,
    };
    return { ...e, platform, label: naming.label(carried), icon: naming.icon(carried) };
  });
}

export async function versionOf(platform: Platform, entry: TimelineEntry): Promise<Version> {
  const [v] = await versionsOf(platform, [entry]);
  if (!v) error(500, `no version for ${entry.slug}`);
  return v;
}
