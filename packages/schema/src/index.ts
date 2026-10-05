/** The schema's public API. */

export * from "./types.ts";
export { FEATURE_SLUGS, GROUP_NAMES, conceptById, needs5G, type FeatureSlug } from "./concepts.ts";
export { iosProfile, phoneVariantId } from "./ios/profile.ts";
export { iosModemConfig } from "./ios/modem.ts";
export { manifestSims } from "./ios/identity.ts";
export { featureWhere } from "./features.ts";
export { androidProfile } from "./android/profile.ts";
export { listSims } from "./android/identity.ts";
export { modemConfig, type NormalizedModem } from "./modem/index.ts";
export { expresses } from "./expresses.ts";
export { compareProfiles, profileFor, type ApnRow, type ConceptRow, type ProfileComparison } from "./compare.ts";
export { buildIndexes, indexProfile, indexShas, type IndexOutput, type IndexProfile } from "./index-build.ts";
export { currentRelease } from "./phone-states.ts";
export { deviceModems, indexModemConfig, linkedConfigShas, type IndexModemConfig } from "./modem-links.ts";
export { canonicalLine, head, lineOf, linesOf, versionOn, type Located, type VersionLookup } from "./timeline.ts";
export { newestFirst, newestOf, type DeviceOrder } from "./devices.ts";
export { boardProducts, boardRefs, productOf, type BoardProducts, type BoardRef } from "./ios/boards.ts";
export { countryName, isoForMcc } from "./countries.ts";
export * from "./records.ts";
