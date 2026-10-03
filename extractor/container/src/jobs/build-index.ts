/**
 * index: index/* from what is stored, by buildIndexes alone. The source index
 * goes last: it is the next run's id memory, so it must not get ahead of the docs.
 */

import * as v from "valibot";

import { manifestTables, parseManifest } from "../../../../src/lib/decode/index.ts";
import { buildIndexes, manifestSims, type Profile } from "../../../../src/lib/schema/index.ts";
import { keys } from "../../../../src/lib/storage/keys.ts";
import { fanOut } from "../../../src/fan-out.ts";
import type { JobContext, JobOutput } from "../job.ts";
import { fetchManifest } from "./shared/apple.ts";
import { allOrThrow, loadCatalog, READ_CONCURRENCY, shippedShas } from "./shared/catalog.ts";
import { profileSchema, readRecord } from "./shared/records.ts";

const sourceIndexSchema = v.record(v.string(), v.string());

/** buildIndexes reads profiles synchronously, so all are loaded up front. */
async function loadProfiles(ctx: JobContext<"index">, shas: readonly string[]): Promise<Map<string, Profile>> {
  const profiles = new Map<string, Profile>();
  let loaded = 0;
  allOrThrow("profiles", await fanOut(shas, READ_CONCURRENCY, async (sha) => {
    const profile = await readRecord(ctx.r2, keys.norm(sha), profileSchema);
    if (profile) profiles.set(sha, profile);
    await ctx.progress(++loaded, shas.length, "profiles");
  }));
  return profiles;
}

export async function buildIndex(ctx: JobContext<"index">): Promise<JobOutput<"index">> {
  const catalog = await loadCatalog(ctx.r2);
  const shas = shippedShas(catalog);
  const profiles = await loadProfiles(ctx, shas);
  ctx.log(`${catalog.releases.length} releases, ${catalog.refs.length} refs, ${profiles.size} of ${shas.length} artifacts profiled`);

  const previous = await readRecord(ctx.r2, keys.sourceIndex(), sourceIndexSchema);
  const out = buildIndexes({
    releases: catalog.releases,
    otaRefs: catalog.refs,
    profiles: (sha) => profiles.get(sha),
    manifestSims: manifestSims(manifestTables(parseManifest(await fetchManifest())).plmn),
    ...(previous ? { previous: { sources: previous } } : {}),
  });

  allOrThrow("carrier docs", await fanOut(out.docs, READ_CONCURRENCY, (doc) => ctx.r2.putJson(keys.carrier(doc.carrier.id), doc)));
  await ctx.r2.putJson(keys.releaseIndex(), out.releases);
  await ctx.r2.putJson(keys.countryIndex(), out.countries);
  await ctx.r2.putJson(keys.legacy(), out.legacy);
  await ctx.r2.putJson(keys.carrierIndex(), out.carriers);
  await ctx.r2.putJson(keys.sourceIndex(), out.sources);
  return {
    releases: out.releases.length,
    carriers: out.carriers.length,
    countries: out.countries.length,
    sources: Object.keys(out.sources).length,
  };
}
