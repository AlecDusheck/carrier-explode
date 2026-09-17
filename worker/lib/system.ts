/**
 * Bundles pulled out of an iOS image (see .github/workflows/system-bundles.yml)
 * are the primary source: they are what a phone actually boots with, and they
 * cover every country. Apple's asset server only fills in around them: bundles
 * updated since that OS build, older versions, and the odd carrier that is not
 * in the image at all.
 */

import { compareVersions, splitName, type BundleRef, type CarrierSummary } from "./manifest.ts";

export interface ImageBundle { name: string; size: number; sha1: string; build: string }

export interface ImageIndex {
  version: string;
  build: string;
  device: string;
  product: string;
  extractedAt: string;
  carriers: ImageBundle[];
  countries: ImageBundle[];
}

export const imageKey = (idx: ImageIndex, kind: "carriers" | "countries", name: string) =>
  `r2:system/${idx.build}/${kind}/${name}.ipcc`;

export function imageRef(idx: ImageIndex, kind: "carriers" | "countries", b: ImageBundle): BundleRef {
  return { os: idx.version, build: b.build, url: imageKey(idx, kind, b.name), digest: b.sha1, source: "image" };
}

/** Image ref first unless the asset server has a strictly newer build. */
export function mergeRefs(image: BundleRef | null, cdn: BundleRef[]): BundleRef[] {
  if (!image) return cdn;
  const newer = cdn.filter((r) => r.os !== "legacy" && !r.productType && compareVersions(r.build, image.build) > 0);
  const rest = cdn.filter((r) => !newer.includes(r));
  return [...newer, image, ...rest];
}

/** Union of image and asset-server carriers, keyed by bundle name. */
export function mergeCarriers(idx: ImageIndex | null, cdn: CarrierSummary[]): CarrierSummary[] {
  if (!idx) return cdn;
  const out = new Map(cdn.map((c) => [c.name, { ...c }]));
  for (const b of idx.carriers) {
    const have = out.get(b.name);
    if (have) have.image = b.build;
    else {
      out.set(b.name, {
        name: b.name, ...splitName(b.name), versions: [], productTypes: [], hasLegacy: false, image: b.build,
      });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
