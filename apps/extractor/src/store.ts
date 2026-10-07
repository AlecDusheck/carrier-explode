/**
 * The bucket as units and checks use it. Planning reads key listings alone, never D1. An artifact goes to obj/ before
 * what is normalized from it, so a held norm/ object means both are.
 */

import { compareUtf8, packFiles, sha256Hex } from "@carrier-explode/binary";
import { missingProfiles, type IndexDb } from "@carrier-explode/db";
import type { ReleasePlatform } from "@carrier-explode/schema/types";
import {
	keys,
	otaPointerSchema,
	parseRecord,
	putObj,
	readRecord,
	releaseOfKey,
	type ArtifactKind,
	type OtaFeed,
	type OtaPointer,
	type ReleaseKey,
} from "@carrier-explode/storage";
import { DataError } from "./errors.ts";
import type { ModemArchive } from "./modem/index.ts";
import { chunks } from "./fan-out.ts";
import type { NormArtifact } from "./normalize.ts";

/** R2 requests a step keeps in flight: a Worker holds at most six connections waiting on a response. */
export const CONNECTIONS = 6;

/** Modem-config archives held at once while their shas are looked up: a Shannon firmware's together outgrow a step. */
const MODEM_BATCH = 8;

/** The object at `key`, which an earlier step or unit wrote. */
export async function readBytes(bucket: R2Bucket, key: string): Promise<Uint8Array> {
	const o = await bucket.get(key);
	if (o === null) throw new DataError(`${key}: missing`);
	return new Uint8Array(await o.arrayBuffer());
}

/** The JSON record at `key`, which an earlier step or unit wrote. */
export const readJson = async (bucket: R2Bucket, key: string): Promise<unknown> =>
	parseRecord(key, new TextDecoder().decode(await readBytes(bucket, key)));

/** Every object a listing names, a page read only once the one before it is consumed. */
export async function* listing(bucket: R2Bucket, options: R2ListOptions): AsyncGenerator<R2Object> {
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ ...options, ...(cursor === undefined ? {} : { cursor }) });
		yield* page.objects;
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor !== undefined);
}

/** Every object under `prefix`. */
export async function listKeys(
	bucket: R2Bucket,
	prefix: string,
	include: R2ListOptions["include"] = [],
): Promise<R2Object[]> {
	const out: R2Object[] = [];
	for await (const o of listing(bucket, { prefix, include })) out.push(o);
	return out;
}

/** The release records a platform holds; a Pixel build's are per device. */
export async function heldReleases(bucket: R2Bucket, platform: ReleasePlatform): Promise<ReleaseKey[]> {
	return (await listKeys(bucket, keys.releasePrefix(platform))).flatMap((o) => releaseOfKey(o.key) ?? []);
}

/** An iOS release record's metadata: the phones its IPSWs install, so a listing shows a phone a held build lacks. */
const PHONES = "phones";
export const iosReleaseMetadata = (devices: readonly string[]): Record<string, string> => ({
	[PHONES]: devices.join(" "),
});

/** Each held iOS build's phones, from a listing of its records; none for a record written without them, so its build is planned again. */
export const iosPhonesOf = (
	listed: ReadonlyArray<Pick<R2Object, "key" | "customMetadata">>,
): Map<string, ReadonlySet<string>> =>
	new Map(
		listed.flatMap((o) => {
			const build = releaseOfKey(o.key)?.id[0];
			if (build === undefined) return [];
			return [[build, new Set(o.customMetadata?.[PHONES]?.split(" ") ?? [])]];
		}),
	);

export const heldIosPhones = async (bucket: R2Bucket): Promise<Map<string, ReadonlySet<string>>> =>
	iosPhonesOf(await listKeys(bucket, keys.releasePrefix("ios"), ["customMetadata"]));

/** The snapshot a feed was last indexed from; null before its first. */
export const otaPointer = (bucket: R2Bucket, feed: OtaFeed): Promise<OtaPointer | null> =>
	readRecord(bucket, keys.otaCurrent(feed), otaPointerSchema);

/** An artifact's bytes and their sha256. */
export interface Hashed {
	readonly bytes: Uint8Array;
	readonly sha: string;
}

export const hashed = async (bytes: Uint8Array): Promise<Hashed> => ({ bytes, sha: await sha256Hex(bytes) });

/** The shas of `shas` whose objects are written, as the index's profile rows under the current PROFILE_SCHEMA say. One query. */
export async function heldShas(db: IndexDb, shas: readonly string[]): Promise<ReadonlySet<string>> {
	const missing = new Set(await missingProfiles(db, shas));
	return new Set(shas.filter((s) => !missing.has(s)));
}

/** An artifact nothing is normalized from, under its sha256, which it returns. */
export async function storeObj(bucket: R2Bucket, bytes: Uint8Array, kind: ArtifactKind): Promise<string> {
	const sha = await sha256Hex(bytes);
	await putObj(bucket, sha, bytes, kind);
	return sha;
}

/** What a step does with an artifact the index does not hold: stores and normalizes it, or stores it for a later step to normalize. */
export type Store = (a: NormArtifact, bytes: Uint8Array) => Promise<void>;

/** A firmware's modem-config archives, each given to `store` unless held, one at a time. Returns each label's sha, in label order. */
export async function storeModemConfigs(
	db: IndexDb,
	archives: readonly ModemArchive[],
	store: Store,
): Promise<Record<string, string>> {
	const stored: Array<readonly [string, string]> = [];
	for (const run of chunks(archives, MODEM_BATCH)) {
		const batch: Array<{ readonly label: string; readonly a: Hashed }> = [];
		for (const archive of run)
			batch.push({ label: archive.label, a: await hashed(packFiles(await archive.files())) });
		const held = await heldShas(
			db,
			batch.map((b) => b.a.sha),
		);
		for (const { label, a } of batch) {
			if (!held.has(a.sha)) await store({ kind: "android.modem-config", sha: a.sha, source: null }, a.bytes);
			stored.push([label, a.sha]);
		}
	}
	return Object.fromEntries(stored.toSorted(([a], [b]) => compareUtf8(a, b)));
}
