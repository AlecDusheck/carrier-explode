/**
 * v1 URLs -> v2 URLs, for the site's permanent redirects (index/legacy.json).
 *
 * v1 had one page per bundle name per kind (`/carriers/<Name>`, `/watch/<Name>`,
 * `/countries/<Name>`) with every copy in one version strip: iPhone images
 * (`ios-27.2`), OTA files (`ota-58.1`) and per-model OTA files
 * (`ota-58.1-iPad`, `ota-33.2-iPhone7,1`, `ota-1.1-iPhone` for the manifest's
 * CarrierBundles.iPhone family), disambiguated `-<image build>` or `-<n>`.
 * v2 splits those into sources per platform. To resolve every v1 slug, the v1
 * strip is rebuilt with v1's rules from the same releases and refs, and each
 * v1 entry is pointed at the v2 entry holding that copy.
 */

import { compareVersions } from "#lib/decode/index.ts";
import type { OtaRef } from "#lib/storage/keys.ts";
import { compareReleases, modelOf } from "./timeline.ts";
import { parseSourceKey, sourcePath, sourceKey, type LegacyRoute, type Release, type SourceRef, type TimelineEntry } from "./types.ts";

type V1Kind = "carriers" | "countries" | "watch";

/** One entry of a v1 strip, with what identifies its copy in v2. */
interface V1Entry {
  slug: string;
  build: string;
  /** Sinks in v1 order: a per-model or per-family OTA file. */
  readonly variant: boolean;
  readonly via: "image" | "ota";
  /** image: the newest release carrying it; ota: the file. */
  readonly release?: string;
  readonly ref?: OtaRef;
}

/** v1's per-model slug suffix: the product type, `iPad` for iPad entries, `iPhone` for CarrierBundles.iPhone ones (os `iPhone <n>`). */
function v1Suffix(ref: OtaRef, source: SourceRef): string | undefined {
  const model = modelOf(ref.productType);
  if (model !== undefined) return model;
  if (source.platform === "ipados") return "iPad";
  if (source.platform === "ios" && ref.os.startsWith("iPhone ")) return "iPhone";
  return undefined;
}

const imageSlugV1 = (version: string): string => `ios-${version.trim().replace(/\s+/g, "-")}`;

/** v1 buildTimeline (src/lib/server/timeline.ts on main): images, then refs, ordered and disambiguated as it did. */
function v1Strip(imageKey: string | undefined, images: readonly Release[], refs: ReadonlyArray<{ ref: OtaRef; source: SourceRef }>, kind: V1Kind): V1Entry[] {
  const out: V1Entry[] = [];
  if (imageKey !== undefined) {
    let lastId: string | undefined;
    for (const r of [...images].sort((a, b) => compareReleases(b, a))) {
      const src = r.sources[imageKey]?.[0];
      if (!src) continue;
      const id = src.cid ?? src.sha;
      if (id !== lastId) out.push({ slug: imageSlugV1(r.version), build: src.version, variant: false, via: "image", release: r.id });
      lastId = id;
    }
  }
  const byUrl = new Set<string>();
  for (const { ref, source } of refs) {
    if (byUrl.has(ref.url)) continue;
    byUrl.add(ref.url);
    const suffix = kind === "carriers" ? v1Suffix(ref, source) : undefined;
    const slug = ref.os === "legacy" ? "ota-legacy" : `ota-${ref.build}${suffix ? `-${suffix}` : ""}`;
    out.push({ slug, build: ref.build, variant: suffix !== undefined, via: "ota", ref });
  }
  out.sort((a, b) => Number(a.variant) - Number(b.variant) || compareVersions(b.build || "0", a.build || "0") || Number(b.via === "image") - Number(a.via === "image"));
  const seen = new Map<string, number>();
  for (const e of out) {
    const n = (seen.get(e.slug) ?? 0) + 1;
    seen.set(e.slug, n);
    if (n > 1) e.slug += e.release !== undefined ? `-${e.release}` : `-${n}`;
  }
  return out;
}

/** The v2 entry holding a v1 entry's copy. */
function target(e: V1Entry, timelines: ReadonlyMap<string, readonly TimelineEntry[]>, imageKey: string | undefined): { key: string; slug: string } | undefined {
  const key = e.via === "image" ? imageKey : e.ref?.source;
  if (key === undefined) return undefined;
  const found = timelines.get(key)?.find((t) => t.copies.some((c) =>
    e.via === "image" ? c.via === "image" && e.release !== undefined && c.releases.includes(e.release) : c.via === "ota" && c.url === e.ref?.url));
  return found ? { key, slug: found.slug } : undefined;
}

/**
 * Every v1 route: each name's base path, and each v1 version slug. `timelines`
 * holds every v2 source's timeline by sourceKey.
 */
export function legacyRoutes(releases: readonly Release[], refs: readonly OtaRef[], timelines: ReadonlyMap<string, readonly TimelineEntry[]>): LegacyRoute[] {
  const appleImages = releases.filter((r) => r.platform === "ios");
  const sources = [...timelines.keys()].flatMap((k) => { const s = parseSourceKey(k); return s ? [s] : []; });
  const routes: LegacyRoute[] = [];
  const refsOf = (keys: readonly string[]): Array<{ ref: OtaRef; source: SourceRef }> =>
    refs.flatMap((ref) => { const source = parseSourceKey(ref.source); return source && keys.includes(ref.source) ? [{ ref, source }] : []; });

  const strips: Array<{ kind: V1Kind; name: string; home: SourceRef; imageKey?: string; keys: string[] }> = [];
  const names = (pred: (s: SourceRef) => boolean): string[] => [...new Set(sources.filter(pred).map((s) => s.name))].sort();
  for (const name of names((s) => s.kind === "carrier" && (s.platform === "ios" || s.platform === "ipados"))) {
    const ios: SourceRef = { platform: "ios", kind: "carrier", name };
    const ipados: SourceRef = { platform: "ipados", kind: "carrier", name };
    // v1's page was the iPhone bundle's; a name only iPads ever had lands on the iPadOS source.
    const home = timelines.has(sourceKey(ios)) ? ios : ipados;
    strips.push({ kind: "carriers", name, home, imageKey: sourceKey(ios), keys: [sourceKey(ios), sourceKey(ipados)] });
  }
  for (const name of names((s) => s.kind === "carrier" && s.platform === "watchos")) {
    const home: SourceRef = { platform: "watchos", kind: "carrier", name };
    strips.push({ kind: "watch", name, home, keys: [sourceKey(home)] });
  }
  for (const name of names((s) => s.kind === "country" && s.platform === "ios")) {
    const home: SourceRef = { platform: "ios", kind: "country", name };
    strips.push({ kind: "countries", name, home, imageKey: sourceKey(home), keys: [sourceKey(home)] });
  }

  for (const s of strips) {
    const base = `/${s.kind}/${encodeURIComponent(s.name)}`;
    routes.push({ from: base, to: sourcePath(s.home) });
    for (const e of v1Strip(s.imageKey, appleImages, refsOf(s.keys), s.kind)) {
      const t = target(e, timelines, s.imageKey);
      const ref = t === undefined ? undefined : parseSourceKey(t.key);
      if (t && ref) routes.push({ from: `${base}/${e.slug}`, to: `${sourcePath(ref)}/${t.slug}` });
    }
  }
  return routes;
}
