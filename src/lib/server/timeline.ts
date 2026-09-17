/**
 * One history per bundle across both sources, ordered by the bundle's own build
 * number, which is how the phone decides which copy wins.
 */

import { compareVersions, type BundleRef, type CountrySummary } from "./manifest";

export interface ImageBuild { build: string; version: string; device: string; product?: string; extractedAt: string; scheme?: number }
/** `id` is the content hash the blob is stored under; only comparable within one `scheme`. */
export interface ImageBundle { id: string; size: number; build: string }
export interface ImageIndex extends ImageBuild {
  carriers: Record<string, ImageBundle>;
  countries: Record<string, ImageBundle>;
}

export interface TimelineEntry {
  /** URL segment: ios-27.0, ota-58.1, ota-58.1-iPad, ota-legacy. */
  slug: string;
  source: "image" | "ota";
  /** iOS versions: the images that carry this exact bundle, or the OTA minimum-OS keys. */
  ios: string[];
  build: string;
  productType?: string;
  /** False when the content is identical to the entry below it. */
  changed: boolean;
  /** Where the bytes live: blob:<content id> or an Apple URL. Never sent to the browser as a link target for blobs. */
  src: string;
  /** Image entries: content id, its scheme, and the newest image build carrying it. */
  id?: string;
  scheme?: number;
  image?: string;
  /** OTA entries: the digests Apple publishes for the file. */
  sha1?: string;
  sha384?: string;
}

/** `images` must be newest first. */
export function buildTimeline(
  kind: "carriers" | "countries" | "watch",
  name: string,
  images: ImageIndex[],
  refs: BundleRef[],
  countries: CountrySummary[],
): TimelineEntry[] {
  const out: TimelineEntry[] = [];

  // Images, newest first; consecutive images carrying the same bytes collapse into one entry.
  if (kind !== "watch") {
    for (const img of images) {
      const b = img[kind][name];
      if (!b) continue;
      const last = out[out.length - 1];
      // Ids are only comparable within one hashing scheme.
      if (last?.id === b.id && last.scheme === (img.scheme ?? 1)) last.ios.push(img.version);
      else {
        out.push({
          slug: `ios-${img.version}`, source: "image", ios: [img.version], build: b.build,
          changed: true, src: `blob:${b.id}`, id: b.id, scheme: img.scheme ?? 1, image: img.build,
        });
      }
    }
  }

  const ota = new Map<string, TimelineEntry>();
  const add = (r: BundleRef, slug: string) => {
    const e = ota.get(r.url);
    if (e) { if (r.os && !e.ios.includes(r.os)) e.ios.push(r.os); return; }
    ota.set(r.url, {
      slug, source: "ota", ios: r.os && r.os !== "legacy" ? [r.os] : [], build: r.build,
      productType: r.productType, changed: true, src: r.url, sha1: r.digest, sha384: r.digest3,
    });
  };
  if (kind === "countries") {
    for (const c of countries) {
      if (c.id === name && c.family === "iPhone") {
        add({ os: c.minOS ?? "", build: c.version, url: c.url }, `ota-${c.version}`);
      }
    }
  } else {
    for (const r of refs) {
      const isWatch = r.productType === "Watch";
      if ((kind === "watch") !== isWatch) continue;
      const pt = r.productType && r.productType !== "Watch" ? `-${r.productType}` : "";
      add(r, r.os === "legacy" ? "ota-legacy" : `ota-${r.build}${pt}`);
    }
  }
  out.push(...ota.values());

  // Bundle build decides precedence on the phone; the image wins a tie. Per-model variants sink.
  out.sort((a, b) =>
    Number(!!a.productType) - Number(!!b.productType) ||
    compareVersions(b.build || "0", a.build || "0") ||
    Number(b.source === "image") - Number(a.source === "image"));
  for (const e of out) e.ios.sort(compareVersions);

  // Image blobs are re-zipped, so bytes cannot be compared across sources; the bundle's
  // own build number can. An entry is unchanged when the one below it is the same build.
  out.forEach((e, i) => {
    const below = out.slice(i + 1).find((x) => x.productType === e.productType);
    const sameScheme = e.id && below?.id && e.scheme === below.scheme;
    e.changed = !below || (sameScheme ? e.id !== below.id : e.build !== below.build);
  });

  // Two images of one iOS version, or two OTA files with one build number, must not share a URL.
  const seen = new Map<string, number>();
  for (const e of out) {
    const n = (seen.get(e.slug) ?? 0) + 1;
    seen.set(e.slug, n);
    // Images arrive newest first, so the current build of a version keeps the clean slug.
    if (n > 1) e.slug += e.image ? `-${e.image}` : `-${n}`;
  }
  return out;
}
