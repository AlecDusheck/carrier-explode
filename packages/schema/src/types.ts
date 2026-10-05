/** The platform-neutral model. Each platform's mapper turns one decoded artifact into a Profile. */

import type { LabelSubject } from "./labels.ts";

/** Bump when a stored shape changes: norm/v<N>/ is keyed by it and rebuilt by `reindex`. */
export const PROFILE_SCHEMA = 2;

/** The OS that ships the settings. iPad and Watch bundles are separate files with their own versions. */
export const PLATFORMS = ["ios", "ipados", "watchos", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];
export type ApplePlatform = Exclude<Platform, "android">;
export const APPLE_PLATFORMS = ["ios", "ipados", "watchos"] as const satisfies readonly ApplePlatform[];
export const isPlatform = (value: string): value is Platform => PLATFORMS.some((p) => p === value);

export const DECODER_FAMILIES = ["apple", "android"] as const;
export type DecoderFamily = (typeof DECODER_FAMILIES)[number];
export const decoderFamily = (platform: Platform): DecoderFamily => (platform === "android" ? "android" : "apple");

/** The kinds of source each family ships: Android has no country bundles, only carriers and its defaults (default.pb, no_sim.pb). */
export const FAMILY_KINDS = {
  apple: ["carrier", "country", "default"],
  android: ["carrier", "default"],
} as const satisfies Record<DecoderFamily, readonly SourceKind[]>;

/** A code with the name pages show for it: a label's or the data's, else the code itself. */
export interface Named<C extends string = string> {
  readonly code: C;
  readonly name: string;
}

/** A device a feed lists: a Pixel by codename, an Apple device by product type (`iPhone18,1`). */
export interface Device {
  readonly code: string;
  readonly family: DecoderFamily;
  /** YYYY-MM (a Pixel's first build) or YYYY-MM-DD (an Apple release): the earliest the feed gives. */
  readonly released: string;
  /** Apple's board configs (`D93AP`), by which bundles name per-phone files; none for a Pixel. */
  readonly boards: readonly string[];
}

export const shipsKind = (platform: Platform, kind: SourceKind): boolean => FAMILY_KINDS[decoderFamily(platform)].some((k) => k === kind);

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

/** The segment after the platform in a list or source URL, one per kind of source: carriers, countries, defaults. */
export type KindSegment = (typeof KIND_SEGMENT)[SourceKind];
export const KIND_SEGMENTS: readonly KindSegment[] = SOURCE_KINDS.map((k) => KIND_SEGMENT[k]);

/** The kind of source a URL's kind segment names: KIND_SEGMENT the other way, which the type holds it to. */
export const SEGMENT_KIND = { carriers: "carrier", countries: "country", defaults: "default" } as const satisfies { readonly [K in SourceKind as KindSegment]: K };

/** `@` and `,` are legal in a path segment, and slugs and Apple models use them. */
const segment = (s: string): string => encodeURIComponent(s).replaceAll("%40", "@").replaceAll("%2C", ",");

/** `/ios/carriers`: one platform's list of one kind. */
export const listPath = (platform: Platform, kind: SourceKind): string => `/${platform}/${KIND_SEGMENT[kind]}`;

/** `/ios/carriers/Verizon_LTE`. */
export const sourcePath = (s: SourceRef): string => `${listPath(s.platform, s.kind)}/${segment(s.name)}`;

/** A version on a timeline. `line` is null on Apple's main line. */
export interface EntryRef {
  readonly line: string | null;
  readonly slug: string;
}

/** A line's head: Apple's main line is the source's own path. */
export const linePath = (s: SourceRef, line: string | null): string => (line === null ? sourcePath(s) : `${sourcePath(s)}/${segment(line)}`);

/** `/ios/carriers/Verizon_LTE/72.0`, `/ios/carriers/Verizon_LTE/iPhone7,1/23.1`, `/android/carriers/tmobile_us/tokay/79000000034`. */
export const versionPath = (s: SourceRef, at: EntryRef): string => `${linePath(s, at.line)}/${segment(at.slug)}`;

/** `/ios/builds`: one platform's builds. */
export const buildsPath = (platform: ReleasePlatform): string => `/${platform}/builds`;

/** `/ios/builds/24A437`, `/android/builds/CP3A.260905.009`. */
export const buildPath = (platform: ReleasePlatform, build: string): string => `${buildsPath(platform)}/${segment(build)}`;

/** `/ios/builds/24A437/Mav25`, `/android/builds/CP3A.260905.009/tokay`: a modem a build ships, by its page's name. */
export const modemPath = (platform: ReleasePlatform, build: string, modem: string): string => `${buildPath(platform, build)}/${segment(modem)}`;

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

export const APN_TYPES = [
  "default", "mms", "supl", "dun", "hipri", "fota", "ims", "cbs", "ia", "emergency",
  "xcap", "ut", "rcs", "vsim", "bip", "enterprise", "all",
] as const;
export type ApnType = (typeof APN_TYPES)[number];
export const IP_PROTOCOLS = ["ip", "ipv6", "ipv4v6", "ppp"] as const;
export type IpProtocol = (typeof IP_PROTOCOLS)[number];
export const APN_AUTHS = ["none", "pap", "chap", "pap_or_chap"] as const;
export type ApnAuth = (typeof APN_AUTHS)[number];

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

export const isJsonArray = (v: Json): v is readonly Json[] => Array.isArray(v);

/** available: a switch, or decided per plan or SIM. */
export const FEATURE_STATES = ["on", "available", "no"] as const;
export type FeatureState = (typeof FEATURE_STATES)[number];

/** `carrier.plist:Enable5GAutoByDefault`, `config:carrier_volte_available_bool`. */
export interface NativeRef {
  readonly path: string;
  readonly value: Json;
}

/** derived: computed from several settings. approx: the closest equivalent. */
export const FIDELITIES = ["exact", "derived", "approx"] as const;
export type Fidelity = (typeof FIDELITIES)[number];

interface Reading {
  readonly because: readonly NativeRef[];
  readonly fidelity: Fidelity;
}

/** A concept the platform cannot express is absent from Profile.concepts; `unset` is one this file leaves unset. */
export type ConceptValue =
  | ({ readonly kind: "state"; readonly state: FeatureState } & Reading)
  | ({ readonly kind: "value"; readonly value: Json } & Reading)
  | { readonly kind: "unset" };

/** Stored at norm/v<PROFILE_SCHEMA>/<sha>.json. Versionless: identical bytes ship under several versions. */
export interface Profile {
  readonly schema: typeof PROFILE_SCHEMA;
  readonly source: SourceRef;
  readonly sha: string;
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

type VariantSelector =
  | { readonly kind: "sim"; readonly sims: readonly SimMatcher[] }
  | { readonly kind: "device"; readonly devices: readonly string[] };

/** The concepts and APNs that differ when the selector applies. */
export interface ProfileVariant {
  readonly id: string;
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
export const RELEASE_PLATFORMS = ["ios", "android"] as const;
export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];
export const isReleasePlatform = (platform: string): platform is ReleasePlatform => RELEASE_PLATFORMS.some((p) => p === platform);

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

interface AndroidReleaseHeader extends ReleaseHeaderOf<"android"> {
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
  /** Modem carrier configurations, per group of devices sharing modem firmware. */
  readonly modems: readonly AndroidModem[];
}

/** `devices` newest first. */
export type ReleaseSummary = ReleaseHeader & {
  readonly sourceCount: number;
  /** The modem families its images ship (an iOS generation, an Android vendor), in the order its modems list them. */
  readonly modemFamilies: readonly Named[];
};

interface Artifact {
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

export const MODEM_KINDS = ["bbfw", "ftab"] as const;
export type ModemKind = (typeof MODEM_KINDS)[number];

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

/** One file Apple's OTA manifest lists, stored once its digests check, and kept after Apple drops it. */
export interface OtaFile {
  readonly url: string;
  readonly version: string;
  /** YYYY-MM-DD, when the URL says. */
  readonly published?: string;
  readonly digests: Digests;
  readonly sha: string;
  /** The bundle's content id, which re-zipping keeps. */
  readonly cid: string;
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
  | ({ readonly kind: "ota"; readonly os: readonly string[] } & Pick<OtaFile, "url" | "published" | "digests">);

/** One distinct content of a source on one line, however many copies of it exist. */
export interface TimelineEntry {
  /** Unique within its line. */
  readonly slug: string;
  readonly version: string;
  /** The bytes pages read. */
  readonly sha: string;
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

/** A version a release ships of a source: the entry on its line with a copy from that release. */
export interface ReleasedEntry extends EntryRef {
  readonly version: string;
}

/** How a release changed a source against its platform's previous release. */
export type ReleaseChange =
  | { readonly source: SourceKey; readonly kind: "added"; readonly to: ReleasedEntry }
  | { readonly source: SourceKey; readonly kind: "removed"; readonly from: ReleasedEntry }
  | { readonly source: SourceKey; readonly kind: "changed"; readonly from: ReleasedEntry; readonly to: ReleasedEntry };

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

/** Every carrier source's HeadStates. */
export type FeatureIndex = Readonly<Record<SourceKey, readonly HeadStates[]>>;

/** The feature states one phone of its platform's current release reads from one carrier source. */
export interface PhoneStates {
  readonly device: string;
  readonly source: SourceKey;
  readonly states: Readonly<Record<string, FeatureState>>;
}

/** One phone of its platform's current release, and whether it has a 5G radio as the index judges from its settings. */
export interface Phone extends Named {
  readonly platform: ReleasePlatform;
  readonly has5G: boolean;
}

/** The subjects whose names the index publishes by code; a carrier's name is in its own row. */
export const NAMED_SUBJECTS = ["device", "modem"] as const satisfies readonly LabelSubject[];
export type NamedSubject = (typeof NAMED_SUBJECTS)[number];

export interface Name extends Named {
  readonly subject: NamedSubject;
}

/** A carrier and its sources' timelines. */
export interface CarrierDoc {
  readonly carrier: Carrier;
  readonly sources: Readonly<Record<SourceKey, Timeline>>;
  /** Android modem configurations the carrier's SIMs select, newest release per device group. */
  readonly modems: readonly CarrierModem[];
}

/** A modem configuration a carrier's SIMs select, matched on ModemConfig.selection. */
export interface CarrierModem {
  readonly family: Named<ModemVendor>;
  readonly release: string;
  readonly firmware: string;
  /** Newest first. */
  readonly devices: readonly string[];
  readonly label: string;
  readonly sha: string;
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

/** Modem vendors whose carrier configuration is decoded; stored records name one as `family`. */
export const MODEM_VENDORS = ["qualcomm", "shannon", "mediatek"] as const;
export type ModemVendor = (typeof MODEM_VENDORS)[number];

/** How sure a decoded name or meaning is; "opaque" when the family publishes none. */
export const CERTAINTIES = ["high", "medium", "low", "opaque"] as const;
export type Certainty = (typeof CERTAINTIES)[number];

/** What separates a MediaTek item's description from the LID owner it leads with: `SBP · 1-bit field`. */
export const OWNER_SEPARATOR = " · ";

/** One setting a modem configuration carries: NV item, EFS file, Shannon key, MediaTek LID record. */
export interface ModemItem {
  /**
   * Native id: `nv:71527`, `efs:/nv/item_files/ims/qp_ims_sms_config`, `crc:5f3a91c2`, `lid:0x3c12/7`;
   * `pri:<part>` for an iPhone override file's own structures (`pri:nv-list`, `pri:schema`, `pri:setting/<name>`, `pri:9fa710`);
   * `tri:<record path>` for a `.der.tri` record (`tri:3/3`).
   */
  readonly id: string;
  readonly name: string | null;
  /** What the setting does, when the family's docs or the decoders say. */
  readonly description: string | null;
  readonly value: ModemValue;
  /** What this value means, when the decoder knows: an enum's name, the set bits' names, a decoded structure. */
  readonly label: string | null;
  readonly certainty: Certainty;
}

/** A setting's value, typed so views can render bytes, XML and text each their own way. */
export type ModemValue =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "xml"; readonly value: string }
  | { readonly kind: "bytes"; readonly hex: string }
  /** One flag per byte, set when non-zero: a Qualcomm CCM feature group. */
  | { readonly kind: "flags"; readonly values: readonly number[] }
  | { readonly kind: "list"; readonly values: readonly ModemValue[] }
  | { readonly kind: "fields"; readonly fields: Readonly<Record<string, ModemValue>> };

/** One band of a carrier-aggregation or dual-connectivity combination. */
export interface BandComponent {
  /** `B66`, `n41`. */
  readonly band: string;
  readonly dl: string;
  /** Absent: no uplink on this band. */
  readonly ul?: string;
  /** Present only when the family states it. */
  readonly dlLayers?: number;
  readonly bandwidthMhz?: number;
  readonly scsKhz?: number;
}

export type BandCombination = readonly BandComponent[];

/** One list of band combinations, stored apart at keys.combos(key) so a config stays small. */
export interface ComboSet {
  /** sha256 of the stored list: configs that carry the same list share it. */
  readonly key: string;
  /** What it was read from, each source with this exact list: `uecap/VZW_132493905285110.binarypb`, `LTE CA items`. */
  readonly sources: readonly string[];
  readonly count: number;
}

/** A carrier's configuration, loaded for the SIMs its rules select; or the firmware's own, loaded whatever the SIM. */
export const MODEM_SCOPES = ["carrier", "firmware"] as const;
export type ModemScope = (typeof MODEM_SCOPES)[number];

/** A configuration in one modem family, normalised. Stored at norm/v<PROFILE_SCHEMA>/<sha>.json like a Profile. */
export interface ModemConfig {
  readonly schema: typeof PROFILE_SCHEMA;
  readonly family: ModemVendor;
  readonly sha: string;
  /** The family's own name for it: `Commercial-TMO`, `us_tmo`, `SBP 12 (Verizon)`. */
  readonly label: string;
  readonly scope: ModemScope;
  /** SIM rules that select it that a SimMatcher can state. */
  readonly selection: readonly SimMatcher[];
  /** Header facts the native file states: `Written for: Qualcomm modem`, `PRI revision: 0.1.172`. */
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  /** What this configuration sets; values its base sets alone are the base's. */
  readonly items: readonly ModemItem[];
  /** The sha of the firmware's base layers it is built on, a ModemConfig of its own; null where the family layers none. */
  readonly base: string | null;
  readonly combos: readonly ComboSet[];
  /** Parts of the file that did not decode; the rest is still shown. */
  readonly errors: readonly string[];
}

/** The modem configurations a group of devices in one Android release carries. */
export interface AndroidModem {
  readonly family: ModemVendor;
  /** Firmware label: `g5400c-260604-…`, `MCFG-g7250-…`, `a900a-…`. */
  readonly firmware: string;
  readonly devices: readonly string[];
  /** Config label -> sha of its stored `android.modem-config` artifact (one ModemConfig each). */
  readonly configs: Readonly<Record<string, string>>;
}
