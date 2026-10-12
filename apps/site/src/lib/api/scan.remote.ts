/** The index's scans: one setting across a scope of sources. */

import * as v from "valibot";
import { query } from "$app/server";
import * as scan from "#lib/server/scan.ts";
import { path, platform, scanScope } from "./schemas";

const scanArgs = v.object({
	platform,
	path,
	file: path,
	scope: scanScope,
});

/** One setting across every source in scope. */
export const scanKey = query(scanArgs, (a) => scan.scanKey(a.platform, a.path, a.file, a.scope));
/** A scan cut to a few numbers, the same for everybody: wiki pages show several at once. */
export const getSettingSummary = query(scanArgs, (a) =>
	scan.settingSummary(a.platform, a.path, a.file, a.scope),
);
