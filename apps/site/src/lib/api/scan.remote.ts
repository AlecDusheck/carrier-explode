/** The index's scans: one setting across a scope of sources. */

import * as v from "valibot";
import { query } from "$app/server";
import { ISO_CODE } from "@carrier-explode/schema/types";
import * as scan from "#lib/server/scan.ts";
import { path, platform } from "./schemas";

const oneCountry = v.custom<`country:${string}`>(
	(s) => typeof s === "string" && s.startsWith("country:") && ISO_CODE.test(s.slice("country:".length)),
	"not a country scope",
);
const scanArgs = v.object({
	platform,
	path,
	file: path,
	scope: v.union([v.picklist(["carriers", "countries"]), oneCountry]),
});

/** One setting across every source in scope. */
export const scanKey = query(scanArgs, (a) => scan.scanKey(a.platform, a.path, a.file, a.scope));
/** A scan cut to a few numbers, the same for everybody: wiki pages show several at once. */
export const getSettingSummary = query(scanArgs, (a) =>
	scan.settingSummary(a.platform, a.path, a.file, a.scope),
);
