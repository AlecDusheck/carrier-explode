/**
 * What each remote query costs and who may share its answer; read by
 * hooks.server.ts. Every query has a row, and a row for a query that no longer
 * exists fails the type check.
 */

import type * as bundles from "./bundles.remote";
import type * as tables from "./tables.remote";

/** Per-IP budgets, by the work a request can start (see hooks.server.ts). */
export type RateClass = "scan" | "diff" | "bundle" | "base";

export interface QueryPolicy {
  rate: RateClass;
  /** Same bytes for everybody and asked for on most navigations, so the edge may keep it. */
  shared?: true;
}

export type QueryName = keyof typeof bundles | keyof typeof tables;

export const QUERIES: Record<QueryName, QueryPolicy> = {
  getIndex: { rate: "base", shared: true },
  getStats: { rate: "base", shared: true },
  getManifestFacts: { rate: "base", shared: true },
  guessCarrier: { rate: "base" },
  guessCountry: { rate: "base" },
  getRelease: { rate: "base" },
  // A bundle's current version, for the wiki's links: one cached timeline read.
  getHead: { rate: "base", shared: true },
  // Anything that can pull and unzip an .ipcc.
  getBundle: { rate: "bundle" },
  getFile: { rate: "bundle" },
  getBasebandDefaults: { rate: "bundle" },
  getBundleOverrides: { rate: "bundle" },
  getBasebandOverride: { rate: "bundle" },
  getOverridePlist: { rate: "bundle" },
  // One cached read of the index run's rarity file.
  getRare: { rate: "base" },
  // Two bundles or packages and a full diff per miss.
  getComparison: { rate: "diff" },
  getBasebandDiff: { rate: "diff" },
  // Every phone group's files against the copies that phone had before: several opens and diffs per miss.
  getPhoneChanges: { rate: "diff" },
  scanKey: { rate: "scan" },
  // A scan cut to a few numbers, the same for everybody: wiki pages show several at once.
  getSettingSummary: { rate: "base", shared: true },
  getCbs: { rate: "base" },
  getPlmn: { rate: "base" },
  getBasebandBuilds: { rate: "base" },
  getModems: { rate: "base" },
  getModemPackageHeader: { rate: "base" },
  getBaseband: { rate: "base" },
  getBasebandFile: { rate: "base" },
  getBasebandCombos: { rate: "base" },
};

export const isQueryName = (name: string): name is QueryName => Object.hasOwn(QUERIES, name);
