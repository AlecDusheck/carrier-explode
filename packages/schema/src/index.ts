/** The schema's public API. */

export * from "./types.ts";
export {
	CONCEPT_GROUPS,
	CONCEPT_UNITS,
	CONCEPTS,
	FEATURE_SLUGS,
	GROUP_NAMES,
	conceptById,
	needs5G,
	type ConceptDef,
	type FeatureSlug,
} from "./concepts.ts";
export { ruleSpecificity, selectsSim, type SimFacts } from "./sims.ts";
export { iosProfile, phoneVariantId } from "./ios/profile.ts";
export { iosModemConfig } from "./ios/modem.ts";
export { firmwareFamily, modemFamilyName } from "./modem-names.ts";
export { manifestRoutes } from "./ios/identity.ts";
export { boardRadios, phoneRadio, type BoardRadios } from "./ios/radio.ts";
export { featureWhere } from "./features.ts";
export { androidProfile } from "./android/profile.ts";
export { pixelApns, pixelConfigBody } from "./android/aosp.ts";
export { AOSP_DOCUMENTS, apnElements, carrierConfigElements, profileApns, type AospApn } from "./aosp.ts";
export { carrierListRoutes } from "./android/identity.ts";
export { samsungProfile } from "./samsung/profile.ts";
export { IMS_OPERATOR } from "./samsung/ims.ts";
export {
	CONFIG_RADIOS,
	configRadio,
	modemConfig,
	type ConfigRadio,
	type NormalizedModem,
} from "./modem/index.ts";
export { expresses } from "./expresses.ts";
export {
	compareProfiles,
	profileFor,
	type ApnRow,
	type ConceptRow,
	type ProfileComparison,
} from "./compare.ts";
export {
	headRows,
	mainFile,
	modemFacts,
	profileFacts,
	RARITY,
	rarityFile,
	type HeadRows,
	type ProfileFacts,
	type RarityFile,
	type RarityThresholds,
} from "./profile-facts.ts";
export {
	canonicalLine,
	compareReleases,
	head,
	lastChanged,
	lineOf,
	linesOf,
	releaseSortKey,
	sourceTimeline,
	versionOn,
	type ReleaseOrder,
	type ReleaseVersion,
	type SourceCopy,
	type TimelineEntry,
	type VersionLookup,
} from "./timeline.ts";
export { releaseChanges, type ReleaseChange, type ShippedCopy } from "./release-changes.ts";
export {
	baseSource,
	perPhone,
	phoneHeads,
	sourceBase,
	phoneStates,
	type Phone,
	type PhoneHead,
	type PhoneProfile,
	type PhoneStates,
	type SourceHistory,
} from "./phone-states.ts";
export { has5g, layeredRadio } from "./radio.ts";
export {
	membersByPrimacy,
	identifies,
	identityChanged,
	isTestPlmn,
	isUnnamedRule,
	LINK_RULES,
	linkCarriers,
	type Carrier,
	type Linked,
	type LinkRule,
	type SourceIdentity,
} from "./identity.ts";
export { newestFirst, newestOf, type DeviceOrder } from "./devices.ts";
export { boardProducts, boardRefs, productOf, type BoardProducts, type BoardRef } from "./ios/boards.ts";
export { countryName, isoForMcc } from "./countries.ts";
export * from "./records.ts";
