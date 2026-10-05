/** Apple's OTA manifest, for which bundle a SIM loads: read from the extractor's snapshot, never live, and keyed by its sha1. */

import { error } from "@sveltejs/kit";
import { buildIndex, buildMccMnc, parseManifest, type MccMncTable } from "@carrier-explode/decode-ios";
import { manifestSims } from "@carrier-explode/schema";
import { sourceOf, type SimMatcher, type SourceKey } from "@carrier-explode/schema/types";
import { keys, manifestPointerSchema } from "@carrier-explode/storage";
import { simRule, type SelectionRule } from "#lib/settings.ts";
import { cached, perRequest } from "../cache";
import { readBytes, readJson } from "../store";

const snapshot = perRequest(async (): Promise<string> => {
  const current = await readJson(keys.otaManifestCurrent(), manifestPointerSchema);
  if (!current) error(503, "No manifest snapshot yet: the OTA feed has not run.");
  return current.sha1;
});

async function manifest(sha1: string): Promise<ReturnType<typeof parseManifest>> {
  const bytes = await readBytes(keys.otaManifest(sha1));
  if (!bytes) error(500, `${keys.otaManifest(sha1)} is named current but missing`);
  return parseManifest(bytes);
}

/** The SIM tables: MCC-MNC (with MVNO rules), ICCID prefix and carrier ID to bundle name. */
export const plmnTable = perRequest(async (): Promise<MccMncTable> => {
  const sha1 = await snapshot();
  return cached(`plmn:v2:${sha1}`, async () => buildMccMnc(await manifest(sha1)));
});

/** How many entries each of the manifest's tables has, for the wiki. */
export const manifestCounts = perRequest(async (): Promise<Record<string, number>> => {
  const sha1 = await snapshot();
  return cached(`manifestcounts:v2:${sha1}`, async () => buildIndex(await manifest(sha1)).counts);
});

/** The SIM routes of the manifest, per Apple carrier source. */
const routes = perRequest(async (): Promise<Readonly<Partial<Record<SourceKey, readonly SimMatcher[]>>>> => {
  const sha1 = await snapshot();
  return cached(`manifestsims:v1:${sha1}`, async () => manifestSims(await manifest(sha1)));
});

/** The SIMs the manifest sends to a source: its MCC-MNC routes, then the ICCID prefixes and CDMA carrier IDs naming its bundle. */
export async function selectedBy(key: SourceKey): Promise<SelectionRule[]> {
  const [sims, t] = await Promise.all([routes(), plmnTable()]);
  const name = sourceOf(key).name;
  return [
    ...(sims[key] ?? []).map(simRule),
    ...t.iccids.flatMap(([prefix, bundle]): SelectionRule[] => (bundle === name ? [{ via: "ICCID", key: prefix + "…", match: null }] : [])),
    ...t.carrierIds.flatMap(([id, bundle]): SelectionRule[] => (bundle === name ? [{ via: "Carrier ID", key: id, match: "CDMA carrier ID" }] : [])),
  ];
}
