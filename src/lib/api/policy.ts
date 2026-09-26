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
  guessCarrier: { rate: "base" },
  guessCountry: { rate: "base" },
  getRelease: { rate: "base" },
  // Anything that can pull and unzip an .ipcc.
  getBundle: { rate: "bundle" },
  getFile: { rate: "bundle" },
  getBasebandDefaults: { rate: "bundle" },
  getPhoneOverrides: { rate: "bundle" },
  getBasebandOverride: { rate: "bundle" },
  // Two bundles or packages and a full diff per miss.
  getComparison: { rate: "diff" },
  getBasebandDiff: { rate: "diff" },
  scanKey: { rate: "scan" },
  getCbs: { rate: "base" },
  getPlmn: { rate: "base" },
  getBasebandBuilds: { rate: "base" },
  getModems: { rate: "base" },
  getModemPackageHeader: { rate: "base" },
  getBaseband: { rate: "base" },
  getBasebandFile: { rate: "base" },
  getBasebandCombos: { rate: "base" },
  getBundleModems: { rate: "base" },
};

export const isQueryName = (name: string): name is QueryName => Object.hasOwn(QUERIES, name);
