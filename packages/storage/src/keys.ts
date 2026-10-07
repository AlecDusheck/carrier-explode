/** Every key of the carrier-explode-ingest bucket. Nothing else spells a key out. */

import { PROFILE_SCHEMA, type ReleasePlatform } from "@carrier-explode/schema/types";

/** What a release record is keyed by: a Pixel build is stored per device, so each device step writes its own. */
export type ReleaseId = {
	readonly [P in ReleasePlatform]: P extends "android"
		? readonly [build: string, device: string]
		: readonly [build: string];
};

export type ReleaseKey = {
	readonly [P in ReleasePlatform]: { readonly platform: P; readonly id: ReleaseId[P] };
}[ReleasePlatform];

export const OTA_FEEDS = ["apple", "pixel"] as const;
export type OtaFeed = (typeof OTA_FEEDS)[number];

const OBJ = "obj/";
const NORM = `norm/v${PROFILE_SCHEMA}/`;
const RELEASES = "releases/";
const TMP = "tmp/";
const JSON_EXT = ".json";

const releasePrefix = (platform: ReleasePlatform): string => `${RELEASES}${platform}/`;

export const keys = {
	/** Listed by reindex. */
	objPrefix: (): string => OBJ,
	obj: (sha256: string): string => `${OBJ}${sha256}`,
	/** The sha256 an obj/ key names; undefined for any other key. */
	shaOfObj: (key: string): string | undefined =>
		key.startsWith(OBJ) && key.length > OBJ.length ? key.slice(OBJ.length) : undefined,
	/** Listed by reindex. */
	normPrefix: (): string => NORM,
	/** A Profile or ModemConfig, read from its artifact's bytes alone. */
	norm: (sha: string): string => `${NORM}${sha}${JSON_EXT}`,
	/** A band-combination list, named by its ComboSet.key. */
	combos: (key: string): string => `${NORM}combos/${key}${JSON_EXT}`,
	/** `schema` is decode-ios's MODEM_SUMMARY_SCHEMA, which storage may not import. */
	basebandSummary: (schema: number, sha: string): string => `decoded/baseband/v${schema}/${sha}${JSON_EXT}`,
	/** Listed by planning: a unit is held once its release record is. */
	releasePrefix,
	release: <P extends ReleasePlatform>(platform: P, ...id: ReleaseId[P]): string =>
		`${releasePrefix(platform)}${id.join("/")}${JSON_EXT}`,
	/** Apple's OTA carrier manifest, as fetched. */
	appleOtaManifest: (sha1: string): string => `ota/apple/manifests/${sha1}.plist`,
	/** An answer set of Google's Pixel carrier-settings update service. */
	pixelOtaSnapshot: (sha1: string): string => `ota/pixel/snapshots/${sha1}${JSON_EXT}`,
	/** The OtaPointer to the snapshot a feed was last planned from. */
	otaCurrent: (feed: OtaFeed): string => `ota/${feed}/current${JSON_EXT}`,
	/** Listed by planning: a file is held once its record is. */
	otaFilesPrefix: (feed: OtaFeed): string => `ota/${feed}/files/`,
	otaFile: async (feed: OtaFeed, url: string): Promise<string> =>
		`ota/${feed}/files/${await urlHash(url)}${JSON_EXT}`,
	/** What FUS and its AP member said of a Galaxy firmware a check read: fixed once built, so FUS is asked once. */
	galaxyFirmware: (build: string): string => `firmware/samsung/${build}${JSON_EXT}`,
	/** The daily archive of everything the API answers; the site serves it at this same path. */
	dataset: (): string => "datasets/carrier-explode.zip",
	/** Swept by the bucket's lifecycle rule (lifecycle.json). */
	tmpPrefix: (instance: string): string => `${TMP}${instance}/`,
	tmp: (instance: string, name: string): string => `${TMP}${instance}/${name}`,
} as const;

/** The release a listed releases/ key names; undefined for any other key. */
export function releaseOfKey(key: string): ReleaseKey | undefined {
	if (!key.startsWith(RELEASES) || !key.endsWith(JSON_EXT)) return undefined;
	const [platform, ...id] = key.slice(RELEASES.length, -JSON_EXT.length).split("/");
	if (id.some((part) => part === "")) return undefined;
	const [first, second, ...rest] = id;
	if (first === undefined || rest.length > 0) return undefined;
	switch (platform) {
		case "ios":
		case "samsung":
			return second === undefined ? { platform, id: [first] } : undefined;
		case "android":
			return second === undefined ? undefined : { platform, id: [first, second] };
		default:
			return undefined;
	}
}

/** Lower-case hex SHA-256 of the URL: a file's key, whatever characters its URL holds. */
async function urlHash(url: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)));
	return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
