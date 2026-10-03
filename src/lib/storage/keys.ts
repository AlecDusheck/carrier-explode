/**
 * Every R2 key of the v2 layout, in one place. The extractor writes them, the
 * site reads them; neither spells a key out anywhere else.
 *
 *   obj/<sha256>                       artifact bytes, as shipped or as packaged (immutable)
 *   meta/<sha256>.json                 ObjMeta: what the bytes are and where they came from
 *   norm/v<N>/<sha256>.json            Profile (src/lib/schema/types.ts), N = PROFILE_SCHEMA
 *   decoded/<kind>/v<N>/<sha256>.json  other derived views (modem summaries, ...)
 *   releases/<platform>/<id>.json      Release
 *   feeds/ios-ota/refs.json            every iOS OTA ref ever seen (OtaRef[]), archived or not
 *   feeds/ios-ota/manifests/<sha1>.plist  Apple manifest snapshots, by content
 *   index/releases.json                ReleaseSummary[] for both platforms, newest first
 *   index/carriers.json                CarrierSummary[]
 *   index/carriers/<slug>.json         CarrierDoc
 *   index/countries.json               CountrySummary[]
 *   index/sources.json                 sourceKey -> carrier slug
 *   index/legacy.json                  v1 path -> v2 path (LegacyRoute[]), for the site's 301s
 *   scan/current.json, scan/<gen>/...  cross-source scan index
 *   jobs/<id>.json                     JobRecord (extractor)
 *
 * Everything under index/ is derived and rebuilt whole by the extractor's
 * `index` job; nothing else writes there. A reader that finds no index/ yet
 * should show an empty site, not fail.
 */

import { PROFILE_SCHEMA, type Platform } from "../schema/types.ts";

export const BUCKET_V2 = "carrier-explode-v2";

export const keys = {
  obj: (sha: string) => `obj/${sha}`,
  meta: (sha: string) => `meta/${sha}.json`,
  norm: (sha: string, schema: number = PROFILE_SCHEMA) => `norm/v${schema}/${sha}.json`,
  decoded: (kind: string, schema: number, sha: string) => `decoded/${kind}/v${schema}/${sha}.json`,
  release: (platform: Platform, id: string) => `releases/${platform}/${id}.json`,
  releasesPrefix: (platform: Platform) => `releases/${platform}/`,
  otaRefs: () => "feeds/ios-ota/refs.json",
  otaManifest: (sha1: string) => `feeds/ios-ota/manifests/${sha1}.plist`,
  releases: () => "index/releases.json",
  carriers: () => "index/carriers.json",
  carrier: (slug: string) => `index/carriers/${slug}.json`,
  countries: () => "index/countries.json",
  sources: () => "index/sources.json",
  legacy: () => "index/legacy.json",
  job: (id: string) => `jobs/${id}.json`,
} as const;

/** Key prefixes a container may write through the extractor's upload API. index/ is the index job's alone. */
export const WRITABLE_PREFIXES = ["obj/", "meta/", "norm/", "decoded/", "releases/", "feeds/", "index/", "scan/", "jobs/"] as const;

export type ArtifactKind =
  | "ios.ipcc"
  | "ios.bbfw"
  | "ios.ftab"
  | "android.carrier_settings"
  | "android.carrier_list"
  | "ios.ota-manifest";

export interface ObjMeta {
  sha256: string;
  size: number;
  kind: ArtifactKind;
  /** iOS bundles: file-set content id. */
  cid?: string;
  /** Upstream digests, when the bytes are exactly the upstream file. */
  sha1?: string;
  sha384?: string;
  /** Where it was first seen. */
  origin: { url?: string; release?: string; path?: string; device?: string };
  storedAt: string;
}

/** An iOS OTA manifest entry, kept after Apple drops it. */
export interface OtaRef {
  url: string;
  /** Source it belongs to (`ios:carrier:TMobile_us`). */
  source: string;
  os: string;
  build: string;
  productType?: string;
  sha1?: string;
  sha384?: string;
  /** Set once archived: obj/<sha>. */
  sha?: string;
  cid?: string;
  firstSeen: string;
  lastSeen: string;
  /** Still in Apple's current manifest. */
  live: boolean;
  /** Last archive failure (HTTP 403, digest mismatch), retried by later runs. */
  error?: string;
}

export interface ReleaseSummary {
  platform: Platform;
  id: string;
  version: string;
  patch?: string;
  released?: string;
  prerelease?: boolean;
  devices: string[];
  sources: number;
}

export interface CarrierSummary {
  slug: string;
  name: string;
  iso?: string;
  /** Which platforms ship settings for it. */
  platforms: Platform[];
  /** Newest change date on any platform, YYYY-MM-DD. */
  updated?: string;
  members: string[];
}

export interface CountrySummary {
  iso: string;
  name: string;
  /** iOS country bundle sourceKeys for it. */
  countryBundles: string[];
  carriers: string[];
}
