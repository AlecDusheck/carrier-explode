/**
 * One Pixel's OTA of one build, in steps that each open the OTA again and keep one thing in memory. Artifacts are
 * normalized by later steps from obj/; the steps hand on through tmp/<instance>/.
 */

import { decompress as zstd } from "fzstd";
import Bunzip from "seek-bzip";
import * as v from "valibot";

import type { IndexDb } from "@carrier-explode/db";
import {
	decodeXz,
	openFilesystem,
	openPartition,
	openPayload,
	openRemoteZip,
	type Decompressors,
	type Filesystem,
	type Payload,
} from "@carrier-explode/firmware";
import { androidModemSchema, releaseSchema, sha256Schema } from "@carrier-explode/schema/records";
import {
	sourceKey,
	type AndroidArtifact,
	type AndroidModem,
	type SourceKey,
} from "@carrier-explode/schema/types";
import { keys, putJson, putObj, type ReleaseKey } from "@carrier-explode/storage";
import {
	familyModem,
	modemFamily,
	shannonItems,
	shannonItemsSchema,
	type ModemFamily,
	type ShannonItems,
} from "../modem/index.ts";
import { pend, type NormArtifact, type Pending } from "../normalize.ts";
import {
	hashed,
	heldShas,
	readJson,
	storeModemConfigs,
	storeObj,
	CONNECTIONS,
	type Hashed,
	type Store,
} from "../store.ts";
import type { UnitContext } from "../unit.ts";
import type { PixelDevice } from "./plan.ts";
import { chunks } from "../fan-out.ts";
import {
	CARRIER_LIST,
	OTHERS,
	othersParts,
	PixelError,
	settingsFile,
	settingsNames,
	settingsRoot,
	type SettingsFile,
} from "./settings.ts";

const CODECS: Decompressors = {
	xz: decodeXz,
	bz2: (data, size) => {
		const out = Bunzip.decode(data, new Uint8Array(size));
		return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
	},
	zstd: (data, size) => zstd(data, new Uint8Array(size)),
};

type Sources = Record<SourceKey<"android">, AndroidArtifact[]>;

async function payloadOf(d: PixelDevice): Promise<Payload> {
	return openPayload(await openRemoteZip(d.url), { decompressors: CODECS });
}

const image = async (payload: Payload, name: string, cacheOps?: number): Promise<Filesystem> =>
	openFilesystem(await openPartition(payload, name, cacheOps));

/** The modem image is mostly streamed (Shannon's firmware, twice), so it keeps fewer operations than the default. */
const MODEM_CACHE_OPS = 2;

/** What later steps read, under the unit's tmp/. */
const part = (
	u: UnitContext,
	name: "settings" | "settings-norm" | "items" | "modem" | "modem-norm",
): string => keys.tmp(u.instance, `${name}.json`);

/** A step's store: each artifact written as it is, and listed for a later step to normalize. */
function storing(bucket: R2Bucket): { readonly store: Store; readonly listed: NormArtifact[] } {
	const listed: NormArtifact[] = [];
	return {
		listed,
		store: async (a, bytes) => {
			await putObj(bucket, a.sha, bytes, a.kind);
			listed.push(a);
		},
	};
}

/** The modem's family; null for a Pixel without a modem partition. */
export async function plan(d: PixelDevice): Promise<ModemFamily | null> {
	const payload = await payloadOf(d);
	return payload.partition("modem") ? modemFamily(await image(payload, "modem", MODEM_CACHE_OPS)) : null;
}

/**
 * A CarrierSettings directory: each file one source, given to `store` unless the index already holds its sha (one
 * query for the directory). Returns its sources and its carrier list's sha.
 */
export async function storeSettingsDir(
	fs: Filesystem,
	dir: string,
	db: IndexDb,
	bucket: R2Bucket,
	store: Store,
	device: string,
): Promise<{ readonly sources: Sources; readonly carrierList: string }> {
	const names = await settingsNames(fs, dir);
	if (!names.includes(CARRIER_LIST)) throw new PixelError(`${dir} has no ${CARRIER_LIST}`);
	const own: Array<{ readonly name: string; readonly a: Hashed }> = [];
	for (const name of names.filter((n) => n !== CARRIER_LIST && n !== OTHERS))
		own.push({ name, a: await hashed(await fs.readFile(`${dir}/${name}`)) });
	const parts = names.includes(OTHERS)
		? othersParts(await fs.readFile(`${dir}/${OTHERS}`), new Set(names))
		: [];
	const shared = await Promise.all(parts.map(async (f) => ({ f, a: await hashed(f.bytes) })));
	const held = await heldShas(
		db,
		[...own, ...shared].map((x) => x.a.sha),
	);

	const sources: Sources = {};
	const put = async (f: SettingsFile, a: Hashed): Promise<void> => {
		if (!held.has(a.sha))
			await store({ kind: "android.carrier-settings", sha: a.sha, source: sourceKey(f.source) }, a.bytes);
		sources[sourceKey(f.source)] = [
			{ sha: a.sha, version: f.version, size: a.bytes.length, devices: [device] },
		];
	};
	for (const batch of chunks(own, CONNECTIONS))
		await Promise.all(batch.map(({ name, a }) => put(settingsFile(name, a.bytes), a)));
	for (const batch of chunks(shared, CONNECTIONS)) await Promise.all(batch.map(({ f, a }) => put(f, a)));
	const carrierList = await storeObj(
		bucket,
		await fs.readFile(`${dir}/${CARRIER_LIST}`),
		"android.carrier-list",
	);
	return {
		sources: Object.fromEntries(Object.entries(sources).toSorted(([a], [b]) => a.localeCompare(b))),
		carrierList,
	};
}

/** The CarrierSettings and carrier list stored; the sources to tmp/. Returns what is left to normalize. */
export async function settings(d: PixelDevice, u: UnitContext): Promise<Pending> {
	const { fs, dir } = await settingsRoot(await payloadOf(d));
	const s = storing(u.bucket);
	await putJson(
		u.bucket,
		part(u, "settings"),
		await storeSettingsDir(fs, dir, u.db, u.bucket, s.store, d.device),
	);
	return pend(u.bucket, part(u, "settings-norm"), s.listed);
}

/** A Shannon firmware's item table, streamed, to tmp/. */
export async function items(d: PixelDevice, label: string, u: UnitContext): Promise<void> {
	const table = await shannonItems(await image(await payloadOf(d), "modem", MODEM_CACHE_OPS), label);
	await putJson(u.bucket, part(u, "items"), [...table]);
}

const itemsOf = async (u: UnitContext): Promise<ShannonItems> =>
	v.parse(shannonItemsSchema, await readPart(u, "items"));

/** The modem's configurations stored unless held; its AndroidModem to tmp/. Returns what is left to normalize. */
export async function modem(d: PixelDevice, family: ModemFamily, u: UnitContext): Promise<Pending> {
	const payload = await payloadOf(d);
	let vendor: Promise<Filesystem> | undefined;
	const images = {
		modem: () => image(payload, "modem", MODEM_CACHE_OPS),
		vendor: () => (vendor ??= image(payload, "vendor")),
	};
	const extracted = await familyModem(family, images, () => itemsOf(u));
	const s = storing(u.bucket);
	const record: AndroidModem = {
		family: extracted.family,
		firmware: extracted.firmware,
		devices: [d.device],
		configs: await storeModemConfigs(u.db, extracted.archives, s.store),
	};
	await putJson(u.bucket, part(u, "modem"), record);
	return pend(u.bucket, part(u, "modem-norm"), s.listed);
}

const readPart = async (u: UnitContext, name: Parameters<typeof part>[1]): Promise<unknown> =>
	readJson(u.bucket, part(u, name));

const settingsPartSchema = v.object({
	sources: v.record(v.string(), v.unknown()),
	carrierList: sha256Schema,
});

/** The device's record from what the steps left in tmp/, written last: the unit is held once it is listed. */
export async function release(d: PixelDevice, withModem: boolean, u: UnitContext): Promise<ReleaseKey> {
	const { sources, carrierList } = v.parse(settingsPartSchema, await readPart(u, "settings"));
	const modems = withModem ? [v.parse(androidModemSchema, await readPart(u, "modem"))] : [];
	const record = v.parse(releaseSchema, {
		platform: "android",
		id: d.build,
		version: d.version,
		patch: d.patch,
		devices: [d.device],
		extractedAt: new Date().toISOString(),
		sources,
		carrierList,
		modems,
	});
	await putJson(u.bucket, keys.release("android", d.build, d.device), record);
	return { platform: "android", id: [d.build, d.device] };
}
