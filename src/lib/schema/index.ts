/** The schema's public API. */

export * from "./types.ts";
export {
  CONCEPTS, CONCEPT_GROUPS, GROUP_NAMES, conceptById, conceptOrder,
  type ConceptDef, type ConceptGroup, type ConceptId, type ConceptUnit, type ConceptValueSpec, type Reading, type Readers,
} from "./concepts.ts";
export { iosProfile, manifestSims, parseSupportedSim, IOS_READERS, type IosView } from "./ios/index.ts";
export { androidProfile, listSims, ANDROID_READERS, AOSP_DEFAULTS, type AndroidView } from "./android/index.ts";
export { compareProfiles, type ApnRow, type ConceptGroupRows, type ConceptRow, type ProfileComparison, type RawRow } from "./compare.ts";
export { buildIndexes, type IndexInput, type IndexOutput } from "./index-build.ts";
export { linkSources, type LinkMember, type LinkedGroup } from "./identity.ts";
export { LINKS, type LinkRule, type Links } from "./links.ts";
export { VERSION_SLUG, compareReleases, deviceGroups, head, isVersionSlug, releaseLabel, sourceTimeline, type DeviceGroup, type Located } from "./timeline.ts";
export { byPixelRank, defaultDevice, pixelName } from "./devices.ts";
export { normaliseGid } from "./sims.ts";
export { readingKey } from "./values.ts";
