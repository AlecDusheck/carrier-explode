/** Every release and OTA file in the bucket: normalize learns from it which source an artifact is; index passes it to buildIndexes. */

import { otaFilesSchema, parseSourceKey, releaseSchema, type OtaFile, type Release, type ReleasePlatform, type SourceRef } from "@carrier-explode/schema";
import { keys, releasePrefix } from "@carrier-explode/storage";
import { allOrThrow, fanOut } from "../../../../src/fan-out.ts";
import type { R2Client } from "../../job.ts";
import { READ_CONCURRENCY } from "./limits.ts";
import { readRecord } from "./records.ts";

export interface Catalog {
  readonly releases: readonly Release[];
  readonly otaFiles: readonly OtaFile[];
}

const isOf = <P extends ReleasePlatform>(release: Release, platform: P): release is Extract<Release, { readonly platform: P }> =>
  release.platform === platform;

/** Every `platform` release the bucket holds. */
export async function readReleases<P extends ReleasePlatform>(r2: R2Client, platform: P): Promise<Extract<Release, { readonly platform: P }>[]> {
  const listed = await r2.list(releasePrefix(platform));
  return allOrThrow(`${platform} releases`, await fanOut(listed, READ_CONCURRENCY, async (key) => {
    const release = await readRecord(r2, key, releaseSchema);
    if (!release) throw new Error(`${key}: listed but gone`);
    if (!isOf(release, platform)) throw new Error(`${key}: not a ${platform} release`);
    return release;
  }));
}

export async function loadCatalog(r2: R2Client): Promise<Catalog> {
  const releases = (await Promise.all([readReleases(r2, "ios"), readReleases(r2, "android")])).flat();
  const otaFiles = (await readRecord(r2, keys.otaFiles(), otaFilesSchema)) ?? [];
  return { releases, otaFiles };
}

/** What an artifact is, for its mapper: Android CarrierSettings also need their build's carrier list. */
export type Use =
  | { readonly kind: "apple"; readonly source: SourceRef }
  | { readonly kind: "android"; readonly source: SourceRef; readonly carrierList: string }
  | { readonly kind: "modem" };

type Shipped = { readonly sha: string; readonly key: string; readonly use: Use };

function shipped(catalog: Catalog): Shipped[] {
  const out: Shipped[] = [];
  const add = (sha: string, key: string, use: (source: SourceRef) => Use): void => {
    const source = parseSourceKey(key);
    if (!source) throw new Error(`${key}: not a sourceKey`);
    out.push({ sha, key, use: use(source) });
  };
  const apple = (source: SourceRef): Use => ({ kind: "apple", source });
  for (const r of catalog.releases) {
    if (r.platform === "android") {
      const android = (source: SourceRef): Use => ({ kind: "android", source, carrierList: r.carrierList });
      for (const [key, artifacts] of Object.entries(r.sources)) for (const a of artifacts) add(a.sha, key, android);
    } else {
      for (const [key, a] of Object.entries(r.sources)) add(a.sha, key, apple);
    }
  }
  for (const f of catalog.otaFiles) {
    for (const l of f.listings) add(f.sha, l.source, apple);
  }
  return out;
}

/** Every android.modem-config sha an Android release names. */
const modemConfigShas = (catalog: Catalog): string[] =>
  [...new Set(catalog.releases.flatMap((r) => (r.platform === "android" ? r.modems.flatMap((m) => Object.values(m.configs)) : [])))];

/** sha → its use. Bytes two sources ship identically go to the lowest sourceKey, so the choice is stable. */
export function usesBySha(catalog: Catalog): Map<string, Use> {
  const out = new Map<string, Use>(modemConfigShas(catalog).map((sha) => [sha, { kind: "modem" }]));
  for (const s of shipped(catalog).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    if (!out.has(s.sha)) out.set(s.sha, s.use);
  }
  return out;
}
