/** The feature pages: one per state concept, named and described by the schema. */

import { FEATURE_SLUGS, RELEASE_PLATFORMS, conceptById, decoderFamily, expresses, featureWhere, type FeatureSlug, type ReleasePlatform } from "@carrier-explode/schema";

export interface FeaturePage {
  readonly slug: FeatureSlug;
  readonly name: string;
  /** One sentence a non-expert understands. */
  readonly what: string;
  /** Where a phone's switch for it is, by the phone's platform. */
  readonly where: Readonly<Partial<Record<ReleasePlatform, string>>>;
  /** The phones' platforms whose settings can express it. */
  readonly platforms: readonly ReleasePlatform[];
}

export const FEATURE_PAGES: readonly FeaturePage[] = FEATURE_SLUGS.map((slug) => {
  const c = conceptById(slug);
  return {
    slug, name: c?.name ?? slug, what: c?.description ?? "",
    where: Object.fromEntries(RELEASE_PLATFORMS.flatMap((p) => {
      const where = featureWhere(p, slug);
      return where === undefined ? [] : [[p, where]];
    })),
    platforms: RELEASE_PLATFORMS.filter((p) => expresses(decoderFamily(p), slug)),
  };
});

export const featurePage = (slug: string): FeaturePage | undefined => FEATURE_PAGES.find((f) => f.slug === slug);
