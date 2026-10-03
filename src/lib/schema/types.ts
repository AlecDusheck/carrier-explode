/** The platform-neutral model. Each platform's mapper turns one decoded artifact into a Profile. */

/** Bump when a stored shape changes: norm/v<N>/ is keyed by it and rebuilt by `reindex`. */
export const PROFILE_SCHEMA = 1;

/** The OS that ships the settings. iPad and Watch bundles are separate files with their own versions. */
export const PLATFORMS = ["ios", "ipados", "watchos", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];
export type ApplePlatform = Exclude<Platform, "android">;
export const isPlatform = (value: string): value is Platform => PLATFORMS.some((p) => p === value);

export type DecoderFamily = "apple" | "android";
export const decoderFamily = (platform: Platform): DecoderFamily => (platform === "android" ? "android" : "apple");

/** `default`: Android's default.pb and no_sim.pb, which apply when no carrier matches. */
export const SOURCE_KINDS = ["carrier", "country", "default"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
const isSourceKind = (value: string): value is SourceKind => SOURCE_KINDS.some((k) => k === value);

/** A named thing a platform ships settings under; `name` is native (`TMobile_us`, `tmobile_us`). */
export interface SourceRef<P extends Platform = Platform> {
  readonly platform: P;
  readonly kind: SourceKind;
  readonly name: string;
}

/** `ios:carrier:TMobile_us`: how stored records name a source. */
export type SourceKey<P extends Platform = Platform> = `${P}:${SourceKind}:${string}`;

export const sourceKey = <P extends Platform>(s: SourceRef<P>): SourceKey<P> => `${s.platform}:${s.kind}:${s.name}`;

const SOURCE_KEY = /^([a-z]+):([a-z]+):(.+)$/;

/** Validates untrusted input. */
export function parseSourceKey(key: string): SourceRef | undefined {
  const [, platform = "", kind = "", name = ""] = SOURCE_KEY.exec(key) ?? [];
  return isPlatform(platform) && isSourceKind(kind) ? { platform, kind, name } : undefined;
}

export const isSourceKey = (key: string): key is SourceKey => parseSourceKey(key) !== undefined;

export function sourceOf(key: SourceKey): SourceRef {
  const ref = parseSourceKey(key);
  if (ref === undefined) throw new Error(`${key}: not a source key`);
  return ref;
}

export const KIND_SEGMENT = { carrier: "carriers", country: "countries", default: "defaults" } as const satisfies Record<SourceKind, string>;

/** `@` and `,` are legal in a path segment, and slugs and Apple models use them. */
const segment = (s: string): string => encodeURIComponent(s).replaceAll("%40", "@").replaceAll("%2C", ",");

/** `/carriers/ios/Verizon_LTE`. */
export const sourcePath = (s: SourceRef): string => `/${KIND_SEGMENT[s.kind]}/${s.platform}/${segment(s.name)}`;

/** A version on a timeline. `line` is null on Apple's main line. */
export interface EntryRef {
  readonly line: string | null;
  readonly slug: string;
}

/** `/carriers/ios/Verizon_LTE/72.0`, `/carriers/ios/Verizon_LTE/iPhone7,1/23.1`, `/carriers/android/tmobile_us/tokay/79000000034`. */
export const versionPath = (s: SourceRef, at: EntryRef): string =>
  [sourcePath(s), ...(at.line === null ? [] : [segment(at.line)]), segment(at.slug)].join("/");

/** Where a reused version's older content first appeared; it names the version. */
export type FirstSeen =
  | { readonly kind: "ota"; readonly day: string }
  | { readonly kind: "image"; readonly build: string };

/** `72.0`, `50.1@2022-04-12`, `64.1@23a341`. A version starts with a digit, so no line or tab name parses as one. */
const VERSION_SLUG = /^(\d[\w.-]*)(?:@(?:(\d{4}-\d{2}-\d{2})|([\da-z][\da-z.]*)))?$/;

export const versionSlug = (version: string, firstSeen?: FirstSeen): string =>
  firstSeen === undefined ? version : `${version}@${firstSeen.kind === "ota" ? firstSeen.day : firstSeen.build.toLowerCase()}`;

export const isVersionSlug = (s: string): boolean => VERSION_SLUG.test(s);

export function parseVersionSlug(slug: string): { readonly version: string; readonly firstSeen?: FirstSeen } | undefined {
  const m = VERSION_SLUG.exec(slug);
  if (m === null) return undefined;
  const [, version = "", day, build] = m;
  if (day !== undefined) return { version, firstSeen: { kind: "ota", day } };
  if (build !== undefined) return { version, firstSeen: { kind: "image", build } };
  return { version };
}

/** A SIM rule: every present qualifier must match. Apple combines qualifiers; Android uses at most one. */
export interface SimMatcher {
  /** 5–6 digits. */
  readonly mccmnc: string;
  /** Upper-case hex prefix. */
  readonly gid1?: string;
  readonly gid2?: string;
  readonly spn?: string;
  readonly imsiPrefix?: string;
  readonly iccidPrefix?: string;
}

const QUALIFIERS = ["gid1", "gid2", "spn", "imsiPrefix", "iccidPrefix"] as const satisfies readonly (keyof SimMatcher)[];

/** `310260`, `310260|gid1=6D`: equal rules give equal keys. */
export function matcherKey(m: SimMatcher): string {
  return [m.mccmnc, ...QUALIFIERS.flatMap((q) => { const v = m[q]; return v === undefined ? [] : [`${q}=${encodeURIComponent(v)}`]; })].join("|");
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
  /** Absent: any radio technology. */
  readonly bearers?: readonly string[];
  /** `carrier.plist:apns[0]`, `apns[3]`. */
  readonly path: string;
}

export type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };

/** available: a switch, or decided per plan or SIM. */
export type FeatureState = "on" | "available" | "no";

/** `carrier.plist:Enable5GAutoByDefault`, `config:carrier_volte_available_bool`. */
export interface NativeRef {
  readonly path: string;
  readonly value: Json;
}

/** derived: computed from several settings. approx: the closest equivalent. */
export type Fidelity = "exact" | "derived" | "approx";

interface Reading {
  readonly because: readonly NativeRef[];
  readonly fidelity: Fidelity;
}

/** A concept the platform cannot express is absent from Profile.concepts; `unset` is one this file leaves unset. */
export type ConceptValue =
  | ({ readonly kind: "state"; readonly state: FeatureState } & Reading)
  | ({ readonly kind: "value"; readonly value: Json } & Reading)
  | { readonly kind: "unset" };

/** Stored at norm/v<PROFILE_SCHEMA>/<sha>.json. */
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
  /** By concept id. */
  readonly concepts: Readonly<Record<string, ConceptValue>>;
  /** Every native leaf: `<file>:<path>` (Apple), `config:<key>`, `apns[<i>].<field>` (Android). */
  readonly raw: Readonly<Record<string, Json>>;
  /** Apple's MVNO configurations and per-phone override files; empty on Android. */
  readonly variants: readonly ProfileVariant[];
}

export type VariantSelector =
  | { readonly kind: "sim"; readonly sims: readonly SimMatcher[] }
  | { readonly kind: "device"; readonly devices: readonly string[] };

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
  readonly members: readonly SourceKey[];
  readonly sims: readonly SimMatcher[];
  readonly links: readonly CarrierLink[];
}

/** `shared`: the matcherKeys both sources claim. */
export type CarrierLink =
  | { readonly kind: "sims"; readonly between: readonly [SourceKey, SourceKey]; readonly shared: readonly string[] }
  | { readonly kind: "manual"; readonly between: readonly [SourceKey, SourceKey] };

/** OS images are read for iPhone and Pixel only; iPad and Watch bundles come from the OTA feed. */
export type ReleasePlatform = "ios" | "android";

interface ReleaseHeaderOf<P extends ReleasePlatform> {
  readonly platform: P;
  /** `23C55`, `CP3A.260905.009`. */
  readonly id: string;
  readonly version: string;
  /** YYYY-MM-DD. */
  readonly released?: string;
  readonly devices: readonly string[];
  readonly extractedAt: string;
}

export interface AppleReleaseHeader extends ReleaseHeaderOf<"ios"> {
  /** `27.2 beta 2`. */
  readonly label: string;
  readonly prerelease: boolean;
}

export interface AndroidReleaseHeader extends ReleaseHeaderOf<"android"> {
  /** YYYY-MM. */
  readonly patch: string;
}

export type ReleaseHeader = AppleReleaseHeader | AndroidReleaseHeader;

/** Stored at releases/<platform>/<id>.json. */
export type Release = AppleRelease | AndroidRelease;

export interface AppleRelease extends AppleReleaseHeader {
  readonly sources: Readonly<Record<SourceKey<"ios">, AppleArtifact>>;
  readonly modems: readonly ImageModem[];
}

export interface AndroidRelease extends AndroidReleaseHeader {
  /** Devices that carry identical files share one artifact. */
  readonly sources: Readonly<Record<SourceKey<"android">, readonly AndroidArtifact[]>>;
  /** sha of carrier_list.pb, identical across devices. */
  readonly carrierList: string;
}

export type ReleaseSummary = ReleaseHeader & { readonly sourceCount: number };

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

export interface ModemPackage {
  readonly kind: ModemKind;
  readonly name: string;
  readonly sha: string;
  readonly size: number;
  readonly crc32: string;
}

export interface ImageModem {
  readonly family: string;
  readonly devices: readonly string[];
  readonly package: ModemPackage;
}

/** Apple's manifest states a sha1, a sha384, both or neither. */
export interface Digests {
  readonly sha1?: string;
  readonly sha384?: string;
}

/** Until a file is archived the site fetches it from Apple. */
export type Archive =
  | { readonly kind: "archived"; readonly sha: string; readonly cid: string }
  | { readonly kind: "pending" }
  | { readonly kind: "failed"; readonly error: string; readonly at: string };

/** One file Apple's OTA manifest lists, kept after Apple drops it. */
export interface OtaFile {
  readonly url: string;
  readonly version: string;
  /** YYYY-MM-DD, when the URL says. */
  readonly published?: string;
  readonly digests: Digests;
  readonly archive: Archive;
  readonly listings: readonly [OtaListing, ...OtaListing[]];
}

/** One manifest entry for a file. */
export interface OtaListing {
  readonly source: SourceKey<ApplePlatform>;
  /** The OS key, or a country bundle's minimum OS; null when the manifest gives neither. */
  readonly os: string | null;
  /** Model-specific bundles only: `iPhone7,1`. */
  readonly model?: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly live: boolean;
}

export type TimelineCopy =
  | { readonly kind: "image"; readonly releases: readonly string[]; readonly sha: string }
  | ({ readonly kind: "ota"; readonly os: readonly string[] } & Pick<OtaFile, "url" | "published" | "digests" | "archive">);

/** One distinct content of a source on one line, however many copies of it exist. */
export interface TimelineEntry {
  /** Unique within its line. */
  readonly slug: string;
  readonly version: string;
  /** The bytes pages read; null while every copy is an unarchived OTA file. */
  readonly sha: string | null;
  readonly copies: readonly [TimelineCopy, ...TimelineCopy[]];
  /** Only ever in betas. */
  readonly beta: boolean;
  /** Content differs from the next older entry on this line. */
  readonly changed: boolean;
}

/** Newest first. */
export type Line = readonly TimelineEntry[];

export type Timeline =
  | { readonly kind: "apple"; readonly main: Line; readonly models: Readonly<Record<string, Line>> }
  | {
      readonly kind: "android";
      readonly devices: Readonly<Record<string, Line>>;
      /** sha -> the device whose URL is canonical for it. */
      readonly canonical: Readonly<Record<string, string>>;
    };

/** A v1 path prefix and its v2 path. */
export interface LegacyRoute {
  readonly from: string;
  readonly to: string;
}

export type DeviceGroup =
  | { readonly kind: "listed"; readonly devices: readonly [string, ...string[]] }
  | { readonly kind: "rest" };

/** Feature states at a line's head, for a group of devices that agree. */
export interface HeadStates {
  readonly devices: DeviceGroup;
  readonly at: EntryRef;
  readonly states: Readonly<Record<string, FeatureState>>;
}

export interface SourceDoc {
  readonly timeline: Timeline;
  readonly head: readonly HeadStates[];
}

/** index/carriers/<id>.json. */
export interface CarrierDoc {
  readonly carrier: Carrier;
  readonly sources: Readonly<Record<SourceKey, SourceDoc>>;
}

export interface CarrierSummary extends Pick<Carrier, "id" | "name" | "iso" | "members"> {
  readonly platforms: readonly Platform[];
  /** YYYY-MM-DD of the newest change on any platform. */
  readonly updated?: string;
}

export interface CountrySummary {
  readonly iso: string;
  readonly name: string;
  readonly sources: readonly SourceKey[];
  readonly carriers: readonly string[];
}
