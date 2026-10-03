/**
 * What each remote query costs and who may share its answer; read by
 * hooks.server.ts. Every query has a row, and a row for a query that no longer
 * exists fails the type check.
 */

import type * as android from "./android.remote";
import type * as bundles from "./bundles.remote";
import type * as tables from "./tables.remote";

/** Per-IP budgets, by the work a request can start (see hooks.server.ts). */
export type RateClass = "scan" | "diff" | "bundle" | "base";

export interface QueryPolicy {
  readonly rate: RateClass;
  /** Same bytes for everybody and asked for on most navigations, so the edge may keep it. */
  readonly shared?: true;
}

export type QueryName = keyof typeof android | keyof typeof bundles | keyof typeof tables;

export const QUERIES = {
  getIndex: { rate: "base", shared: true },
  getManifestCounts: { rate: "base", shared: true },
  guessCarrier: { rate: "base" },
  guessCountry: { rate: "base" },
  getVisitorCountry: { rate: "base" },
  guessCarrierPages: { rate: "base" },
  getRelease: { rate: "base" },
  getAndroidBuilds: { rate: "base", shared: true },
  // One read of the source's carrier document.
  getBundleHead: { rate: "base", shared: true },
  // Anything that can pull and unzip an .ipcc or decode a CarrierSettings.
  getBundle: { rate: "bundle" },
  getFile: { rate: "bundle" },
  getAlerts: { rate: "bundle" },
  getBasebandDefaults: { rate: "bundle" },
  getBundleOverrides: { rate: "bundle" },
  getBasebandOverride: { rate: "bundle" },
  getOverridePlist: { rate: "bundle" },
  getAndroid: { rate: "bundle" },
  getAndroidSettings: { rate: "bundle" },
  getAndroidApns: { rate: "bundle" },
  getAndroidFiles: { rate: "bundle" },
  // Two Profiles and a concept comparison.
  getPair: { rate: "base" },
  // One cached read of the scan run's rarity file.
  getRare: { rate: "base" },
  // Built from every carrier document once per index, the same for everybody.
  getFeaturePhones: { rate: "base", shared: true },
  getFeatureTable: { rate: "base", shared: true },
  getFeatureSummary: { rate: "base", shared: true },
  // Two versions and a full diff per miss.
  getComparison: { rate: "diff" },
  getAndroidChanges: { rate: "diff" },
  getBasebandDiff: { rate: "diff" },
  getPhoneChanges: { rate: "diff" },
  scanKey: { rate: "scan" },
  // A scan cut to a few numbers, the same for everybody: wiki pages show several at once.
  getSettingSummary: { rate: "base", shared: true },
  getPlmn: { rate: "base" },
  getBasebandBuilds: { rate: "base" },
  getModems: { rate: "base" },
  getModemPackageHeader: { rate: "base" },
  getBaseband: { rate: "base" },
  getBasebandFile: { rate: "base" },
  getBasebandCombos: { rate: "base" },
} as const satisfies Record<QueryName, QueryPolicy>;

export const isQueryName = (name: string): name is QueryName => Object.hasOwn(QUERIES, name);
