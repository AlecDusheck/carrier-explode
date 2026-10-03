/**
 * The schema's public API: the platform-neutral model and everything that
 * works on it, plus the two platform mappers. Nothing else is exported.
 */

export * from "./types.ts";
export {
  CONCEPTS, CONCEPT_GROUPS, GROUP_NAMES, conceptById, conceptOrder,
  type ConceptDef, type ConceptGroup, type ConceptId, type ConceptUnit, type ConceptValueSpec,
} from "./concepts.ts";
export { iosProfile, manifestSims, parseSupportedSim, IOS_READERS } from "./ios/index.ts";
export { androidProfile, listSims, ANDROID_READERS, AOSP_DEFAULTS } from "./android/index.ts";
export { compareProfiles, type ApnRow, type ConceptGroupRows, type ConceptRow, type ProfileComparison, type RawRow } from "./compare.ts";
export { buildIndexes, type IndexInput, type IndexOutput } from "./index-build.ts";
export { linkSources, type LinkMember, type LinkedGroup } from "./identity.ts";
export { LINKS, type Links } from "./links.ts";
export { VERSION_SLUG, isVersionSlug } from "./slug.ts";
export { compareReleases, deviceGroups, entryForDevice, headIndex, imageSlug, sourceTimeline, type DeviceGroup, type SourceTimeline } from "./timeline.ts";
export { byPixelRank, defaultDevice, pixelName } from "./devices.ts";
export { normaliseGid } from "./sims.ts";
