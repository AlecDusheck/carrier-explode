/** Every R2 key of the v2 layout. Nothing else spells a key out. */

import { PROFILE_SCHEMA, type ModemKind, type ReleasePlatform } from "../schema/types.ts";

export const BUCKET = "carrier-explode-v2";

/** What a job may be granted to write. jobs/ is the Worker's alone. */
export const PREFIXES = [
  "obj/", "meta/", "norm/", "decoded/", "releases/ios/", "releases/android/", "feeds/apple-ota/", "index/", "scan/",
] as const;
export type Prefix = (typeof PREFIXES)[number];

export const releasePrefix = (platform: ReleasePlatform): Prefix => `releases/${platform}/`;

export const keys = {
  obj: (sha: string): string => `obj/${sha}`,
  meta: (sha: string): string => `meta/${sha}.json`,
  norm: (sha: string): string => `norm/v${PROFILE_SCHEMA}/${sha}.json`,
  decoded: (view: string, schema: number, id: string): string => `decoded/${view}/v${schema}/${id}.json`,
  release: (platform: ReleasePlatform, id: string): string => `${releasePrefix(platform)}${id}.json`,
  otaFiles: (): string => "feeds/apple-ota/files.json",
  otaManifest: (sha1: string): string => `feeds/apple-ota/manifests/${sha1}.plist`,
  releaseIndex: (): string => "index/releases.json",
  carrierIndex: (): string => "index/carriers.json",
  carrier: (id: string): string => `index/carriers/${id}.json`,
  countryIndex: (): string => "index/countries.json",
  sourceIndex: (): string => "index/sources.json",
  legacy: (): string => "index/legacy.json",
  job: (id: string): string => `jobs/${id}.json`,
} as const;

export type ArtifactKind = "apple.ipcc" | `apple.${ModemKind}` | "apple.ota-manifest" | "android.carrier-settings" | "android.carrier-list";

/** Where an artifact was first seen. */
export type Origin =
  | { readonly kind: "download"; readonly url: string }
  | { readonly kind: "image"; readonly release: string; readonly device: string; readonly path: string };

/** What a writer states about an artifact: putObj's argument. */
export type ObjClaim =
  | { readonly kind: "apple.ipcc"; readonly cid: string; readonly origin: Origin }
  | { readonly kind: Exclude<ArtifactKind, "apple.ipcc">; readonly origin: Origin };

/** meta/<sha>.json */
export type ObjMeta = ObjClaim & { readonly sha: string; readonly size: number; readonly storedAt: string };
