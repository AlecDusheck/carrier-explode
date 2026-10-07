/** What a reindex normalizes: every artifact the records it targets name that lacks its norm/ object, with the source each is read as. */

import * as v from "valibot";

import { otaFilesSchema, pixelOtaFilesSchema, sourceKeySchema } from "@carrier-explode/schema/records";
import { RELEASE_PLATFORMS, type Release, type ReleasePlatform } from "@carrier-explode/schema/types";
import { keys, OTA_FEEDS, releaseOfKey, type OtaFeed } from "@carrier-explode/storage";
import { DataError } from "./errors.ts";
import { chunks } from "./fan-out.ts";
import type { NormArtifact } from "./normalize.ts";
import type { PipelineParams } from "./pipelines.ts";
import { readHeld, readRelease } from "./records.ts";
import { CONNECTIONS, listing, readJson } from "./store.ts";

type ReindexTarget = PipelineParams<"reindex">["target"];
type RecordTarget = Exclude<ReindexTarget, { readonly kind: "all" }>;

/** Each artifact a record lists under each of its sources. */
const sourced = (
	kind: NormArtifact["kind"],
	sources: Readonly<Record<string, { readonly sha: string } | ReadonlyArray<{ readonly sha: string }>>>,
): NormArtifact[] =>
	Object.entries(sources).flatMap(([key, held]) =>
		[held].flat().map((a) => ({ kind, sha: a.sha, source: v.parse(sourceKeySchema, key) })),
	);

const modemConfigs = (r: Extract<Release, { readonly platform: "android" | "samsung" }>): NormArtifact[] =>
	[...new Set(r.modems.flatMap((m) => Object.values(m.configs)))].map((sha) => ({
		kind: "android.modem-config",
		sha,
		source: null,
	}));

function releaseArtifacts(r: Release): NormArtifact[] {
	switch (r.platform) {
		case "ios":
			return sourced("apple.ipcc", r.sources);
		case "android":
			return [...sourced("android.carrier-settings", r.sources), ...modemConfigs(r)];
		case "samsung":
			return [...sourced("samsung.omc", r.sources), ...modemConfigs(r)];
	}
}

/** An OTA file is normalized as the first source, by key, it is listed for, as its file step chose. */
async function otaArtifact(bucket: R2Bucket, feed: OtaFeed, record: string): Promise<NormArtifact> {
	const json = await readJson(bucket, record);
	const { url, sha, listings } =
		feed === "apple" ? v.parse(otaFilesSchema.item, json) : v.parse(pixelOtaFilesSchema.item, json);
	const [source] = listings.map((l) => l.source).toSorted();
	if (source === undefined) throw new Error(`${url}: listed for no source`);
	return { kind: feed === "apple" ? "apple.ipcc" : "android.carrier-settings", sha, source };
}

const recordArtifacts = async (bucket: R2Bucket, target: RecordTarget): Promise<NormArtifact[]> =>
	target.kind === "ota"
		? [await otaArtifact(bucket, target.feed, await keys.otaFile(target.feed, target.url))]
		: releaseArtifacts(await readRelease(bucket, target.release));

/** A held record's artifacts. */
async function heldArtifacts(bucket: R2Bucket, record: string): Promise<NormArtifact[]> {
	const release = releaseOfKey(record);
	return release === undefined
		? [await otaArtifact(bucket, heldOtaFeed(record), record)]
		: releaseArtifacts(await readRelease(bucket, release));
}

/** Of every held record, each sha once (its norm/ object is keyed by it alone), by kind, so a step takes one kind. */
async function allArtifacts(
	bucket: R2Bucket,
	platform: ReleasePlatform | undefined,
): Promise<NormArtifact[]> {
	const records: string[] = [];
	for await (const record of heldRecords(bucket, platform, null)) records.push(record);
	// Release records first: a sha one shares with an OTA file is read as the release's source.
	const releasesFirst = records.toSorted(
		(a, b) => Number(releaseOfKey(a) === undefined) - Number(releaseOfKey(b) === undefined),
	);
	const bySha = new Map<string, NormArtifact>();
	for (const batch of chunks(releasesFirst, CONNECTIONS))
		for (const artifacts of await Promise.all(batch.map((r) => heldArtifacts(bucket, r))))
			for (const a of artifacts) if (!bySha.has(a.sha)) bySha.set(a.sha, a);
	return [...bySha.values()].toSorted((a, b) => a.kind.localeCompare(b.kind) || a.sha.localeCompare(b.sha));
}

/** Every norm/ object's key, the band-combination lists' left out by the delimiter. */
async function heldNorms(bucket: R2Bucket): Promise<ReadonlySet<string>> {
	const held = new Set<string>();
	for await (const { key } of listing(bucket, { prefix: keys.normPrefix(), delimiter: "/" })) held.add(key);
	return held;
}

/**
 * The target's artifacts not yet normalized. A norm/ object is never rewritten, so normalizing a held one again would
 * write nothing; a modem configuration's is written after its base and combinations.
 */
export async function reindexArtifacts(bucket: R2Bucket, target: ReindexTarget): Promise<NormArtifact[]> {
	const [artifacts, held] = await Promise.all([
		target.kind === "all" ? allArtifacts(bucket, target.platform) : recordArtifacts(bucket, target),
		heldNorms(bucket),
	]);
	return artifacts.filter((a) => !held.has(keys.norm(a.sha)));
}

/** The platforms a reindex of all covers. */
export const reindexPlatforms = (platform: ReleasePlatform | undefined): readonly ReleasePlatform[] =>
	platform === undefined ? RELEASE_PLATFORMS : [platform];

/** The release platform an OTA feed's files are indexed with. */
export const FEED_PLATFORM = { apple: "ios", pixel: "android" } as const satisfies Record<
	OtaFeed,
	ReleasePlatform
>;

/** Where the held records of `platform`, or of all, are listed, in key order: none is a prefix of another. */
function recordPrefixes(platform: ReleasePlatform | undefined): string[] {
	const platforms = reindexPlatforms(platform);
	return [
		...platforms.map(keys.releasePrefix),
		...OTA_FEEDS.filter((f) => platforms.includes(FEED_PLATFORM[f])).map(keys.otaFilesPrefix),
	].toSorted();
}

const otaFeedOf = (key: string): OtaFeed | undefined =>
	OTA_FEEDS.find((f) => key.startsWith(keys.otaFilesPrefix(f)));

function heldOtaFeed(record: string): OtaFeed {
	const feed = otaFeedOf(record);
	if (feed === undefined) throw new DataError(`${record}: neither a release record nor an OTA file's`);
	return feed;
}

/**
 * Every held release record and OTA file record of `platform`, or of all, in key order after `after`, listed from
 * `after` on.
 */
export async function* heldRecords(
	bucket: R2Bucket,
	platform: ReleasePlatform | undefined,
	after: string | null,
): AsyncGenerator<string> {
	const prefixes = recordPrefixes(platform);
	const from = after === null ? 0 : prefixes.findIndex((p) => after.startsWith(p));
	if (from === -1) throw new DataError(`${after}: not a held record of ${platform ?? "any platform"}`);
	for (const prefix of prefixes.slice(from)) {
		const options = after !== null && prefix === prefixes[from] ? { prefix, startAfter: after } : { prefix };
		for await (const { key } of listing(bucket, options))
			if (releaseOfKey(key) !== undefined || otaFeedOf(key) !== undefined) yield key;
	}
}

const otaUrlSchema = v.object({ url: v.pipe(v.string(), v.url()) });

/** A held OTA file's record names its URL, which its key only hashes. */
const otaFileUrl = async (bucket: R2Bucket, record: string): Promise<string> =>
	(await readHeld(bucket, record, otaUrlSchema)).url;

/** A held record as a reindex target: a release record by its key, an OTA file by the URL its record names. */
export async function recordTarget(bucket: R2Bucket, record: string): Promise<RecordTarget> {
	const release = releaseOfKey(record);
	if (release !== undefined) return { kind: "release", release };
	return { kind: "ota", feed: heldOtaFeed(record), url: await otaFileUrl(bucket, record) };
}
