/**
 * index: rebuild index/* from what is stored. All the logic (timelines,
 * carriers, countries, slugs) is buildIndexes' (src/lib/schema); this job only
 * loads its inputs and writes its outputs. index/sources.json is written last:
 * it is the previous run's slug memory, so it must not move ahead of the docs.
 *
 * buildIndexes reads profiles synchronously, so every Profile a release or
 * ref points at is loaded first.
 */

import * as v from "valibot";

import { buildIndexes, type Profile } from "../../../../src/lib/schema/index.ts";
import { keys } from "../../../../src/lib/storage/keys.ts";
import { fanOut } from "../../../src/fan-out.ts";
import type { JobContext, JobOutput } from "../job.ts";
import { allOrThrow, loadCatalog, READ_CONCURRENCY } from "./shared/catalog.ts";
import { profileSchema, readRecord } from "./shared/records.ts";

const sourcesSchema = v.record(v.string(), v.string());

export async function buildIndex(ctx: JobContext<"index">): Promise<JobOutput<"index">> {
  const catalog = await loadCatalog(ctx.r2);
  const shas = [...new Set([
    ...catalog.releases.flatMap((r) => Object.values(r.sources).flatMap((artifacts) => artifacts.map((a) => a.sha))),
    ...catalog.refs.flatMap((r) => (r.sha ? [r.sha] : [])),
  ])];
  ctx.log(`${catalog.releases.length} releases, ${catalog.refs.length} refs, ${shas.length} artifacts`);

  let loaded = 0;
  const profiles = new Map<string, Profile>();
  const reads = await fanOut(shas, READ_CONCURRENCY, async (sha) => {
    const profile = await readRecord(ctx.r2, keys.norm(sha), profileSchema);
    if (profile) profiles.set(sha, profile);
    await ctx.progress(++loaded, shas.length, "profiles");
  });
  allOrThrow("profiles", reads);
  ctx.log(`${profiles.size} of ${shas.length} artifacts have a profile`);

  const previous = await readRecord(ctx.r2, keys.sources(), sourcesSchema);
  const out = buildIndexes({
    releases: catalog.releases,
    otaRefs: catalog.refs,
    profiles: (sha) => profiles.get(sha),
    ...(previous ? { previous: { sources: previous } } : {}),
  });

  allOrThrow("carrier docs", await fanOut(out.docs, READ_CONCURRENCY, (doc) => ctx.r2.putJson(keys.carrier(doc.carrier.slug), doc)));
  await ctx.r2.putJson(keys.releases(), out.releases);
  await ctx.r2.putJson(keys.countries(), out.countries);
  await ctx.r2.putJson(keys.legacy(), out.legacy);
  await ctx.r2.putJson(keys.carriers(), out.carriers);
  await ctx.r2.putJson(keys.sources(), out.sources);

  return {
    releases: out.releases.length,
    carriers: out.carriers.length,
    countries: out.countries.length,
    sources: Object.keys(out.sources).length,
  };
}
