/**
 * v1 URL prefixes -> v2 paths, for the site's permanent redirects
 * (index/legacy.json).
 *
 * v1 had one page per bundle name and kind (`/carriers/<Name>`,
 * `/watch/<Name>`, `/countries/<Name>`), its versions in one strip:
 *   ios-<version>[-<image build>]   an iOS image's copy
 *   ota-<build>[-<n>]               an OTA file; -2, -3 for more files of one build
 *   ota-<build>-<productType>[-<n>] iPad (now ipados), a model (now that model's line),
 *                                   iPhone (the manifest's CarrierBundles.iPhone family)
 *   ota-legacy                      the 2009-2010 MobileDeviceCarrierBundles file
 * Each is derived here from the v2 copy it named, not by replaying v1's
 * ordering: an image copy answers to `ios-<version>-<build>` for every release
 * carrying it and the bare `ios-<version>` from the newest entry with that iOS
 * version; OTA files sharing a v1 slug are numbered in v1's order (OS key,
 * then build, newest first).
 */

import { compareVersions } from "#lib/decode/index.ts";
import type { OtaRef } from "#lib/storage/keys.ts";
import { modelOf } from "./timeline.ts";
import {
  parseSourceKey, sourceKey, sourcePath, versionPath,
  type LegacyRoute, type Platform, type Release, type SourceKind, type SourceRef, type Timeline, type TimelineEntry,
} from "./types.ts";

interface Line { readonly source: SourceRef; readonly line: string | undefined; readonly entries: readonly TimelineEntry[] }

/** Every line of an Apple timeline, with its URL line segment. */
function appleLines(source: SourceRef, t: Timeline | undefined): Line[] {
  if (t?.family !== "apple") return [];
  return [{ source, line: undefined, entries: t.entries }, ...Object.entries(t.models).map(([line, entries]) => ({ source, line, entries }))];
}

const pathOf = (l: Line, e: TimelineEntry): string => versionPath(l.source, e.slug, l.line);

const v1Image = (version: string): string => `ios-${version.trim().replace(/\s+/g, "-")}`;

function imageRoutes(base: string, lines: readonly Line[], releases: ReadonlyMap<string, Release>): LegacyRoute[] {
  const out: LegacyRoute[] = [];
  const bare = new Set<string>();
  for (const l of lines) {
    for (const e of l.entries) {
      for (const c of e.copies) {
        if (c.via !== "image") continue;
        for (const id of c.releases) {
          const r = releases.get(id);
          if (!r) continue;
          const slug = v1Image(r.version);
          out.push({ from: `${base}/${slug}-${r.id}`, to: pathOf(l, e) });
          // Entries are newest first, so the first to claim a bare slug is the one v1 gave it to.
          if (!bare.has(slug)) out.push({ from: `${base}/${slug}`, to: pathOf(l, e) });
          bare.add(slug);
        }
      }
    }
  }
  return out;
}

/** v1's per-model suffix for a ref of `source`. */
function v1Suffix(ref: OtaRef, source: SourceRef): string | undefined {
  const model = modelOf(ref.productType);
  if (model !== undefined) return model;
  if (source.platform === "ipados") return "iPad";
  // CarrierBundles.iPhone entries are listed under OS keys `iPhone <n>`.
  return ref.os.startsWith("iPhone ") ? "iPhone" : undefined;
}

function otaRoutes(base: string, lines: readonly Line[], refs: readonly OtaRef[]): LegacyRoute[] {
  const where = new Map<string, string>();
  for (const l of lines) {
    for (const e of l.entries) {
      for (const c of e.copies) if (c.via === "ota") where.set(c.url, pathOf(l, e));
    }
  }
  const sources = new Map(lines.map((l) => [sourceKey(l.source), l.source]));
  // One v1 entry per URL, at its highest OS key: v1 listed refs newest OS first and kept a URL's first sighting.
  const files = new Map<string, { slug: string; os: string; build: string }>();
  for (const r of refs) {
    const source = sources.get(r.source);
    if (!source) continue;
    const suffix = v1Suffix(r, source);
    const slug = r.os === "legacy" ? "ota-legacy" : `ota-${r.build}${suffix === undefined ? "" : `-${suffix}`}`;
    const known = files.get(r.url);
    if (!known || compareVersions(r.os, known.os) > 0) files.set(r.url, { slug, os: r.os, build: r.build });
  }
  const bySlug = new Map<string, Array<{ url: string; os: string; build: string }>>();
  for (const [url, f] of files) bySlug.set(f.slug, [...(bySlug.get(f.slug) ?? []), { url, os: f.os, build: f.build }]);
  return [...bySlug].flatMap(([slug, list]) =>
    list
      .sort((a, b) => compareVersions(b.os, a.os) || compareVersions(b.build, a.build) || a.url.localeCompare(b.url))
      .flatMap((f, i): LegacyRoute[] => {
        const to = where.get(f.url);
        return to === undefined ? [] : [{ from: `${base}/${i === 0 ? slug : `${slug}-${i + 1}`}`, to }];
      }));
}

/**
 * Every v1 prefix: each name's page, and each version it listed. `timelines`
 * holds every v2 source's timeline by sourceKey.
 */
export function legacyRoutes(releases: readonly Release[], refs: readonly OtaRef[], timelines: ReadonlyMap<string, Timeline>): LegacyRoute[] {
  const byId = new Map(releases.map((r) => [r.id, r]));
  const sources = [...timelines.keys()].flatMap((k) => parseSourceKey(k) ?? []);
  const names = (platforms: readonly Platform[], kind: SourceKind): string[] =>
    [...new Set(sources.filter((s) => platforms.includes(s.platform) && s.kind === kind).map((s) => s.name))].sort();
  const timeline = (s: SourceRef): Timeline | undefined => timelines.get(sourceKey(s));
  const routes: LegacyRoute[] = [];
  const strip = (base: string, home: SourceRef, members: readonly SourceRef[]): void => {
    const lines = members.flatMap((s) => appleLines(s, timeline(s)));
    routes.push({ from: base, to: sourcePath(home) });
    routes.push(...imageRoutes(base, lines, byId), ...otaRoutes(base, lines, refs));
  };
  for (const name of names(["ios", "ipados"], "carrier")) {
    const ios: SourceRef = { platform: "ios", kind: "carrier", name };
    const ipados: SourceRef = { platform: "ipados", kind: "carrier", name };
    // v1's page was the iPhone bundle's; a name only iPads ever had lands on its iPadOS source.
    strip(`/carriers/${encodeURIComponent(name)}`, timeline(ios) ? ios : ipados, [ios, ipados]);
  }
  for (const name of names(["watchos"], "carrier")) {
    const watch: SourceRef = { platform: "watchos", kind: "carrier", name };
    strip(`/watch/${encodeURIComponent(name)}`, watch, [watch]);
  }
  for (const name of names(["ios"], "country")) {
    const country: SourceRef = { platform: "ios", kind: "country", name };
    strip(`/countries/${encodeURIComponent(name)}`, country, [country]);
  }
  return routes;
}
