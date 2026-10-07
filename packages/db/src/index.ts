/**
 * The index in D1: its tables, the writes of the index step and the feeds, and the typed reads pages and the API make,
 * some derived in SQL per request (countries, carrier modem configurations, rarity).
 */

export { indexDb, type IndexDb, type Page } from "./db.ts";
export {
	carrierCountries,
	carrierList,
	EVERY_CARRIER,
	carrierMembers,
	carrierModemConfigs,
	sourceModemConfigs,
	carrierOf,
	countryCarriers,
	countryList,
	countryOf,
	headIdentities,
	linkRules,
	writeLinked,
} from "./carriers.ts";
export type {
	CarrierFilter,
	CarrierModemConfig,
	HeadIdentity,
	ShownCarrier,
	ShownCountry,
} from "./carriers.ts";
export {
	deviceList,
	deviceOf,
	releasedDevices,
	setHas5g,
	statedDevices,
	statedSourceCounts,
	syncDevices,
	type ListedDevice,
	type ShownDevice,
} from "./devices.ts";
export { countFacts, lastFacts } from "./facts-written.ts";
export { syncLabels, unnamed, writeLabels } from "./labels.ts";
export {
	boardRadiosOf,
	configRadiosOf,
	missingProfiles,
	putProfiles,
	rareSettings,
	scanConcept,
	scanSetting,
	putBaseRows,
	selectedBy,
	syncHeadRows,
} from "./profiles.ts";
export { SCAN_HELD } from "./profiles.ts";
export type { Group, RareSetting, ScanHeld, ScannedSource } from "./profiles.ts";
export {
	changesOf,
	EVERY_RELEASE,
	heldRelease,
	modemConfigsOf,
	modemsOf,
	neighbours,
	newestReleaseDevices,
	putRelease,
	releaseIds,
	releaseList,
	releaseOf,
	shippedIn,
	shippedSourceCount,
	syncChanges,
} from "./releases.ts";
export type {
	IndexedRelease,
	ListedRelease,
	ModemConfigRow,
	ModemFamily,
	ModemRow,
	ReleaseFilter,
	ReleaseRows,
	ShownChange,
	ShownEnd,
} from "./releases.ts";
export {
	carrierSources,
	carrierStates,
	copiesOf,
	entriesOf,
	EVERY_SOURCE,
	featureStates,
	putOtaFile,
	putSource,
	platformRoutes,
	RULE_VIAS,
	routedBundles,
	rulesOnPlmn,
	SCANNED_STATES,
	sourceKeys,
	sourceList,
	sourceOf,
	statesOn,
	syncCopies,
	syncEntries,
	syncPhoneStates,
	syncRoutes,
} from "./sources.ts";
export type {
	FeatureFilter,
	FeatureRow,
	Holding,
	ListedSource,
	OrderedCopy,
	OtaFileRow,
	PhoneStatesRow,
	RoutedBundles,
	ScannedState,
	SimRuleRow,
	SourceFilter,
	SourceRow,
} from "./sources.ts";
