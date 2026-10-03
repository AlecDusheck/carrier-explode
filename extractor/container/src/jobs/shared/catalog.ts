/** Every release and OTA ref in the bucket: normalize learns from it which source an artifact is; index passes it to buildIndexes. */

import { decoderFamily, parseSourceKey, PLATFORMS, type Release, type SourceRef } from "../../../../../src/lib/schema/index.ts";
import { keys, type OtaRef } from "../../../../../src/lib/storage/keys.ts";
import { fanOut, failures, succeeded, type Settled } from "../../../../src/fan-out.ts";
import type { R2Client } from "../../job.ts";
import { otaRefsSchema, readRecord, releaseSchema } from "./records.ts";

/** Parallel R2 reads per job. */
export const READ_CONCURRENCY = 16;

export interface Catalog {
  readonly releases: readonly Release[];
  readonly refs: readonly OtaRef[];
}

/** The values, or one error naming the failures: a partial read must not pass as whole. */
export function allOrThrow<O>(what: string, results: readonly Settled<O>[]): O[] {
  const failed = failures(results);
  if (failed.length) throw new Error(`${what}: ${failed.length} failed: ${failed.slice(0, 5).join(" | ")}`);
  return succeeded(results);
}

export async function loadCatalog(r2: R2Client): Promise<Catalog> {
  const releaseKeys = (await Promise.all(PLATFORMS.map((p) => r2.list(keys.releases(p))))).flat();
  const releases = allOrThrow("releases", await fanOut(releaseKeys, READ_CONCURRENCY, async (key) => {
    const release = await readRecord(r2, key, releaseSchema);
    if (!release) throw new Error(`${key}: listed but gone`);
    return release;
  }));
  const refs = (await readRecord(r2, keys.otaRefs(), otaRefsSchema)) ?? [];
  return { releases, refs };
}

/** What an artifact is, for its mapper: Android CarrierSettings also need their build's carrier list. */
export type Use =
  | { readonly family: "apple"; readonly source: SourceRef }
  | { readonly family: "android"; readonly source: SourceRef; readonly carrierList: string };

type Shipped = { readonly sha: string; readonly key: string; readonly carrierList: string | null };

function shipped(catalog: Catalog): Shipped[] {
  const out: Shipped[] = [];
  for (const r of catalog.releases) {
    if (r.platform === "android") {
      for (const [key, artifacts] of Object.entries(r.sources)) for (const a of artifacts) out.push({ sha: a.sha, key, carrierList: r.carrierList });
    } else {
      for (const [key, a] of Object.entries(r.sources)) out.push({ sha: a.sha, key, carrierList: null });
    }
  }
  for (const ref of catalog.refs) if (ref.archive.state === "archived") out.push({ sha: ref.archive.sha, key: ref.source, carrierList: null });
  return out;
}

/** Every sha a release or archived ref ships. */
export const shippedShas = (catalog: Catalog): string[] => [...new Set(shipped(catalog).map((s) => s.sha))];

/** sha → its use. Bytes two sources ship identically go to the lowest sourceKey, so the choice is stable. */
export function usesBySha(catalog: Catalog): Map<string, Use> {
  const out = new Map<string, Use>();
  for (const s of shipped(catalog).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    if (out.has(s.sha)) continue;
    const source = parseSourceKey(s.key);
    if (!source) throw new Error(`${s.key}: not a sourceKey (shipping ${s.sha})`);
    const family = decoderFamily(source.platform);
    if (family === "android") {
      if (s.carrierList === null) throw new Error(`${s.key}: an Android source outside an Android release`);
      out.set(s.sha, { family, source, carrierList: s.carrierList });
    } else {
      out.set(s.sha, { family, source });
    }
  }
  return out;
}
