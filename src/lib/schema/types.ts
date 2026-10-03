/** The platform-neutral model. Each platform's mapper turns one decoded artifact into a Profile. */

/** Bump when a stored shape changes: norm/v<N>/ is keyed by it and rebuilt by `reindex`. */
export const PROFILE_SCHEMA = 1;

/** The OS that ships the settings. iPad and Watch bundles are separate files with their own versions. */
export const PLATFORMS = ["ios", "ipados", "watchos", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const isPlatform = (value: string): value is Platform => PLATFORMS.some((p) => p === value);

export type DecoderFamily = "apple" | "android";
export const decoderFamily = (platform: Platform): DecoderFamily => (platform === "android" ? "android" : "apple");

/** `default`: Android's default.pb and no_sim.pb, which apply when no carrier matches. */
export const SOURCE_KINDS = ["carrier", "country", "default"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
const isSourceKind = (value: string): value is SourceKind => SOURCE_KINDS.some((k) => k === value);

/** A named thing a platform ships settings under; `name` is native (`TMobile_us`, `tmobile_us`). */
export interface SourceRef {
  readonly platform: Platform;
  readonly kind: SourceKind;
  readonly name: string;
}

/** `ios:carrier:TMobile_us`. */
export const sourceKey = (s: SourceRef): string => `${s.platform}:${s.kind}:${s.name}`;

export function parseSourceKey(key: string): SourceRef | undefined {
  const [platform, kind, name, ...rest] = key.split(":");
  if (platform === undefined || kind === undefined || !name || rest.length > 0) return undefined;
  if (!isPlatform(platform) || !isSourceKind(kind)) return undefined;
  return { platform, kind, name };
}

export const KIND_SEGMENT = { carrier: "carriers", country: "countries", default: "defaults" } as const satisfies Record<SourceKind, string>;

/** `/carriers/ios/Verizon_LTE`. */
export const sourcePath = (s: SourceRef): string => `/${KIND_SEGMENT[s.kind]}/${s.platform}/${encodeURIComponent(s.name)}`;

/**
 * A SIM rule; every present qualifier must match. mccmnc is 5–6 digits, hex is
 * upper-case, prefixes are prefixes. Apple combines qualifiers; Android uses at most one.
 */
export interface SimMatcher {
  readonly mccmnc: string;
  readonly gid1?: string;
  readonly gid2?: string;
  readonly spn?: string;
  readonly imsiPrefix?: string;
  readonly iccidPrefix?: string;
}

const QUALIFIERS = ["gid1", "gid2", "spn", "imsiPrefix", "iccidPrefix"] as const satisfies readonly (keyof SimMatcher)[];

/** `310260`, `310260|gid1=6D`: equal rules give equal keys. */
export function matcherKey(m: SimMatcher): string {
  return [m.mccmnc, ...QUALIFIERS.flatMap((q) => (m[q] === undefined ? [] : [`${q}=${m[q]}`]))].join("|");
}

export type ApnType =
  | "default" | "mms" | "supl" | "dun" | "hipri" | "fota" | "ims" | "cbs" | "ia" | "emergency"
  | "xcap" | "ut" | "rcs" | "vsim" | "bip" | "enterprise" | "all";
export type IpProtocol = "ip" | "ipv6" | "ipv4v6" | "ppp";
export type ApnAuth = "none" | "pap" | "chap" | "pap_or_chap";

/** A data connection profile. Fields the source leaves unset are absent, never defaulted. */
export interface Apn {
  readonly apn: string;
  readonly label?: string;
  readonly types: readonly ApnType[];
  readonly protocol?: IpProtocol;
  readonly roamingProtocol?: IpProtocol;
  readonly auth?: ApnAuth;
  readonly user?: string;
  /** Passwords are never republished. */
  readonly hasPassword: boolean;
  readonly proxy?: string;
  readonly port?: string;
  readonly mmsc?: string;
  readonly mmsProxy?: string;
  readonly mmsPort?: string;
  readonly mtu?: number;
  /** Radio technologies it is limited to; absent means any. */
  readonly bearers?: readonly string[];
  /** Native location: `carrier.plist:apns[0]`, `apns[3]`. */
  readonly path: string;
}

export type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };

/** on: on by default. available: a switch, or decided per plan or SIM. */
export type FeatureState = "on" | "available" | "no";

/** A native setting a concept was read from: `carrier.plist:Enable5GAutoByDefault`, `config:carrier_volte_available_bool`. */
export interface NativeRef {
  readonly path: string;
  readonly value: Json;
}

/** exact: same meaning. derived: computed from several settings. approx: the closest equivalent. */
export type Fidelity = "exact" | "derived" | "approx";

/** A concept's reading in one profile. A concept the platform cannot express is absent from Profile.concepts. */
export type ConceptValue =
  | { readonly kind: "state"; readonly state: FeatureState; readonly because: readonly NativeRef[]; readonly fidelity: Fidelity }
  | { readonly kind: "value"; readonly value: Json; readonly because: readonly NativeRef[]; readonly fidelity: Fidelity }
  | { readonly kind: "unset" };

/** One stored artifact, normalised. Stored at norm/v<PROFILE_SCHEMA>/<sha>.json. */
export interface Profile {
  readonly schema: typeof PROFILE_SCHEMA;
  readonly source: SourceRef;
  readonly sha: string;
  readonly version: string;
  readonly identity: {
    readonly display?: string;
    /** Lower-case ISO 3166 alpha-2. */
    readonly iso: readonly string[];
    readonly sims: readonly SimMatcher[];
  };
  readonly apns: readonly Apn[];
  /** Keyed by concept id. */
  readonly concepts: Readonly<Record<string, ConceptValue>>;
  /** Every native leaf: `<file>:<path>` (Apple), `config:<key>`, `apns[<i>].<field>` (Android). */
  readonly raw: Readonly<Record<string, Json>>;
  /** Apple only: MVNO configurations and per-phone override files. */
  readonly variants: readonly ProfileVariant[];
}

export type VariantSelector =
  | { readonly by: "sim"; readonly sims: readonly SimMatcher[] }
  | { readonly by: "device"; readonly devices: readonly string[] };

/** The concepts and APNs that differ when the selector applies. */
export interface ProfileVariant {
  readonly id: string;
  readonly label: string;
  readonly when: VariantSelector;
  readonly concepts: Readonly<Record<string, ConceptValue>>;
  readonly apns: readonly Apn[];
}

/** A carrier across platforms: sources linked by the SIMs they claim. Links pages; never in a URL. */
export interface Carrier {
  readonly id: string;
  readonly name: string;
  readonly iso?: string;
  readonly members: readonly SourceRef[];
  readonly sims: readonly SimMatcher[];
  readonly links: readonly CarrierLink[];
}

export type CarrierLink =
  | { readonly source: string; readonly reason: "sims"; readonly shared: readonly string[] }
  | { readonly source: string; readonly reason: "manual" };

/** An OS image's settings. Stored at releases/<platform>/<id>.json. */
export type Release = AppleRelease | AndroidRelease;
export type ReleaseHeader = AppleReleaseHeader | AndroidReleaseHeader;

interface ReleaseHeaderBase {
  /** iOS build (`23C55`) or Pixel build (`CP3A.260905.009`). */
  readonly id: string;
  readonly version: string;
  readonly released?: string;
  readonly prerelease: boolean;
  readonly devices: readonly string[];
  readonly extractedAt: string;
}

export interface AppleReleaseHeader extends ReleaseHeaderBase {
  readonly platform: Exclude<Platform, "android">;
}

export interface AndroidReleaseHeader extends ReleaseHeaderBase {
  readonly platform: "android";
  /** YYYY-MM. */
  readonly patch: string;
}

export interface AppleRelease extends AppleReleaseHeader {
  /** One bundle per source, merged across every IPSW of the build. */
  readonly sources: Readonly<Record<string, AppleArtifact>>;
  readonly modems: readonly ImageModem[];
}

export interface AndroidRelease extends AndroidReleaseHeader {
  /** Each source's distinct files; devices that agree share one. */
  readonly sources: Readonly<Record<string, readonly AndroidArtifact[]>>;
  readonly carrierList: string;
}

export interface Artifact {
  readonly sha: string;
  readonly version: string;
  readonly size: number;
}

/** `cid` identifies a bundle's files, so it survives re-zipping. */
export interface AppleArtifact extends Artifact {
  readonly cid: string;
}

export interface AndroidArtifact extends Artifact {
  readonly devices: readonly string[];
}

export type ModemKind = "bbfw" | "ftab";

export interface ImageModem {
  readonly family: string;
  readonly devices: readonly string[];
  readonly package: { readonly sha: string; readonly size: number; readonly name: string; readonly crc32: string; readonly kind: ModemKind };
}

/** One distinct content of a source on one line, however many copies of it exist. */
export interface TimelineEntry {
  /** Unique within its line: `72.0`, or `50.1@2022-04-12` for an older content under a reused version. */
  readonly slug: string;
  readonly version: string;
  readonly copies: readonly [TimelineCopy, ...TimelineCopy[]];
  /** Only ever in betas. */
  readonly beta: boolean;
  /** Content differs from the previous entry on this line. */
  readonly changed: boolean;
}

export type TimelineCopy =
  | { readonly via: "image"; readonly releases: readonly string[]; readonly sha: string; readonly cid?: string }
  | {
      readonly via: "ota";
      readonly os: readonly string[];
      readonly url: string;
      readonly published?: string;
      readonly digest?: Digest;
      readonly archive: Archive;
    };

export interface Digest {
  readonly algorithm: "sha1" | "sha384";
  readonly hex: string;
}

/** An OTA file's copy in R2. Until it is archived the site fetches it from Apple. */
export type Archive =
  | { readonly state: "archived"; readonly sha: string; readonly cid: string }
  | { readonly state: "pending" }
  | { readonly state: "failed"; readonly error: string };

/** Where a reused version's older content first appeared; it names the version. */
export type FirstSeen =
  | { readonly via: "ota"; readonly published: string }
  | { readonly via: "image"; readonly release: string };

export const versionSlug = (version: string, firstSeen?: FirstSeen): string =>
  firstSeen === undefined ? version : `${version}@${firstSeen.via === "ota" ? firstSeen.published : firstSeen.release}`;

/** Apple: one line, plus one per model-specific bundle. Android: one line per device. */
export type Timeline =
  | {
      readonly family: "apple";
      readonly entries: readonly TimelineEntry[];
      readonly models: Readonly<Record<string, readonly TimelineEntry[]>>;
    }
  | {
      readonly family: "android";
      readonly devices: Readonly<Record<string, readonly TimelineEntry[]>>;
      /** sha -> the device whose URL is canonical for it. */
      readonly canonical: Readonly<Record<string, string>>;
    };

/** `/carriers/ios/Verizon_LTE/72.0`, `/carriers/android/tmobile_us/tokay/79000000034`. */
export const versionPath = (s: SourceRef, slug: string, line?: string): string =>
  [sourcePath(s), ...(line === undefined ? [] : [encodeURIComponent(line)]), encodeURIComponent(slug)].join("/");

/** A v1 path prefix and its v2 path. */
export interface LegacyRoute {
  readonly from: string;
  readonly to: string;
}

/** index/carriers/<id>.json. */
export interface CarrierDoc {
  readonly carrier: Carrier;
  readonly timelines: Readonly<Record<string, Timeline>>;
  /** sourceKey -> feature states at the head, per group of devices that agree. */
  readonly states: Readonly<Record<string, readonly DeviceStates[]>>;
}

export interface DeviceStates {
  /** "rest": every device no other group names. */
  readonly devices: readonly string[] | "rest";
  readonly slug: string;
  readonly line?: string;
  readonly states: Readonly<Record<string, FeatureState>>;
}
