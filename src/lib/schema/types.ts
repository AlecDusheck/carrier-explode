/**
 * The platform-neutral data model. iOS bundles and Android CarrierSettings are
 * each decoded by their own decoder (src/lib/decode, src/lib/decode/android),
 * then mapped by a platform mapper (./ios.ts, ./android.ts) into a Profile.
 * Everything that compares across platforms works on Profiles only.
 *
 * Contract file: changing a shape here means bumping PROFILE_SCHEMA, because
 * norm/v<PROFILE_SCHEMA>/ in R2 is keyed by it and is rebuilt by the extractor's
 * `reindex` job.
 */

export const PROFILE_SCHEMA = 1;

export const PLATFORMS = ["ios", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * What a source is on its platform:
 * - carrier: an iOS carrier bundle (also Watch, see `family`) or an Android canonical carrier
 * - country: an iOS country bundle (Android has none)
 * - default: settings that apply when nothing else does (Android default.pb / others.pb / no_sim.pb)
 */
export type SourceKind = "carrier" | "country" | "default";

/** One named thing a platform ships settings under. `name` is native: `TMobile_us`, `tmobile_us`. */
export interface SourceRef {
  platform: Platform;
  kind: SourceKind;
  name: string;
  /** iOS only: "Watch" for Watch bundles; absent means the phone family. */
  family?: "Watch";
}

/** `ios:carrier:TMobile_us`, `android:carrier:tmobile_us`, `ios:carrier:Vodafone_uk:Watch`. Stable; used in keys and URLs. */
export const sourceKey = (s: SourceRef) => [s.platform, s.kind, s.name, ...(s.family ? [s.family] : [])].join(":");
export function parseSourceKey(key: string): SourceRef | null {
  const [platform, kind, name, family] = key.split(":");
  if (!(PLATFORMS as readonly string[]).includes(platform) || !name) return null;
  if (kind !== "carrier" && kind !== "country" && kind !== "default") return null;
  return { platform: platform as Platform, kind, name, ...(family === "Watch" ? { family } : {}) };
}

/* ---------------------------------------------------------------- identity */

/**
 * One rule a SIM can match. Every present field must match. Normalised:
 * mccmnc is 5 or 6 digits; hex values are upper-case; prefixes are prefixes.
 * iOS: manifest MobileDeviceCarriersByMccMnc (+ MVNOs) and carrier.plist SupportedSIMs
 *      (`<MCCMNC>`, `_GID1-`, `_GID2-`, `_ID-` ICCID prefix).
 * Android: carrier_list.pb CarrierId (mcc_mnc + one of spn / imsi prefix / gid1).
 */
export interface SimMatcher {
  mccmnc: string;
  gid1?: string;
  gid2?: string;
  spn?: string;
  imsiPrefix?: string;
  iccidPrefix?: string;
}

/** Canonical string for a matcher, for set operations: `310260`, `310260|gid1=6D`. */
export function matcherKey(m: SimMatcher): string {
  const parts = [m.mccmnc];
  for (const k of ["gid1", "gid2", "spn", "imsiPrefix", "iccidPrefix"] as const) if (m[k] !== undefined) parts.push(`${k}=${m[k]}`);
  return parts.join("|");
}

/* -------------------------------------------------------------------- APNs */

export type ApnType =
  | "default" | "mms" | "supl" | "dun" | "hipri" | "fota" | "ims" | "cbs" | "ia" | "emergency"
  | "xcap" | "ut" | "rcs" | "vsim" | "bip" | "enterprise" | "all";
export type IpProtocol = "ip" | "ipv6" | "ipv4v6" | "ppp";
export type ApnAuth = "none" | "pap" | "chap" | "pap_or_chap";

/** A data connection profile, as both platforms describe it. Unknown or unset fields are omitted, never defaulted. */
export interface Apn {
  apn: string;
  /** Human label (Android `name`, iOS has none for most). */
  label?: string;
  types: ApnType[];
  protocol?: IpProtocol;
  roamingProtocol?: IpProtocol;
  auth?: ApnAuth;
  user?: string;
  /** Only whether one is set: passwords are not republished. */
  hasPassword?: boolean;
  proxy?: string;
  port?: string;
  mmsc?: string;
  mmsProxy?: string;
  mmsPort?: string;
  mtu?: number;
  /** RATs the APN is limited to, e.g. ["lte","nr"]; absent = any. */
  bearers?: string[];
  /** Native location, e.g. `carrier.plist:apns[0]` or `apns.apn[3]`. */
  path: string;
}

/* ---------------------------------------------------------------- concepts */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** For `state` concepts: on (and on by default), available (switch / server-decided / SIM-dependent), no. */
export type FeatureState = "on" | "available" | "no";

/** A native setting a concept value was read from. */
export interface NativeRef {
  /** iOS: `carrier.plist:Enable5GAutoByDefault`, `overrides_N104_N94.plist:...`; Android: `config:carrier_volte_available_bool`. */
  path: string;
  value: Json;
}

/**
 * One concept's value in one profile. `value` is in the concept's own unit
 * (see ConceptDef.type in ./concepts.ts). Absent from Profile.concepts means
 * the platform has no way to express it, or the mapper does not know how yet;
 * `{ value: null }` means expressible but not set.
 */
export interface ConceptValue {
  value: Json;
  state?: FeatureState;
  because: NativeRef[];
  /** How sure the mapping is: "exact" (same meaning), "derived" (computed from several keys), "approx" (closest equivalent). */
  fidelity?: "exact" | "derived" | "approx";
}

/* ----------------------------------------------------------------- profile */

/**
 * The normalised view of one stored artifact (one iOS bundle, one Android
 * CarrierSettings). Stored at norm/v<PROFILE_SCHEMA>/<sha>.json.
 */
export interface Profile {
  schema: typeof PROFILE_SCHEMA;
  source: SourceRef;
  /** sha256 of the artifact bytes (R2 obj/<sha>). */
  sha: string;
  /** The source's own version: iOS bundle CFBundleVersion, Android CarrierSettings.version. */
  version: string;
  identity: {
    display?: string;
    /** Lower-case ISO 3166 alpha-2 codes this source serves. */
    iso: string[];
    sims: SimMatcher[];
  };
  apns: Apn[];
  /** By ConceptId (./concepts.ts). */
  concepts: Record<string, ConceptValue>;
  /**
   * Every native leaf, flattened (`flatten.ts` style), keyed `<file>:<path>`
   * for iOS and `config:<key>` / `apns[<i>].<field>` / `vendor:<client>` for Android.
   * What "what does everyone else put here" and raw diffs read.
   */
  raw: Record<string, Json>;
  /**
   * Settings that only apply in some situations: iOS MVNOOverrides and per-phone
   * override files. Each is a partial Profile (concepts/apns that differ) plus
   * what selects it. Android has none: its MVNOs are separate sources.
   */
  variants: ProfileVariant[];
}

export interface ProfileVariant {
  id: string;
  label: string;
  /** What selects it: a SIM rule (MVNO) or devices (override files). */
  when: { sims?: SimMatcher[]; devices?: string[] };
  concepts: Record<string, ConceptValue>;
  apns?: Apn[];
}

/* ---------------------------------------------------------------- carriers */

/**
 * A carrier as people know it, across platforms: the sources both platforms
 * ship for it, linked by the SIMs they claim (./identity.ts) plus manual links.
 */
export interface Carrier {
  /** URL slug, e.g. `t-mobile-us`. Stable once published. */
  slug: string;
  name: string;
  iso?: string;
  /** Every source that belongs to this carrier, any platform. */
  members: SourceRef[];
  /** The union of the members' SIM matchers. */
  sims: SimMatcher[];
  /** Why each member is linked: shared matcher keys, or "manual". */
  links: Array<{ source: string; reason: "manual" | "sims"; shared?: string[] }>;
}

/* ---------------------------------------------------------------- releases */

/**
 * One OS image both platforms ship settings inside: an iOS build or a Pixel build.
 * Stored at releases/<platform>/<id>.json.
 */
export interface Release {
  platform: Platform;
  /** iOS build (`23C55`) or Android build id (`CP3A.260905.009`). */
  id: string;
  /** iOS: "27.2", "27.2 beta 2". Android: "16", "16 QPR2". */
  version: string;
  /** Android security patch level / monthly tag, YYYY-MM. */
  patch?: string;
  released?: string;
  prerelease?: boolean;
  /** iPhone product types / Pixel codenames whose images this was built from. */
  devices: string[];
  extractedAt: string;
  /** sourceKey -> what the image carries for it. */
  sources: Record<string, ReleaseSource>;
  /** Android: sha of carrier_list.pb. */
  carrierList?: string;
  /** iOS: modem packages (unchanged shape from the v1 index, see src/lib/server/timeline.ts ImageModem). */
  modems?: unknown[];
}

export interface ReleaseSource {
  sha: string;
  /** The source's own version (Profile.version). */
  version: string;
  size: number;
  /** iOS: the bundle's file-set content id (src/lib/decode/bundle.ts contentId), equal across re-zips. */
  cid?: string;
}

/* ---------------------------------------------------------------- timeline */

/** One version of a source, from an image or an OTA feed. Newest first in a timeline. */
export interface TimelineEntry {
  /** URL segment, unique within the source: `ios-27.2`, `ota-58.1`, `android-cp3a.260905.009`. */
  slug: string;
  via: "image" | "ota";
  version: string;
  /** Releases (image) or OS keys (iOS OTA) carrying exactly this artifact. */
  releases: string[];
  /** R2 object, when we hold the bytes. */
  sha?: string;
  /** Upstream URL, for iOS OTA files not archived yet (the site fetches these from Apple). */
  url?: string;
  /** Upstream digests (iOS OTA). */
  sha1?: string;
  sha384?: string;
  cid?: string;
  productType?: string;
  beta?: boolean;
  changed: boolean;
}

/** index/carriers/<slug>.json: everything a carrier page needs before opening any artifact. */
export interface CarrierDoc {
  carrier: Carrier;
  /** sourceKey -> timeline. */
  timelines: Record<string, TimelineEntry[]>;
}
