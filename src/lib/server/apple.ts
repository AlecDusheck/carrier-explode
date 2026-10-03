/**
 * Apple's live OTA manifest, for what only it can answer now: which bundle a
 * SIM loads (the PLMN, ICCID and carrier ID tables) and how big its tables are.
 * Versions and history come from the index, which the extractor builds from
 * snapshots of this same manifest.
 *
 * Read at most once per ten-minute window. Apple's own CDN can hand out a copy
 * hours old, so the window goes in the URL to reach a fresh one. Its contents'
 * hash keys everything parsed from it, so the 6 MB plist is parsed again only
 * when Apple changes it.
 */

import { error } from "@sveltejs/kit";
import { MANIFEST_URL, buildMccMnc, buildIndex, parseManifest, type MccMncTable } from "#lib/decode/index.ts";
import { sha1Hex } from "#lib/binary/index.ts";
import { cached, perRequest } from "./cache";

const MANIFEST_TTL = 600;
/** Parsed tables are keyed by the manifest's hash; the TTL only bounds the cache. */
const KEEP = 30 * 86400;

const manifestWindow = (): number => Math.floor(Date.now() / (MANIFEST_TTL * 1000));

const manifestBytes = perRequest(async (): Promise<Uint8Array> => {
  const res = await fetch(`${MANIFEST_URL}?w=${manifestWindow()}`, { cf: { cacheTtl: MANIFEST_TTL, cacheEverything: true } });
  if (!res.ok) error(502, `Apple's manifest fetch failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
});

/** Which manifest is current: a hash of its contents, worked out once per window. */
const manifestVersion = perRequest(() =>
  cached(`manifesthash:${manifestWindow()}`, MANIFEST_TTL, async () => sha1Hex(await manifestBytes())));

/** The SIM tables: MCC-MNC (with MVNO rules), ICCID prefix and carrier ID to bundle name. */
export const plmnTable = perRequest(async (): Promise<MccMncTable> => {
  const version = await manifestVersion();
  return cached(`plmn:v1:${version}`, KEEP, async () => buildMccMnc(parseManifest(await manifestBytes())));
});

/** How many entries each of the manifest's tables has, for the wiki. */
export const manifestCounts = perRequest(async (): Promise<Record<string, number>> => {
  const version = await manifestVersion();
  return cached(`manifestcounts:v1:${version}`, KEEP, async () => buildIndex(parseManifest(await manifestBytes())).counts);
});
