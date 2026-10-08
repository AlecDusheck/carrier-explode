/**
 * Google's Pixel carrier-settings update service: a new answer set is snapshotted and planned as a unit, whose steps
 * store and normalize each file it lists, with which Pixels and trains list it, merged into the file's record.
 */

import { sha1Hex, sha256Hex } from "@carrier-explode/binary";
import { decodeCarrierList, decodeCarrierSettings } from "@carrier-explode/decode-android";
import { fetchWithRetry, HttpError } from "@carrier-explode/http";
import { pixelOtaFilesSchema, releaseSchema } from "@carrier-explode/schema/records";
import { sourceKey, type PixelOtaFile, type PixelOtaListing } from "@carrier-explode/schema/types";
import { keys, putJson, putOnce, readRecord } from "@carrier-explode/storage";
import type { Env } from "../env.ts";
import { allOrThrow, fanOut } from "../fan-out.ts";
import { normWriter, storeNormalized } from "../normalize.ts";
import type { PipelineParams } from "../pipelines.ts";
import { hashed, heldReleases, heldShas, otaPointer, storeObj } from "../store.ts";
import type { UnitContext } from "../unit.ts";
import { asks, recency, trainOf } from "./plan.ts";
import { PixelError, settingsSource } from "./settings.ts";
import {
	askUpdates,
	CHECKSUM_SUFFIX,
	pixelOtaSnapshotSchema,
	type PixelOtaSnapshot,
	type UpdateAnswer,
} from "./update-service.ts";

/**
 * Null while no Pixel release is held (the service is asked per held Pixel and train) or the answers are the ones last
 * indexed. The service answers a POST, so there is no ETag to ask with.
 */
export async function checkPixelOta(env: Env): Promise<PipelineParams<"pixel-ota"> | null> {
	const wanted = asks(
		(await heldReleases(env.BUCKET, "android")).flatMap((k) => (k.platform === "android" ? [k.id] : [])),
	);
	if (!wanted.length) return null;
	const answers = allOrThrow(
		"update service",
		await fanOut(wanted, env.FEED_CONCURRENCY.pixelOta, (a) => askUpdates(a.device, a.train)),
	);
	const snapshot = new TextEncoder().encode(JSON.stringify({ answers } satisfies PixelOtaSnapshot));
	const sha1 = sha1Hex(snapshot);
	if ((await otaPointer(env.BUCKET, "pixel"))?.sha1 === sha1) return null;
	await putOnce(env.BUCKET, keys.pixelOtaSnapshot(sha1), snapshot, "application/json");
	return { snapshot: sha1 };
}

/** The service's name for the carrier list among the files it lists. */
const CARRIER_LIST_FILE = "carrier_list";

type Listed = Pick<PixelOtaListing, "source" | "device" | "train">;

const pairOf = (l: Pick<PixelOtaListing, "device" | "train">): string => `${l.device}|${l.train}`;
const listingId = (l: Listed): string => `${l.source}|${pairOf(l)}`;

/** Each CarrierSettings URL the answers list, with its version and every answer that lists it. */
export function listedFiles(
	answers: readonly UpdateAnswer[],
): Map<string, { readonly name: string; readonly version: string; readonly listings: Listed[] }> {
	const out = new Map<
		string,
		{ readonly name: string; readonly version: string; readonly listings: Listed[] }
	>();
	for (const a of answers) {
		for (const f of a.files) {
			if (f.name === CARRIER_LIST_FILE) continue;
			const entry = out.get(f.url) ?? { name: f.name, version: f.version, listings: [] };
			if (entry.version !== f.version)
				throw new PixelError(`${f.url} is listed at versions ${entry.version} and ${f.version}`);
			entry.listings.push({ source: sourceKey(settingsSource(f.name)), device: a.device, train: a.train });
			out.set(f.url, entry);
		}
	}
	return out;
}

/**
 * A file's listings once the answers are seen: only the Pixels and trains asked are judged, so a listing of a pair not
 * asked keeps its state. `changed` when a listing appeared, or left or rejoined the answers; a new lastSeenAt alone is none.
 */
export function mergeListings(
	previous: readonly PixelOtaListing[],
	listed: readonly Listed[],
	answers: readonly UpdateAnswer[],
	now: string,
): { readonly listings: PixelOtaListing[]; readonly changed: boolean } {
	const asked = new Set(answers.map(pairOf));
	const current = new Map(listed.map((l) => [listingId(l), l]));
	let changed = false;
	const kept = previous.map((l): PixelOtaListing => {
		if (!asked.has(pairOf(l))) return l;
		const live = current.delete(listingId(l));
		changed ||= live !== l.live;
		return live ? { ...l, lastSeenAt: now, live } : { ...l, live };
	});
	const added = [...current.values()].map(({ source, device, train }): PixelOtaListing => ({
		source,
		device,
		train,
		firstSeenAt: now,
		lastSeenAt: now,
		live: true,
	}));
	return { listings: [...kept, ...added], changed: changed || added.length > 0 };
}

async function snapshotOf(bucket: R2Bucket, snapshot: string): Promise<PixelOtaSnapshot> {
	const snap = await readRecord(bucket, keys.pixelOtaSnapshot(snapshot), pixelOtaSnapshotSchema);
	if (snap === null) throw new PixelError(`${keys.pixelOtaSnapshot(snapshot)}: missing; the check stores it`);
	return snap;
}

const fileRecord = async (bucket: R2Bucket, url: string): Promise<PixelOtaFile | null> =>
	readRecord(bucket, await keys.otaFile("pixel", url), pixelOtaFilesSchema.item);

/** The URLs the snapshot lists whose file records are missing or list them differently. */
export async function otaPlan(snapshot: string, bucket: R2Bucket): Promise<string[]> {
	const { answers } = await snapshotOf(bucket, snapshot);
	const wanted: string[] = [];
	for (const [url, { listings }] of listedFiles(answers)) {
		const held = await fileRecord(bucket, url);
		if (held === null || mergeListings(held.listings, listings, answers, "").changed) wanted.push(url);
	}
	return wanted;
}

/** The file, once it matches the sha256 Google serves beside it (files from 2023 and before have none). */
async function download(url: string): Promise<Uint8Array> {
	const bytes = new Uint8Array(await (await fetchWithRetry(url)).arrayBuffer());
	const stated = await fetchWithRetry(`${url}${CHECKSUM_SUFFIX}`).then(
		async (r) => (await r.text()).trim().split(/\s/)[0]?.toLowerCase() ?? null,
		(e: unknown) => {
			if (e instanceof HttpError && e.status === 404) return null;
			throw e;
		},
	);
	const sha = await sha256Hex(bytes);
	if (stated !== null && stated !== sha)
		throw new PixelError(`${url}: sha256 ${sha}, but ${CHECKSUM_SUFFIX} says ${stated}`);
	return bytes;
}

/** The newest held build's carrier list for a Pixel on `train`, else on any train. */
async function heldCarrierList(bucket: R2Bucket, device: string, train: string): Promise<string> {
	const mine = (await heldReleases(bucket, "android"))
		.flatMap((k) => (k.platform === "android" && k.id[1] === device ? [k.id[0]] : []))
		.toSorted((a, b) => recency(b).localeCompare(recency(a)));
	const build = mine.find((b) => trainOf(b) === train) ?? mine[0];
	if (build === undefined) throw new PixelError(`${device}: no held build to read its SIM rules from`);
	const part = await readRecord(bucket, keys.release("android", build, device), releaseSchema);
	if (part?.platform !== "android")
		throw new PixelError(`${keys.release("android", build, device)}: not a Pixel release`);
	return part.carrierList;
}

/** The carrier list an answer's files are read with: the one it lists, else its Pixel's held build's. */
async function carrierListOf(bucket: R2Bucket, answer: UpdateAnswer): Promise<string> {
	const listed = answer.files.find((f) => f.name === CARRIER_LIST_FILE);
	if (listed === undefined) return heldCarrierList(bucket, answer.device, answer.train);
	const bytes = await download(listed.url);
	const version = decodeCarrierList(bytes).version;
	if (version !== listed.version)
		throw new PixelError(`${listed.url}: carrier_list version ${version}, not ${listed.version}`);
	return storeObj(bucket, bytes, "android.carrier-list");
}

/** One listed file, checked against its .sha256; its record names the carrier list its answer lists. */
export async function otaFile(snapshot: string, url: string, u: UnitContext): Promise<true> {
	const { bucket } = u;
	const { answers } = await snapshotOf(bucket, snapshot);
	const file = listedFiles(answers).get(url);
	const answer = answers.find((a) => a.files.some((f) => f.url === url));
	if (file === undefined || answer === undefined)
		throw new PixelError(`${url}: not listed by snapshot ${snapshot}`);
	if (file.name === "others")
		throw new PixelError(`${url}: an others.pb update, whose parts one record cannot hold`);
	const bytes = await download(url);
	const cs = decodeCarrierSettings(bytes);
	if (cs.canonicalName !== file.name || cs.version !== file.version)
		throw new PixelError(
			`${url}: ${cs.canonicalName} version ${cs.version}, not ${file.name} ${file.version}`,
		);
	const a = await hashed(bytes);
	if (!(await heldShas(u.db, [a.sha])).has(a.sha)) {
		await storeNormalized(
			normWriter(bucket),
			{ kind: "android.carrier-settings", sha: a.sha, source: sourceKey(settingsSource(file.name)) },
			bytes,
		);
	}
	const { sha } = a;
	const held = await fileRecord(bucket, url);
	const [first, ...rest] = mergeListings(
		held?.listings ?? [],
		file.listings,
		answers,
		new Date().toISOString(),
	).listings;
	if (first === undefined) throw new PixelError(`${url}: no listing`);
	const record: PixelOtaFile = {
		url,
		version: file.version,
		sha,
		carrierList: await carrierListOf(bucket, answer),
		listings: [first, ...rest],
		...(cs.lastUpdated === undefined ? {} : { published: cs.lastUpdated.slice(0, 10) }),
	};
	await putJson(bucket, await keys.otaFile("pixel", url), record);
	return true;
}
