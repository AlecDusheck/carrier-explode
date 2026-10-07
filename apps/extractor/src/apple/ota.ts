/** Apple's OTA carrier manifest: a new one is stored and planned as a unit, whose steps fetch, check, store and normalize each file it changes. */

import * as v from "valibot";

import { sha1Hex, sha256Hex, sha384Hex } from "@carrier-explode/binary";
import {
	contentId,
	MANIFEST_URL,
	manifestTables,
	openIpcc,
	parseManifest,
	publishedOn,
} from "@carrier-explode/decode-ios";
import { fetchApple } from "@carrier-explode/http";
import { otaFilesSchema } from "@carrier-explode/schema/records";
import type { Digests, OtaFile, OtaListing, SourceKey } from "@carrier-explode/schema/types";
import { keys, readRecord } from "@carrier-explode/storage";
import type { Env } from "../env.ts";
import { permanent } from "../errors.ts";
import { normWriter } from "../normalize.ts";
import type { PipelineParams } from "../pipelines.ts";
import { listKeys, otaPointer, readBytes } from "../store.ts";
import type { UnitContext } from "../unit.ts";
import { storeBundle } from "./build.ts";
import {
	listedDigest,
	manifestEntries,
	mergeDigests,
	scopedEntries,
	updateListings,
	type Entry,
} from "./ota-manifest.ts";

const otaFileSchema = otaFilesSchema.item;

/** Null while the manifest is the one last indexed. Apple sends no ETag for it, so the bytes' sha1 is compared. */
export async function checkAppleOta(env: Env): Promise<PipelineParams<"apple-ota"> | null> {
	// A query of its own gets past a stale CDN copy.
	const manifest = await fetchApple(`${MANIFEST_URL}?t=${Date.now()}`);
	const sha1 = sha1Hex(manifest);
	if ((await otaPointer(env.BUCKET, "apple"))?.sha1 === sha1) return null;
	await env.BUCKET.put(keys.appleOtaManifest(sha1), manifest, {
		onlyIf: new Headers({ "If-None-Match": "*" }),
		httpMetadata: { contentType: "application/xml" },
	});
	return { manifest: sha1 };
}

/** A file record's customMetadata: its URL (its key is a hash of it) and listedDigest of its live listings. */
const heldSchema = v.object({ url: v.string(), listed: v.string() });

interface ReadManifest {
	readonly scoped: ReadonlyMap<string, readonly Entry[]>;
	readonly urls: ReadonlySet<string>;
}

/** The manifest last read: one invocation runs many file steps of one manifest, which is parsed once. */
let lastRead: { readonly manifest: string; readonly read: Promise<ReadManifest> } | undefined;

/** The manifest's entries, the share the scope fetches grouped by URL, and every URL it lists. */
function readManifest(u: UnitContext, manifest: string): Promise<ReadManifest> {
	if (lastRead?.manifest === manifest) return lastRead.read;
	const read = readBytes(u.bucket, keys.appleOtaManifest(manifest)).then((bytes) => {
		const all = manifestEntries(manifestTables(parseManifest(bytes)));
		return {
			scoped: Map.groupBy(scopedEntries(u.scope, all), (e) => e.url),
			urls: new Set(all.map((e) => e.url)),
		};
	});
	lastRead = { manifest, read };
	// A failed read is not kept: the step's retry reads again.
	read.catch(() => {
		if (lastRead?.read === read) lastRead = undefined;
	});
	return read;
}

/** Each held file's URL and listed digest, from the listing alone. */
async function heldFiles(bucket: R2Bucket): Promise<Map<string, string>> {
	const listed = await listKeys(bucket, keys.otaFilesPrefix("apple"), ["customMetadata"]);
	return new Map(
		listed.map((o) => {
			const { url, listed: digest } = v.parse(heldSchema, o.customMetadata);
			return [url, digest];
		}),
	);
}

const NONE = listedDigest([]);

/** The URLs of the manifest whose file records are missing or list it differently. */
export async function otaPlan(manifest: string, u: UnitContext): Promise<readonly string[]> {
	const { scoped, urls } = await readManifest(u, manifest);
	const held = await heldFiles(u.bucket);
	const changed = [...scoped]
		.filter(([url, entries]) => held.get(url) !== listedDigest(entries.map((e) => e.listing)))
		.map(([url]) => url);
	// A file Apple no longer lists at all is kept, its listings no longer live.
	const dropped = [...held].filter(([url, listed]) => !urls.has(url) && listed !== NONE).map(([url]) => url);
	return [...changed, ...dropped].toSorted();
}

async function readOtaFile(bucket: R2Bucket, url: string): Promise<OtaFile | null> {
	return readRecord(bucket, await keys.otaFile("apple", url), otaFileSchema);
}

/** Apple serves other bytes than the manifest's digest names: it replaced the file and kept the old digest. */
class ReplacedError extends Error {
	override name = "ReplacedError";
}

/** The bytes at `url`, which must match every digest the manifest states. */
async function download(url: string, digests: Digests): Promise<Uint8Array> {
	const bytes = await fetchApple(url);
	const got = { sha1: sha1Hex(bytes), sha384: await sha384Hex(bytes) };
	for (const alg of ["sha1", "sha384"] as const) {
		const want = digests[alg];
		if (want !== undefined && want !== got[alg])
			throw new ReplacedError(`${url}: ${alg} ${got[alg]}, the manifest states ${want}`);
	}
	return bytes;
}

/** A new file: stored, and normalized as the source it is listed for (the first by key, when several). */
async function fetchFile(
	u: UnitContext,
	url: string,
	source: SourceKey,
	digests: Digests,
): Promise<Pick<OtaFile, "sha" | "cid">> {
	const bytes = await download(url, digests);
	const [sha, cid] = await Promise.all([sha256Hex(bytes), contentId(openIpcc(bytes))]);
	await storeBundle(normWriter(u.bucket), source, sha, () => Promise.resolve(bytes));
	return { sha, cid };
}

const nonEmpty = (listings: readonly OtaListing[], url: string): OtaFile["listings"] => {
	const [first, ...rest] = listings;
	if (first === undefined) throw new Error(`${url}: no listings`);
	return [first, ...rest];
};

/** The file the manifest lists is gone: taken down (both schemes answer 4xx) or replaced. */
const unavailable = (e: unknown): boolean =>
	e instanceof ReplacedError || (e instanceof AggregateError && e.errors.every(permanent));

/**
 * One OTA file downloaded, checked against the manifest's digests, stored and normalized; its record written last.
 * False when it is unavailable: unheld, the next manifest plans it again.
 */
export async function otaFile(manifest: string, url: string, u: UnitContext): Promise<boolean> {
	const [{ scoped }, previous] = await Promise.all([readManifest(u, manifest), readOtaFile(u.bucket, url)]);
	const [head, ...more] = scoped.get(url) ?? [];
	const now = new Date().toISOString();
	let file: OtaFile;
	if (head === undefined) {
		if (previous === null) throw new Error(`${url}: neither listed by ${manifest} nor held`);
		file = { ...previous, listings: nonEmpty(updateListings(previous.listings, [], now), url) };
	} else {
		const listed = [head, ...more].map((e) => e.listing);
		const digests = mergeDigests(
			url,
			...(previous === null ? [] : [previous.digests]),
			...[head, ...more].map((e) => e.digests),
		);
		const stored =
			previous ??
			(await fetchFile(
				u,
				url,
				listed.map((l) => l.source).toSorted()[0] ?? head.listing.source,
				digests,
			).catch((e: unknown) => {
				if (unavailable(e)) return null;
				throw e;
			}));
		if (stored === null) return false;
		const { sha, cid } = stored;
		const published = publishedOn(url);
		file = {
			url,
			version: head.version,
			...(published === undefined ? {} : { published }),
			digests,
			sha,
			cid,
			listings: nonEmpty(updateListings(previous?.listings ?? [], listed, now), url),
		};
	}
	const live = file.listings.filter((l) => l.live);
	// Last: the file is held once its record is listed.
	await u.bucket.put(await keys.otaFile("apple", url), JSON.stringify(file), {
		httpMetadata: { contentType: "application/json" },
		customMetadata: { url, listed: listedDigest(live) } satisfies v.InferOutput<typeof heldSchema>,
	});
	return true;
}
