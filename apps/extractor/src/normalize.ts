/**
 * What is normalized from each kind of artifact, from its bytes alone: a Profile for a source's settings, a ModemConfig
 * (with the base and band-combination lists it refers to) for a modem configuration, nothing for the rest.
 */

import * as v from "valibot";

import { decodeCarrierSettings } from "@carrier-explode/decode-android";
import { openIpcc } from "@carrier-explode/decode-ios";
import { openOmc } from "@carrier-explode/decode-samsung";
import { androidProfile, iosProfile, modemConfig, samsungProfile } from "@carrier-explode/schema";
import { sha256Schema, sourceKeySchema } from "@carrier-explode/schema/records";
import { sourceOf, type Profile, type SourceKey, type SourceRef } from "@carrier-explode/schema/types";
import {
	ARTIFACT_KINDS,
	keys,
	putJson,
	putJsonOnce,
	putObj,
	type ArtifactKind,
} from "@carrier-explode/storage";
import { DataError } from "./errors.ts";
import { chunks } from "./fan-out.ts";
import { CONNECTIONS, readBytes, readJson } from "./store.ts";

/** Writes norm/ objects for one step, each shared key once: a firmware's configs name the same bases and combinations. */
export interface NormWriter {
	readonly bucket: R2Bucket;
	readonly written: Set<string>;
}

export const normWriter = (bucket: R2Bucket): NormWriter => ({ bucket, written: new Set() });

async function once(w: NormWriter, key: string, value: unknown): Promise<void> {
	if (w.written.has(key)) return;
	w.written.add(key);
	await putJsonOnce(w.bucket, key, value);
}

type Normalize = (w: NormWriter, bytes: Uint8Array, sha: string, source: SourceKey | null) => Promise<void>;

/** A source's settings: its Profile. */
const profiled =
	(read: (bytes: Uint8Array, source: SourceRef, sha: string) => Profile): Normalize =>
	async (w, bytes, sha, source) => {
		if (source === null) throw new DataError(`${sha}: a source's settings, named for no source`);
		await once(w, keys.profile(sha), read(bytes, sourceOf(source), sha));
	};

const modemConfigOf: Normalize = async (w, bytes, sha) => {
	const { config, base, combos } = await modemConfig(bytes, sha);
	for (const [key, list] of combos) await once(w, keys.combos(key), list);
	if (base !== null) await once(w, keys.modemConfig(base.sha), base);
	await once(w, keys.modemConfig(config.sha), config);
};

/**
 * Each kind's normalizer, how many one step normalizes, and how many at once: a modem configuration's decode is heavy, a
 * settings file's light, so its R2 round trips overlap.
 */
const NORMALIZE = {
	"apple.ipcc": {
		run: profiled((bytes, source, sha) => iosProfile(openIpcc(bytes), source, sha)),
		perStep: 100,
		atOnce: CONNECTIONS,
	},
	"android.carrier-settings": {
		run: profiled((bytes, source, sha) => androidProfile(decodeCarrierSettings(bytes), source, sha)),
		perStep: 100,
		atOnce: CONNECTIONS,
	},
	"samsung.omc": {
		run: profiled((bytes, source, sha) => samsungProfile(openOmc(bytes), source, sha)),
		perStep: 100,
		atOnce: CONNECTIONS,
	},
	"android.modem-config": { run: modemConfigOf, perStep: 10, atOnce: 1 },
	"apple.bbfw": null,
	"apple.ftab": null,
	"android.carrier-list": null,
} as const satisfies Record<
	ArtifactKind,
	{ readonly run: Normalize; readonly perStep: number; readonly atOnce: number } | null
>;

type NormalizedKind = {
	readonly [K in ArtifactKind]: (typeof NORMALIZE)[K] extends null ? never : K;
}[ArtifactKind];
const NORMALIZED_KINDS = ARTIFACT_KINDS.filter((k): k is NormalizedKind => NORMALIZE[k] !== null);

/** An artifact something is normalized from; a modem configuration is no source's. */
const normArtifactSchema = v.object({
	kind: v.picklist(NORMALIZED_KINDS),
	sha: sha256Schema,
	source: v.nullable(sourceKeySchema),
});
export type NormArtifact = v.InferOutput<typeof normArtifactSchema>;

/** Writes what `a` normalizes to, read from its bytes. */
const normalize = (w: NormWriter, a: NormArtifact, bytes: Uint8Array): Promise<void> =>
	NORMALIZE[a.kind].run(w, bytes, a.sha, a.source);

/** An artifact under its sha256, then what it normalizes to: a held norm/ object means both are. */
export async function storeNormalized(w: NormWriter, a: NormArtifact, bytes: Uint8Array): Promise<void> {
	await putObj(w.bucket, a.sha, bytes, a.kind);
	await normalize(w, a, bytes);
}

/** `artifacts` cut into the runs one step normalizes: up to a kind's perStep of one kind at a time. As [start, end) indexes. */
export function normBatches(artifacts: readonly NormArtifact[]): Array<readonly [number, number]> {
	const out: Array<readonly [number, number]> = [];
	let start = 0;
	for (let i = 1; i <= artifacts.length; i++) {
		const first = artifacts[start];
		if (first === undefined) break;
		const next = artifacts[i];
		if (next === undefined || next.kind !== first.kind || i - start >= NORMALIZE[first.kind].perStep) {
			out.push([start, i]);
			start = i;
		}
	}
	return out;
}

/** Artifacts stored for later steps to normalize: their list's key, and the runs of it each step takes. */
export interface Pending {
	readonly key: string;
	readonly batches: ReadonlyArray<readonly [number, number]>;
}

/** Lists `artifacts` at `key` (under the unit's tmp/) for normalizeRun. */
export async function pend(
	bucket: R2Bucket,
	key: string,
	artifacts: readonly NormArtifact[],
): Promise<Pending> {
	await putJson(bucket, key, artifacts);
	return { key, batches: normBatches(artifacts) };
}

/** One run of a pending list normalized, each artifact read back from obj/. */
export async function normalizeRun(
	bucket: R2Bucket,
	key: string,
	[start, end]: readonly [number, number],
): Promise<void> {
	const listed = v.parse(v.array(normArtifactSchema), await readJson(bucket, key));
	const run = listed.slice(start, end);
	const [first] = run;
	if (first === undefined) return;
	const w = normWriter(bucket);
	for (const group of chunks(run, NORMALIZE[first.kind].atOnce))
		await Promise.all(group.map(async (a) => normalize(w, a, await readBytes(bucket, keys.obj(a.sha)))));
}
