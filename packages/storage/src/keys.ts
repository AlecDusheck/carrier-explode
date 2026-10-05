/** Every R2 key of the v2 layout. Nothing else spells a key out. */

import { PROFILE_SCHEMA, type ReleasePlatform } from "@carrier-explode/schema/types";

/** What a job may be granted to write. jobs/ is the container runtime's alone: each job's record. */
const PREFIXES = [
  "obj/", "meta/", "norm/", "decoded/", "releases/ios/", "releases/android/", "scan/", "staging/",
] as const;
export type Prefix = (typeof PREFIXES)[number];

export const releasePrefix = (platform: ReleasePlatform): Prefix => `releases/${platform}/`;

const OBJ = "obj/" satisfies Prefix;

export const keys = {
  objPrefix: (): Prefix => OBJ,
  obj: (sha: string): string => `${OBJ}${sha}`,
  /** The sha256 an obj/ key names; undefined for any other key. */
  shaOfObj: (key: string): string | undefined => (key.startsWith(OBJ) && key.length > OBJ.length ? key.slice(OBJ.length) : undefined),
  metaPrefix: (): Prefix => "meta/",
  meta: (sha: string): string => `meta/${sha}.json`,
  norm: (sha: string): string => `norm/v${PROFILE_SCHEMA}/${sha}.json`,
  /** A list of band combinations a ModemConfig names by its ComboSet.key. */
  combos: (key: string): string => `norm/v${PROFILE_SCHEMA}/combos/${key}.json`,
  /** A modem package's decoded summary; `schema` is decode-ios's MODEM_SUMMARY_SCHEMA, which storage may not import. */
  modemSummary: (schema: number, sha: string): string => `decoded/baseband/v${schema}/${sha}.json`,
  release: (platform: ReleasePlatform, id: string): string => `${releasePrefix(platform)}${id}.json`,
  otaFiles: (): string => "feeds/apple-ota/files.json",
  otaManifest: (sha1: string): string => `feeds/apple-ota/manifests/${sha1}.plist`,
  /** The snapshot the feed was last built from (OtaManifestPointer), so readers never fetch Apple live. */
  otaManifestCurrent: (): string => "feeds/apple-ota/manifests/current.json",
  scanPrefix: (): Prefix => "scan/",
  job: (id: string): string => `jobs/${id}.json`,
  /** What the container runs: written by the Worker before it starts the job. */
  jobSpec: (id: string): string => `jobs/${id}.spec.json`,
  /** A fan-out job's intermediate output, deleted by the job that merges it. */
  stagingPrefix: (jobId: string): string => `staging/${jobId}/`,
  staging: (jobId: string, name: string): string => `staging/${jobId}/${name}`,
} as const;

export const ARTIFACT_KINDS = [
  "apple.ipcc", "apple.bbfw", "apple.ftab", "apple.ota-manifest", "android.carrier-settings", "android.carrier-list", "android.modem-config",
] as const;
type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

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

/** feeds/apple-ota/manifests/current.json */
export interface OtaManifestPointer {
  readonly sha1: string;
}
