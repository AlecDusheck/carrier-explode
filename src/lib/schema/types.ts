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

/**
 * The OS that ships the settings, which is also the first URL segment after
 * the kind (`/carriers/ipados/Verizon_LTE/72.0/`). Apple's iPad and Watch
 * bundles are separate files with their own version lines (the manifest's
 * ByProductType "iPad" and CarrierBundles.Watch), so they are platforms, not
 * variants of iOS. ios, ipados and watchos share the iOS decoder.
 */
export const PLATFORMS = ["ios", "ipados", "watchos", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const isPlatform = (p: string): p is Platform => (PLATFORMS as readonly string[]).includes(p);

/** Which decoder family reads a platform's artifacts. */
export type DecoderFamily = "apple" | "android";
export const decoderFamily = (p: Platform): DecoderFamily => (p === "android" ? "android" : "apple");

/**
 * What a source is on its platform:
 * - carrier: an Apple carrier bundle or an Android canonical carrier
 * - country: an Apple country bundle (Android has none)
 * - default: settings that apply when nothing else does (Android default.pb, no_sim.pb)
 */
export const SOURCE_KINDS = ["carrier", "country", "default"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
const isSourceKind = (k: string): k is SourceKind => (SOURCE_KINDS as readonly string[]).includes(k);

/** One named thing a platform ships settings under. `name` is native: `TMobile_us`, `tmobile_us`. */
export interface SourceRef {
  readonly platform: Platform;
  readonly kind: SourceKind;
  readonly name: string;
}

/** `ios:carrier:TMobile_us`, `watchos:carrier:Vodafone_uk`, `android:carrier:tmobile_us`. Stable: R2 keys and indexes use it. */
export const sourceKey = (s: SourceRef): string => `${s.platform}:${s.kind}:${s.name}`;

export function parseSourceKey(key: string): SourceRef | undefined {
  const [platform, kind, name, ...rest] = key.split(":");
  if (platform === undefined || kind === undefined || name === undefined || name === "" || rest.length > 0) return undefined;
  if (!isPlatform(platform) || !isSourceKind(kind)) return undefined;
  return { platform, kind, name };
}

/** The URL path segment for each kind: `/carriers/…`, `/countries/…`, `/defaults/…`. */
export const KIND_SEGMENT = { carrier: "carriers", country: "countries", default: "defaults" } as const satisfies Record<SourceKind, string>;

/** `/carriers/ios/Verizon_LTE`. Every page of a source lives under it: `/<version>/<tab>`. */
export const sourcePath = (s: SourceRef): string => `/${KIND_SEGMENT[s.kind]}/${s.platform}/${encodeURIComponent(s.name)}`;

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
  /**
   * Internal id for index/carriers/<id>.json, never shown in a URL: pages
   * are per source (sourcePath), and a carrier is what links a source's page
   * to its counterparts on other platforms. Stable across index rebuilds.
   */
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
  /**
   * sourceKey -> the distinct artifacts the release carries for it, each with
   * the devices that carry it. iOS: always one entry without `devices` (a
   * bundle is merged across every iPhone IPSW, and per-phone differences live
   * inside it as override files -> Profile.variants). Android: one entry per
   * distinct file. A build ships different CarrierSettings per device
   * generation (CP3A.260905.009: Pixel 6, Fold, 9 and 10 Pro differ in 632 of
   * 633 files, VoLTE and Wi-Fi calling among them), and content addressing
   * collapses the devices that agree (Pixel 9 = 9 Pro Fold).
   */
  sources: Record<string, ReleaseSource[]>;
  /** Android: sha of carrier_list.pb (one per build: identical across devices). */
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
  /** Devices carrying exactly this artifact (Pixel codenames; Apple product types for model-specific entries). Absent: every device. */
  devices?: string[];
}

/* ---------------------------------------------------------------- timeline */

/**
 * One version of a source: one distinct content, however many copies of it
 * exist. Newest first in a timeline. The URL segment is the source's own
 * version (`/carriers/ios/Verizon_LTE/72.0/`), see `slug`.
 */
export interface TimelineEntry {
  /**
   * URL segment, unique within the source. The source's own version, as is
   * (`72.0`, `79000000034`). Copies with the same content (equal cid, or equal
   * sha) are one entry. Two different contents under one version are rare and
   * real (an image's merged bundle vs the OTA file of the same build), so the
   * newer-by-precedence keeps the bare version and each other gets
   * `<version>+<first 8 hex of its sha or upstream sha1>`, semver's
   * build-metadata form for "same version, different build".
   */
  slug: string;
  version: string;
  /** Every copy of this content, image and OTA alike. At least one. */
  copies: TimelineCopy[];
  /**
   * The devices this content is for. Absent: every device of the platform.
   * Android: the Pixels carrying this file. Apple: the handful of old
   * model-specific manifest entries (iPhone7,1). `changed` compares against
   * the previous entry for an overlapping device set, never across them.
   */
  devices?: string[];
  /** Only ever in beta images: newest, but not what a device on a release runs. */
  beta: boolean;
  changed: boolean;
}

/** One place a version's bytes come from. */
export type TimelineCopy =
  | {
      readonly via: "image";
      /** Releases carrying it: iOS builds / Pixel builds. */
      readonly releases: string[];
      readonly sha: string;
      readonly cid?: string;
    }
  | {
      readonly via: "ota";
      /** OS keys the manifest lists it under. */
      readonly os: string[];
      readonly url: string;
      /** Set once archived to R2; until then the site fetches `url`. */
      readonly sha?: string;
      readonly cid?: string;
      readonly sha1?: string;
      readonly sha384?: string;
    };

/** v1 URL slugs (`ios-27.2`, `ota-58.1`, `ota-58.1-iPad`) -> where they live now, for the site's permanent redirects. */
export interface LegacyRoute {
  readonly from: string;
  readonly to: string;
}

/** index/carriers/<slug>.json: everything a carrier page needs before opening any artifact. */
export interface CarrierDoc {
  carrier: Carrier;
  /** sourceKey -> timeline. */
  timelines: Record<string, TimelineEntry[]>;
  /**
   * sourceKey -> feature states per device group at the head, so a page can say
   * "VoLTE: on for Pixel 8 and later, off on Pixel 6" without opening artifacts.
   */
  states: Record<string, DeviceStates[]>;
}

/** The `state` concepts of one device group of a source. */
export interface DeviceStates {
  /**
   * Pixel codenames or iPhone product types it applies to. Absent: every device
   * no other group names (iOS: carrier.plist with the newest phone's overrides).
   */
  devices?: string[];
  /** Timeline entry (slug) the states were read from. */
  slug: string;
  /** Concept id -> state. */
  states: Record<string, FeatureState>;
}
