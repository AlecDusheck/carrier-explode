/** v1 path prefixes -> v2 paths, each v1 slug derived from the v2 copy it named. test/schema-timeline.test.ts ports v1's algorithm to check every slug resolves. */

import { compareVersions } from "@carrier-explode/decode-ios";
import {
  sourceKey, sourceOf, sourcePath, versionPath,
  type LegacyRoute, type Line, type OtaFile, type OtaListing, type Release, type SourceKey, type SourceRef, type Timeline, type TimelineEntry,
} from "../types.ts";

interface SourceLine {
  readonly source: SourceRef;
  readonly line: string | null;
  readonly entries: Line;
}

function appleLines(source: SourceRef, t: Timeline | undefined): SourceLine[] {
  if (t?.kind !== "apple") return [];
  return [{ source, line: null, entries: t.main }, ...Object.entries(t.models).map(([line, entries]) => ({ source, line, entries }))];
}

const pathOf = (l: SourceLine, e: TimelineEntry): string => versionPath(l.source, { line: l.line, slug: e.slug });

const v1Image = (label: string): string => `ios-${label.trim().replace(/\s+/g, "-")}`;

/** `ios-<label>-<build>` for every release carrying a copy; bare `ios-<label>` for the newest entry with that label. */
function imageRoutes(base: string, lines: readonly SourceLine[], releases: ReadonlyMap<string, Release>): LegacyRoute[] {
  const out: LegacyRoute[] = [];
  const bare = new Set<string>();
  for (const l of lines) {
    for (const e of l.entries) {
      for (const c of e.copies) {
        if (c.kind !== "image") continue;
        for (const id of c.releases) {
          const r = releases.get(id);
          if (r === undefined || r.platform !== "ios") continue;
          const slug = v1Image(r.label);
          out.push({ from: `${base}/${slug}-${r.id}`, to: pathOf(l, e) });
          if (!bare.has(slug)) out.push({ from: `${base}/${slug}`, to: pathOf(l, e) });
          bare.add(slug);
        }
      }
    }
  }
  return out;
}

/** v1's per-product suffix: the model, `iPad`, or `iPhone` for CarrierBundles.iPhone entries (OS keys `iPhone <n>`). */
function v1Suffix(listing: OtaListing, source: SourceRef): string | undefined {
  if (listing.model !== undefined) return listing.model;
  if (source.platform === "ipados") return "iPad";
  return listing.os?.startsWith("iPhone ") ? "iPhone" : undefined;
}

/** A file's v1 slug at its highest OS listing; a carrier listing with no OS is the 2009-10 `legacy` file. */
function v1File(file: OtaFile, sources: ReadonlyMap<string, SourceRef>): { readonly slug: string; readonly os: string } | undefined {
  const listed = file.listings.flatMap((l) => {
    const source = sources.get(l.source);
    return source ? [{ l, source }] : [];
  }).sort((a, b) => compareVersions(b.l.os ?? "", a.l.os ?? ""));
  const top = listed[0];
  if (top === undefined) return undefined;
  if (top.l.os === null && top.source.kind === "carrier") return { slug: "ota-legacy", os: "" };
  const suffix = v1Suffix(top.l, top.source);
  return { slug: `ota-${file.version}${suffix === undefined ? "" : `-${suffix}`}`, os: top.l.os ?? "" };
}

/** Files sharing a v1 slug were numbered in v1's order: OS key, then build, newest first. */
function otaRoutes(base: string, lines: readonly SourceLine[], files: readonly OtaFile[]): LegacyRoute[] {
  const where = new Map<string, string>();
  for (const l of lines) {
    for (const e of l.entries) {
      for (const c of e.copies) if (c.kind === "ota") where.set(c.url, pathOf(l, e));
    }
  }
  const sources = new Map<string, SourceRef>(lines.map((l) => [sourceKey(l.source), l.source]));
  const bySlug = new Map<string, Array<{ url: string; os: string; version: string }>>();
  for (const file of files) {
    const v1 = where.has(file.url) ? v1File(file, sources) : undefined;
    if (v1 !== undefined) bySlug.set(v1.slug, [...(bySlug.get(v1.slug) ?? []), { url: file.url, os: v1.os, version: file.version }]);
  }
  return [...bySlug].flatMap(([slug, list]) =>
    list
      .sort((a, b) => compareVersions(b.os, a.os) || compareVersions(b.version, a.version) || a.url.localeCompare(b.url))
      .flatMap((f, i): LegacyRoute[] => {
        const to = where.get(f.url);
        return to === undefined ? [] : [{ from: `${base}/${i === 0 ? slug : `${slug}-${i + 1}`}`, to }];
      }));
}

/** Every v1 page and version it listed; `timelines` is every v2 source's. */
export function legacyRoutes(releases: readonly Release[], files: readonly OtaFile[], timelines: ReadonlyMap<SourceKey, Timeline>): LegacyRoute[] {
  const byId = new Map(releases.map((r) => [r.id, r]));
  const sources = [...timelines.keys()].map(sourceOf);
  const names = (platforms: readonly SourceRef["platform"][], kind: SourceRef["kind"]): string[] =>
    [...new Set(sources.filter((s) => platforms.includes(s.platform) && s.kind === kind).map((s) => s.name))].sort();
  const timeline = (s: SourceRef): Timeline | undefined => timelines.get(sourceKey(s));
  const routes: LegacyRoute[] = [];
  const page = (base: string, home: SourceRef, members: readonly SourceRef[]): void => {
    const lines = members.flatMap((s) => appleLines(s, timeline(s)));
    routes.push({ from: base, to: sourcePath(home) }, ...imageRoutes(base, lines, byId), ...otaRoutes(base, lines, files));
  };
  for (const name of names(["ios", "ipados"], "carrier")) {
    const ios: SourceRef = { platform: "ios", kind: "carrier", name };
    const ipados: SourceRef = { platform: "ipados", kind: "carrier", name };
    // v1's page was the iPhone bundle's; a name only iPads had lands on its iPadOS source.
    page(`/carriers/${encodeURIComponent(name)}`, timeline(ios) === undefined ? ipados : ios, [ios, ipados]);
  }
  for (const name of names(["watchos"], "carrier")) {
    const watch: SourceRef = { platform: "watchos", kind: "carrier", name };
    page(`/watch/${encodeURIComponent(name)}`, watch, [watch]);
  }
  for (const name of names(["ios"], "country")) {
    const country: SourceRef = { platform: "ios", kind: "country", name };
    page(`/countries/${encodeURIComponent(name)}`, country, [country]);
  }
  return routes;
}
