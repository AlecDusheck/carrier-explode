/** Every R2 key of the v2 layout (docs/architecture-v2.md). Nothing else spells a key out. */

import { PROFILE_SCHEMA, type Archive, type Digest, type Platform, type ReleaseHeader } from "../schema/types.ts";

export const BUCKET = "carrier-explode-v2";

export const keys = {
  obj: (sha: string) => `obj/${sha}`,
  meta: (sha: string) => `meta/${sha}.json`,
  norm: (sha: string, schema: number = PROFILE_SCHEMA) => `norm/v${schema}/${sha}.json`,
  decoded: (view: string, schema: number, sha: string) => `decoded/${view}/v${schema}/${sha}.json`,
  release: (platform: Platform, id: string) => `releases/${platform}/${id}.json`,
  releases: (platform: Platform) => `releases/${platform}/`,
  otaRefs: () => "feeds/apple-ota/refs.json",
  otaManifest: (sha1: string) => `feeds/apple-ota/manifests/${sha1}.plist`,
  releaseIndex: () => "index/releases.json",
  carrierIndex: () => "index/carriers.json",
  carrier: (id: string) => `index/carriers/${id}.json`,
  countryIndex: () => "index/countries.json",
  sourceIndex: () => "index/sources.json",
  legacy: () => "index/legacy.json",
  job: (id: string) => `jobs/${id}.json`,
} as const satisfies Record<string, (...args: never[]) => string>;

export type ArtifactKind =
  | "apple.ipcc"
  | "apple.bbfw"
  | "apple.ftab"
  | "apple.ota-manifest"
  | "android.carrier-settings"
  | "android.carrier-list";

/** Where an artifact was first seen. */
export type Origin =
  | { readonly via: "download"; readonly url: string }
  | { readonly via: "image"; readonly release: string; readonly device: string; readonly path: string };

/** meta/<sha>.json */
export interface ObjMeta {
  readonly sha256: string;
  readonly size: number;
  readonly kind: ArtifactKind;
  /** Apple bundles: identifies the files, so it survives re-zipping. */
  readonly cid?: string;
  readonly origin: Origin;
  readonly storedAt: string;
}

/** An Apple OTA manifest entry, kept after Apple drops it. */
export interface OtaRef {
  readonly url: string;
  readonly source: string;
  readonly os: string;
  readonly build: string;
  /** Model-specific bundles only (`iPhone7,1`). */
  readonly model?: string;
  readonly published?: string;
  readonly digest?: Digest;
  readonly archive: Archive;
  readonly firstSeen: string;
  readonly lastSeen: string;
  /** In Apple's current manifest. */
  readonly live: boolean;
}

export type ReleaseSummary = ReleaseHeader & { readonly sourceCount: number };

export interface CarrierSummary {
  readonly id: string;
  readonly name: string;
  readonly iso?: string;
  readonly platforms: readonly Platform[];
  /** YYYY-MM-DD of the newest change on any platform. */
  readonly updated?: string;
  readonly members: readonly string[];
}

export interface CountrySummary {
  readonly iso: string;
  readonly name: string;
  readonly countryBundles: readonly string[];
  readonly carriers: readonly string[];
}
