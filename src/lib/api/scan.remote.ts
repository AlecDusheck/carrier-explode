/** "What does everyone else put here?": the scan index, read three ways. */

import * as v from "valibot";
import { query } from "$app/server";
import type { ScanResult, SettingSummary } from "#lib/server/keyscan.ts";
import * as scan from "#lib/server/scan.ts";
import { at, path, platform } from "./schemas";

const oneCountry = v.custom<`country:${string}`>((s) => typeof s === "string" && /^country:[a-z]{2}$/.test(s), "not a country scope");
const scope = v.union([v.picklist(["carriers", "countries"]), oneCountry]);
const args = v.object({ platform, path, file: path, scope });

export const scanKey = query(args, (a): Promise<ScanResult> => scan.scanKey(a.platform, a.path, a.file, a.scope));
/** A scan cut to a few numbers: the wiki shows several at once. */
export const getSettingSummary = query(args, (a): Promise<SettingSummary> => scan.settingSummary(a.platform, a.path, a.file, a.scope));
/** Settings few other sources share. */
export const getRare = query(v.object(at), (a): Promise<scan.Rare> => scan.getRare(a.source, a.slug));
