/** What each remote query costs. Every query has a row; a row for a query that is gone fails the type check. */

import type * as android from "./android.remote";
import type * as apple from "./apple.remote";
import type * as builds from "./builds.remote";
import type * as dataset from "./dataset.remote";
import type * as samsung from "./samsung.remote";
import type * as scan from "./scan.remote";
import type * as sources from "./sources.remote";

/** Per-IP budgets, by the work a request can start (see server/rate.ts). */
export type RateClass = "scan" | "diff" | "bundle" | "base";

export interface QueryPolicy {
	readonly rate: RateClass;
}

export type QueryName =
	| keyof typeof android
	| keyof typeof apple
	| keyof typeof builds
	| keyof typeof dataset
	| keyof typeof samsung
	| keyof typeof scan
	| keyof typeof sources;

export const QUERIES = {
	getList: { rate: "base" },
	getListEntry: { rate: "base" },
	getCarrierMembers: { rate: "base" },
	getCountryCarriers: { rate: "base" },
	getRuleSources: { rate: "base" },
	getPixelOfModel: { rate: "base" },
	getListPlatforms: { rate: "base" },
	getSourceBrands: { rate: "base" },
	getManifestCounts: { rate: "base" },
	guessCarrier: { rate: "base" },
	guessCountry: { rate: "base" },
	getVisitorCountry: { rate: "base" },
	guessCarrierPages: { rate: "base" },
	getRelease: { rate: "base" },
	getBuilds: { rate: "base" },
	getShipped: { rate: "base" },
	getCarriersShipped: { rate: "base" },
	getPhoneNames: { rate: "base" },
	// The source's rows: its timeline, copies and carrier.
	getSourceHead: { rate: "base" },
	// The carrier's modem configuration rows and their normalised records.
	getAndroidModems: { rate: "base" },
	// Anything that can pull and unzip an .ipcc or decode a CarrierSettings.
	getAppleBundle: { rate: "bundle" },
	getAppleFile: { rate: "bundle" },
	getAppleModemConfig: { rate: "bundle" },
	getAlerts: { rate: "bundle" },
	getBasebandDefaults: { rate: "bundle" },
	getBundleOverrides: { rate: "bundle" },
	getBasebandOverride: { rate: "bundle" },
	getOverridePlist: { rate: "bundle" },
	getAndroid: { rate: "bundle" },
	getAndroidSettings: { rate: "bundle" },
	getAndroidApns: { rate: "bundle" },
	getAndroidFiles: { rate: "bundle" },
	getAndroidFile: { rate: "bundle" },
	getSamsung: { rate: "bundle" },
	getSamsungSettings: { rate: "bundle" },
	getSamsungApns: { rate: "bundle" },
	getSamsungFile: { rate: "bundle" },
	// The SIM rules the index read for the version.
	getAndroidSelectedBy: { rate: "base" },
	// One rarity query over the group's heads.
	getRare: { rate: "base" },
	// A few rows of devices and phone states, the same for everybody.
	getFeaturePhones: { rate: "base" },
	getFeaturePhone: { rate: "base" },
	getFeatureTable: { rate: "base" },
	getFeatureSummary: { rate: "base" },
	// Two versions and a full diff per miss.
	getComparison: { rate: "diff" },
	getAndroidChanges: { rate: "diff" },
	getSamsungChanges: { rate: "diff" },
	getBasebandDiff: { rate: "diff" },
	getPhoneChanges: { rate: "diff" },
	scanKey: { rate: "scan" },
	// A scan cut to a few numbers, the same for everybody: wiki pages show several at once.
	getSettingSummary: { rate: "scan" },
	getSelectedBy: { rate: "base" },
	getModemPackages: { rate: "base" },
	getBuildModems: { rate: "base" },
	getModemConfigBySha: { rate: "bundle" },
	// Every config head of one firmware on a miss, then the colo cache.
	getModemFirmware: { rate: "bundle" },
	getModemCombos: { rate: "base" },
	getModemPackageHeader: { rate: "base" },
	getBaseband: { rate: "base" },
	getBasebandFile: { rate: "base" },
	getBasebandCombos: { rate: "base" },
	// One R2 head.
	getDataset: { rate: "base" },
} as const satisfies Record<QueryName, QueryPolicy>;

export const isQueryName = (name: string): name is QueryName => Object.hasOwn(QUERIES, name);
