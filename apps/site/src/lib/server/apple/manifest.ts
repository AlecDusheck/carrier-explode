/** Apple's OTA manifest: the SIM routes the index read from it, and the wiki's counts of its tables from the extractor's snapshot. */

import { error } from "@sveltejs/kit";
import { buildIndex, parseManifest } from "@carrier-explode/decode-ios";
import type { SourceKey } from "@carrier-explode/schema/types";
import { keys, otaPointerSchema } from "@carrier-explode/storage";
import { keyRules, type SelectionRule } from "#lib/settings.ts";
import { cached } from "../cache";
import { locate } from "../catalog";
import { rulesAt } from "../profiles";
import { readBytes, readJson } from "../store";

/** How many entries each of the manifest's tables has, for the wiki. */
export async function manifestCounts(): Promise<Record<string, number>> {
	const current = await readJson(keys.otaCurrent("apple"), otaPointerSchema);
	if (!current) error(503, "No manifest snapshot yet: the OTA feed has not run.");
	const key = keys.appleOtaManifest(current.sha1);
	return cached(`manifestcounts:v3:${current.sha1}`, async () => {
		const bytes = await readBytes(key);
		if (!bytes) error(500, `${key} is named current but missing`);
		return buildIndex(parseManifest(bytes)).counts;
	});
}

/** The SIMs the manifest sends to a source. */
export async function selectedBy(key: SourceKey): Promise<SelectionRule[]> {
	const { source } = await locate(key);
	return keyRules((await rulesAt({ sha: source.headSha }, key)).routed);
}
