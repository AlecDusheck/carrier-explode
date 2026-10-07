/** The platform-neutral model. Each platform's mapper turns one decoded artifact into a Profile. */

/** Bump when a stored shape changes: norm/v<N>/ is keyed by it and rebuilt by `reindex`. */
export const PROFILE_SCHEMA = 7;

/** The OS that ships the settings. iPad and Watch bundles are separate files with their own versions; Pixel is `android`. */
export const PLATFORMS = ["ios", "ipados", "watchos", "android", "samsung"] as const;
export type Platform = (typeof PLATFORMS)[number];
export type ApplePlatform = Exclude<Platform, "android" | "samsung">;
export const APPLE_PLATFORMS = ["ios", "ipados", "watchos"] as const satisfies readonly ApplePlatform[];
export const isPlatform = (value: string): value is Platform => PLATFORMS.some((p) => p === value);

export const DECODER_FAMILIES = ["apple", "android", "samsung"] as const;
export type DecoderFamily = (typeof DECODER_FAMILIES)[number];
export const decoderFamily = (platform: Platform): DecoderFamily =>
	platform === "android" || platform === "samsung" ? platform : "apple";

/** The kinds of source each family ships: Android has no country bundles, only carriers and its defaults (default.pb, no_sim.pb); Samsung only carrier packs. */
export const FAMILY_KINDS = {
	apple: ["carrier", "country", "default"],
	android: ["carrier", "default"],
	samsung: ["carrier"],
} as const satisfies Record<DecoderFamily, readonly SourceKind[]>;

/** A device a feed lists: a Pixel by codename, an Apple device by product type (`iPhone18,1`), a Galaxy by model (`SM-S931B`). */
export interface Device {
	readonly code: string;
	readonly family: DecoderFamily;
	/** YYYY-MM (a Pixel's first build) or YYYY-MM-DD (an Apple release): the earliest the feed gives. */
	readonly released: string;
	/** Apple's board configs (`D93AP`), by which bundles name per-phone files; none for a Pixel. */
	readonly boards: readonly string[];
}

export const shipsKind = (platform: Platform, kind: SourceKind): boolean =>
	FAMILY_KINDS[decoderFamily(platform)].some((k) => k === kind);

/** `default`: Android's no_sim.pb, and default.pb, which every carrier's file is read over. */
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

export const sourceKey = <P extends Platform>(s: SourceRef<P>): SourceKey<P> =>
	`${s.platform}:${s.kind}:${s.name}`;

const SOURCE_KEY = /^([a-z]+):([a-z]+):(.+)$/;

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

export const KIND_SEGMENT = {
	carrier: "carriers",
	country: "countries",
	default: "defaults",
} as const satisfies Record<SourceKind, string>;

/** The segment after the platform in a list or source URL, one per kind of source: carriers, countries, defaults. */
export type KindSegment = (typeof KIND_SEGMENT)[SourceKind];
export const KIND_SEGMENTS: readonly KindSegment[] = SOURCE_KINDS.map((k) => KIND_SEGMENT[k]);

/** The kind of source a URL's kind segment names: KIND_SEGMENT the other way, which the type holds it to. */
export const SEGMENT_KIND = {
	carriers: "carrier",
	countries: "country",
	defaults: "default",
} as const satisfies { readonly [K in SourceKind as KindSegment]: K };

/** `@` and `,` are legal in a path segment, and slugs and Apple models use them. */
const segment = (s: string): string => encodeURIComponent(s).replaceAll("%40", "@").replaceAll("%2C", ",");

/** `/ios/carriers`: one platform's list of one kind. */
export const listPath = (platform: Platform, kind: SourceKind): string =>
	`/${platform}/${KIND_SEGMENT[kind]}`;

/** `/ios/carriers/Verizon_LTE`. */
export const sourcePath = (s: SourceRef): string => `${listPath(s.platform, s.kind)}/${segment(s.name)}`;

/** A device's code, which is also a line: an iPhone's product type (`iPhone18,1`), a Pixel's codename, a Galaxy's model. */
export const DEVICE_CODE = /^[\w,-]{1,40}$/;

/** A release id: an iOS build (`24A437`), a Pixel build id (`CP3A.260905.009`), a Galaxy build. */
export const RELEASE_ID = /^[\w.]{3,40}$/;

/** An ISO 3166 alpha-2 country code, as the index writes it (`us`). */
export const ISO_CODE = /^[a-z]{2}$/;

/** Apple's main line: the bundle every model loads unless the manifest names a file for it. */
export const MAIN_LINE = "";

/** A version on a timeline: an Android codename's or an Apple model's line, or MAIN_LINE. */
export interface EntryRef {
	readonly line: string;
	readonly slug: string;
}

/** A line's head: Apple's main line is the source's own path. */
export const linePath = (s: SourceRef, line: string): string =>
	line === MAIN_LINE ? sourcePath(s) : `${sourcePath(s)}/${segment(line)}`;

/** `/ios/carriers/Verizon_LTE/72.0`, `/ios/carriers/Verizon_LTE/iPhone7,1/23.1`, `/android/carriers/tmobile_us/tokay/79000000034`. */
export const versionPath = (s: SourceRef, at: EntryRef): string =>
	`${linePath(s, at.line)}/${segment(at.slug)}`;

/** `/ios/builds`: one platform's builds. */
export const buildsPath = (platform: ReleasePlatform): string => `/${platform}/builds`;

/** `/ios/builds/24A437`, `/android/builds/CP3A.260905.009`. */
export const buildPath = (platform: ReleasePlatform, build: string): string =>
	`${buildsPath(platform)}/${segment(build)}`;

/** `/ios/builds/24A437/Mav25`, `/android/builds/CP3A.260905.009/tokay`: a modem a build ships, by its page's name. */
export const modemPath = (platform: ReleasePlatform, build: string, modem: string): string =>
	`${buildPath(platform, build)}/${segment(modem)}`;

/** Where a reused version's older content first appeared; it names the version. */
export type FirstSeen =
	| { readonly kind: "ota"; readonly day: string }
	| { readonly kind: "image"; readonly build: string };

/** `72.0`, `50.1@2022-04-12`, `64.1@23a341`. A version starts with a digit, so no line or tab name parses as one. */
const VERSION_SLUG = /^(\d[\w.-]*)(?:@(?:(\d{4}-\d{2}-\d{2})|([\da-z][\da-z.]*)))?$/;

export const versionSlug = (version: string, firstSeen?: FirstSeen): string =>
	firstSeen === undefined
		? version
		: `${version}@${firstSeen.kind === "ota" ? firstSeen.day : firstSeen.build.toLowerCase()}`;

export const isVersionSlug = (s: string): boolean => VERSION_SLUG.test(s);

export function parseVersionSlug(
	slug: string,
): { readonly version: string; readonly firstSeen?: FirstSeen } | undefined {
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

const QUALIFIERS = [
	"gid1",
	"gid2",
	"spn",
	"imsiPrefix",
	"iccidPrefix",
] as const satisfies readonly (keyof SimMatcher)[];

/** `310260`, `310260|gid1=6D`: equal rules give equal keys. */
export function matcherKey(m: SimMatcher): string {
	return [
		m.mccmnc,
		...QUALIFIERS.flatMap((q) => {
			const v = m[q];
			return v === undefined ? [] : [`${q}=${encodeURIComponent(v)}`];
		}),
	].join("|");
}

/**
 * What a routing table sends to a source: a PLMN rule, or one of the keys Apple's manifest also routes by, an ICCID
 * prefix alone (MobileDeviceCarriers) or a carrier ID (MobileDeviceCarriersByCarrierID, `310VZW`).
 */
export type SimRule =
	| { readonly by: "plmn"; readonly sim: SimMatcher }
	| { readonly by: "iccid"; readonly prefix: string }
	| { readonly by: "carrierId"; readonly id: string };

/** A rule's key in the index: a PLMN rule's matcherKey, else `iccid:8901150`, `carrierId:310VZW`, which no matcherKey starts with. */
export function ruleKey(r: SimRule): string {
	switch (r.by) {
		case "plmn":
			return matcherKey(r.sim);
		case "iccid":
			return `iccid:${r.prefix}`;
		case "carrierId":
			return `carrierId:${r.id}`;
	}
}

const isQualifier = (q: string): q is (typeof QUALIFIERS)[number] => QUALIFIERS.some((k) => k === q);

/** ruleKey the other way, for a key the index stores; undefined for anything else. */
export function parseRuleKey(key: string): SimRule | undefined {
	const [, by, value] = /^(iccid|carrierId):(.+)$/.exec(key) ?? [];
	if (by === "iccid" && value !== undefined) return { by, prefix: value };
	if (by === "carrierId" && value !== undefined) return { by, id: value };
	const [mccmnc = "", ...parts] = key.split("|");
	if (!/^\d{5,6}$/.test(mccmnc)) return undefined;
	const sim: Partial<Record<(typeof QUALIFIERS)[number], string>> = {};
	for (const part of parts) {
		const [, q = "", v] = /^([^=]+)=(.*)$/.exec(part) ?? [];
		if (!isQualifier(q) || v === undefined || sim[q] !== undefined) return undefined;
		sim[q] = decodeURIComponent(v);
	}
	const rule: SimRule = { by: "plmn", sim: { mccmnc, ...sim } };
	return ruleKey(rule) === key ? rule : undefined;
}

export const APN_TYPES = [
	"default",
	"mms",
	"supl",
	"dun",
	"hipri",
	"fota",
	"ims",
	"cbs",
	"ia",
	"emergency",
	"xcap",
	"ut",
	"rcs",
	"vsim",
	"bip",
	"enterprise",
	"all",
] as const;
export type ApnType = (typeof APN_TYPES)[number];
export const IP_PROTOCOLS = ["ip", "ipv6", "ipv4v6", "ppp", "non-ip", "unstructured"] as const;
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

/**
 * Where a phone reads what its carrier leaves unset of a feature: its Pixel build's default.pb, else AOSP's CarrierConfig
 * defaults; a Galaxy's IMS service's defaults under its operator's entry.
 */
export const DEFAULT_LAYERS = ["default.pb", "aosp", "imsservice"] as const;
export type DefaultLayer = (typeof DEFAULT_LAYERS)[number];

/** What a layer decides of a state: all of it, or only what the carrier's own settings leave open (it offers a feature; the layer says whether it starts on). */
export const DEFAULTED_PARTS = ["all", "rest"] as const;
export type DefaultedPart = (typeof DEFAULTED_PARTS)[number];

export interface Defaulted {
	readonly layer: DefaultLayer;
	readonly part: DefaultedPart;
}

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
	/** An override file's boards, as its name lists them (`D93`): which phone each is, is the device records' to say. */
	| { readonly kind: "board"; readonly boards: readonly string[] };

/** The concepts and APNs that differ when the selector applies. */
export interface ProfileVariant {
	readonly id: string;
	readonly when: VariantSelector;
	readonly concepts: Readonly<Record<string, ConceptValue>>;
	readonly apns: readonly Apn[];
}

/** OS images are read for iPhone, Pixel and Galaxy; iPad and Watch bundles come from the OTA feed. */
export const RELEASE_PLATFORMS = ["ios", "android", "samsung"] as const;
export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];
export const isReleasePlatform = (platform: string): platform is ReleasePlatform =>
	RELEASE_PLATFORMS.some((p) => p === platform);

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

/** One Galaxy firmware: `id` is its CSC build (`S931BOXMCCZH1`), `version` its Android release, `released` its build day. */
type SamsungReleaseHeader = ReleaseHeaderOf<"samsung">;

export type ReleaseHeader = AppleReleaseHeader | AndroidReleaseHeader | SamsungReleaseHeader;

/** Stored at releases/<platform>/<id>.json. */
export type Release = AppleRelease | AndroidRelease | SamsungRelease;

/** Pixel and Galaxy: releases whose artifacts and modems each name the devices they are for. */
export const DEVICE_RELEASE_PLATFORMS = ["android", "samsung"] as const satisfies readonly ReleasePlatform[];
export type DeviceReleasePlatform = (typeof DEVICE_RELEASE_PLATFORMS)[number];
export type DeviceRelease = Extract<Release, { readonly platform: DeviceReleasePlatform }>;
export const isDeviceReleasePlatform = (platform: string): platform is DeviceReleasePlatform =>
	DEVICE_RELEASE_PLATFORMS.some((p) => p === platform);
export const isDeviceRelease = (r: Release): r is DeviceRelease => isDeviceReleasePlatform(r.platform);

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

/** A firmware is one model's, and each carrier pack one artifact: the shape Android releases share, one device each. */
export interface SamsungRelease extends SamsungReleaseHeader {
	readonly sources: Readonly<Record<SourceKey<"samsung">, readonly AndroidArtifact[]>>;
	/** The firmware's modem (its CP member), as a Pixel release lists a device group's; none for an Exynos's, which is encrypted. */
	readonly modems: readonly AndroidModem[];
}

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

/** One file Google's Pixel carrier settings update service lists, stored once its .sha256 checks, and kept after Google drops it. */
export interface PixelOtaFile {
	readonly url: string;
	readonly version: string;
	/** YYYY-MM-DD: the file's own last_updated. */
	readonly published?: string;
	readonly sha: string;
	/** The carrier_list.pb its SIM rules are read from: the one its answer lists, else its train's newest image's. */
	readonly carrierList: string;
	readonly listings: readonly [PixelOtaListing, ...PixelOtaListing[]];
}

/** One answer of the service that lists a file: a Pixel on a build train. */
export interface PixelOtaListing {
	readonly source: SourceKey<"android">;
	readonly device: string;
	/** The first four characters of a build id, which is all the service reads: `CP3A`. */
	readonly train: string;
	readonly firstSeenAt: string;
	readonly lastSeenAt: string;
	readonly live: boolean;
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
	 * Native id: `nv:71527`, `efs:/nv/item_files/ims/qp_ims_sms_config`, `crc:5f3a91c2`, `lid:0x3c12/7`; an iPhone
	 * override file's own structures as `pri:<part>` (`pri:nv-list`), a `.der.tri` record as `tri:<record path>` (`tri:3/3`).
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
