/** The index, by buildIndexes alone, from every release, OTA file and head profile in the bucket. */

import type * as v from "valibot";

import { parseManifest } from "@carrier-explode/decode-ios";
import {
  buildIndexes, indexModemConfig, indexProfile, indexShas, linkedConfigShas, manifestSims, modemConfigSchema, profileSchema, type IndexOutput,
} from "@carrier-explode/schema";
import type { Live } from "@carrier-explode/db";
import { keys } from "@carrier-explode/storage";
import { allOrThrow, fanOut } from "../../../src/fan-out.ts";
import type { JobContext } from "../job.ts";
import { loadCatalog } from "./shared/catalog.ts";
import { READ_CONCURRENCY } from "./shared/limits.ts";
import { storedManifest } from "./shared/manifest.ts";
import { readRecord } from "./shared/records.ts";

/** buildIndexes reads norm records synchronously, so all are loaded up front, each kept as only what the index reads; a missing one is left out. */
async function loadNorm<S extends v.GenericSchema, T>(
  ctx: JobContext<"publish">, what: string, shas: readonly string[], schema: S, keep: (record: v.InferOutput<S>) => T,
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  let loaded = 0;
  allOrThrow(what, await fanOut(shas, READ_CONCURRENCY, async (sha) => {
    const record = await readRecord(ctx.r2, keys.norm(sha), schema);
    if (record) out.set(sha, keep(record));
    await ctx.progress(++loaded, shas.length, what);
  }));
  return out;
}

/** The whole index from the bucket and what D1 held: each source's carrier id, which it keeps, the device records and the labels. */
export async function buildIndex(ctx: JobContext<"publish">, live: Pick<Live, "carriers" | "devices" | "labels">): Promise<IndexOutput> {
  const catalog = await loadCatalog(ctx.r2);
  const { devices, labels } = live;
  const shas = indexShas({ releases: catalog.releases, otaFiles: catalog.otaFiles, devices, labels });
  const profiles = await loadNorm(ctx, "profiles", shas, profileSchema, indexProfile);
  const modemShas = linkedConfigShas(catalog.releases);
  const linked = await loadNorm(ctx, "modem configs", modemShas, modemConfigSchema, indexModemConfig);
  const baseShas = [...new Set([...linked.values()].flatMap((c) => c.base ?? []))];
  const modemConfigs = new Map([...linked, ...(await loadNorm(ctx, "modem bases", baseShas, modemConfigSchema, indexModemConfig))]);
  ctx.log(`${catalog.releases.length} releases, ${catalog.otaFiles.length} OTA files, ${profiles.size} of ${shas.length} head profiles, ${linked.size} of ${modemShas.length} modem configs, ${baseShas.length} bases`);
  return buildIndexes({
    releases: catalog.releases,
    otaFiles: catalog.otaFiles,
    devices,
    labels,
    profiles: (sha) => profiles.get(sha),
    modemConfigs: (sha) => modemConfigs.get(sha),
    manifestSims: manifestSims(parseManifest(await storedManifest(ctx.r2))),
    carrierIds: live.carriers,
  });
}
