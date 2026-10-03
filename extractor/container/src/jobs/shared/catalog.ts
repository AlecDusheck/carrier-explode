/**
 * What the bucket says exists: every release of both platforms and every iOS
 * OTA ref. normalize reads it to learn which source an artifact is; index
 * hands it to buildIndexes whole.
 */

import { PLATFORMS, parseSourceKey, type Release, type SourceRef } from "../../../../../src/lib/schema/index.ts";
import { keys, type OtaRef } from "../../../../../src/lib/storage/keys.ts";
import { fanOut, failures, succeeded, type Settled } from "../../../../src/fan-out.ts";
import type { R2Client } from "../../job.ts";
import { otaRefsSchema, readRecord, releaseSchema } from "./records.ts";

/** Parallel R2 reads per job: enough to hide latency, few enough to stay polite to the Worker. */
export const READ_CONCURRENCY = 16;

export interface Catalog {
  readonly releases: readonly Release[];
  readonly refs: readonly OtaRef[];
}

/** Values of `results`, or one error naming every failure: a partial catalog would build a wrong index. */
export function allOrThrow<O>(what: string, results: readonly Settled<O>[]): O[] {
  const failed = failures(results);
  if (failed.length) throw new Error(`${what}: ${failed.length} failed: ${failed.slice(0, 5).join(" | ")}`);
  return succeeded(results);
}

export async function loadCatalog(r2: R2Client): Promise<Catalog> {
  const releaseKeys = (await Promise.all(PLATFORMS.map((p) => r2.list(keys.releasesPrefix(p))))).flat();
  const releases = allOrThrow("releases", await fanOut(releaseKeys, READ_CONCURRENCY, async (key) => {
    const release = await readRecord(r2, key, releaseSchema);
    if (!release) throw new Error(`${key}: listed but gone`);
    return release;
  }));
  const refs = (await readRecord(r2, keys.otaRefs(), otaRefsSchema)) ?? [];
  return { releases, refs };
}

/** Where an artifact is used: its source, and for an Android CarrierSettings the carrier_list.pb its release shipped. */
export interface Use {
  readonly source: SourceRef;
  readonly carrierList?: string;
}

/**
 * sha → its use. An artifact two sources ship byte-identical goes to the
 * lowest sourceKey, so the choice is stable across runs.
 */
export function usesBySha(catalog: Catalog): Map<string, Use> {
  const found: Array<{ sha: string; key: string; carrierList?: string }> = [];
  for (const r of catalog.releases) {
    for (const [key, s] of Object.entries(r.sources)) found.push({ sha: s.sha, key, ...(r.carrierList ? { carrierList: r.carrierList } : {}) });
  }
  for (const ref of catalog.refs) if (ref.sha) found.push({ sha: ref.sha, key: ref.source });
  found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out = new Map<string, Use>();
  for (const f of found) {
    const source = parseSourceKey(f.key);
    if (!source || out.has(f.sha)) continue;
    out.set(f.sha, { source, ...(f.carrierList ? { carrierList: f.carrierList } : {}) });
  }
  return out;
}
