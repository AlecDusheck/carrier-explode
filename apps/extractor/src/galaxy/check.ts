/**
 * The Galaxy feed: the scoped phones from Google Play's device list, their builds from Samsung's version.xml, each
 * with its Android major, which FUS is asked for once per firmware.
 */

import { indexDb, syncDevices, syncLabels } from "@carrier-explode/db";
import { fetchWithRetry, HttpError } from "@carrier-explode/http";
import { releaseSchema } from "@carrier-explode/schema/records";
import { keys, putJson, readRecord } from "@carrier-explode/storage";
import type { Env } from "../env.ts";
import { allOrThrow, fanOut } from "../fan-out.ts";
import { devicesSynced } from "../queues.ts";
import type { Scope } from "../scope.ts";
import { heldReleases } from "../store.ts";
import { androidMajor, openGalaxyFirmware } from "./firmware.ts";
import { FUS_INFORM } from "./fus.ts";
import { galaxyPhones, SUPPORTED_DEVICES, type GalaxyPhone } from "./phones.ts";
import {
	candidates,
	firmwareFactsSchema,
	fusVersion,
	galaxyDevices,
	launchedSince,
	planGalaxy,
	type Candidate,
	type FirmwareFacts,
	type GalaxyBuild,
	type ListedFirmware,
	type ReadFirmware,
} from "./plan.ts";

/** The US CSCs whose version.xml lists, together, a U or U1 model's launch build and each OS upgrade's newest: no one CSC does. */
const REGIONS = ["ATT", "TMB"] as const;

async function fetchPhones(scope: Scope["samsung"]): Promise<GalaxyPhone[]> {
	const csv = new TextDecoder("utf-16le").decode(
		await (await fetchWithRetry(SUPPORTED_DEVICES)).arrayBuffer(),
	);
	return galaxyPhones(csv, scope);
}

/** Samsung's own list of a model's builds on a region: the latest and those it upgrades from. Its CDN serves it to phones only. */
const versionXml = (model: string, region: string): string =>
	`https://fota-cloud-dn.ospserver.net/firmware/${region}/${model}/version.xml`;

/** A model's builds on a region; none where Samsung has not released it (403). */
async function fetchVersions(model: string, region: string): Promise<string[]> {
	try {
		const xml = await (
			await fetchWithRetry(versionXml(model, region), {
				headers: { "user-agent": "Dalvik/2.1.0 (Linux; U; Android 16)" },
			})
		).text();
		return [...xml.matchAll(/<(?:latest|value)[^>]*>([^<]+)</g)].flatMap((m) => fusVersion(m[1] ?? "") ?? []);
	} catch (e) {
		if (e instanceof HttpError && e.status === 403) return [];
		throw e;
	}
}

/** version.xml requests, and R2 reads, in flight at once. */
const ASKING = 6;

/** `Galaxy S26 (SM-S942U)` → `Galaxy S26`. */
const modelName = (display: string, model: string): string =>
	display.replace(` (${model})`, "").trim() || model;

/** One FUS conversation and a range read of the zip directory, kept so FUS is not asked about this firmware again. */
async function readFacts(env: Env, fw: Candidate): Promise<ReadFirmware> {
	const { firmware, released, displayName } = await openGalaxyFirmware(fw);
	const facts: FirmwareFacts = {
		major: androidMajor(firmware),
		released,
		name: modelName(displayName, fw.model),
	};
	await putJson(env.BUCKET, keys.galaxyFirmware(fw.build), facts);
	return { ...fw, ...facts };
}

/** A held firmware as its release record says, one read before as its kept facts say; undefined for one FUS must be asked about. */
async function knownFirmware(
	env: Env,
	held: ReadonlySet<string>,
	fw: Candidate,
): Promise<ReadFirmware | undefined> {
	if (held.has(fw.build)) {
		const r = await readRecord(env.BUCKET, keys.release("samsung", fw.build), releaseSchema);
		if (r === null) throw new Error(`${fw.build}: listed, then gone`);
		if (r.released === undefined) throw new Error(`${fw.build}: its release record has no build day`);
		return { ...fw, major: Number.parseInt(r.version, 10), released: r.released, name: null };
	}
	const facts = await readRecord(env.BUCKET, keys.galaxyFirmware(fw.build), firmwareFactsSchema);
	return facts === null ? undefined : { ...fw, ...facts };
}

/** The scoped phones out since the scope's `releasedSince`, on each region, with their builds. */
async function listGalaxy(scope: Scope["samsung"], today: string): Promise<ListedFirmware[]> {
	const asked = (await fetchPhones(scope)).flatMap((p) => REGIONS.map((region) => ({ phone: p, region })));
	const all = allOrThrow(
		"version.xml",
		await fanOut(asked, ASKING, async ({ phone, region }): Promise<ListedFirmware> => ({
			...phone,
			region,
			versions: await fetchVersions(phone.model, region),
		})),
	);
	return [...Map.groupBy(all, (l) => l.model).values()]
		.filter((ls) =>
			launchedSince(
				ls.flatMap((l) => l.versions.flatMap((v) => v.split("/")[1] ?? [])),
				scope.releasedSince,
				today,
			),
		)
		.flat();
}

export async function checkGalaxy(env: Env): Promise<GalaxyBuild[]> {
	const today = new Date().toISOString().slice(0, 10);
	const listed = await listGalaxy(env.SCOPE.samsung, today);
	const held = new Set((await heldReleases(env.BUCKET, "samsung")).map((k) => k.id[0]));
	const known = allOrThrow(
		"firmware",
		await fanOut(candidates(listed, today), ASKING, async (fw) => ({
			fw,
			read: await knownFirmware(env, held, fw),
		})),
	);
	const read = known.flatMap((k) => k.read ?? []);
	// One at a time: FUS blocks a burst, and the first refusal ends the check.
	for (const { fw } of known.filter((k) => k.read === undefined)) read.push(await readFacts(env, fw));
	const { records, names } = galaxyDevices(read);
	const db = indexDb(env.DB);
	await devicesSynced(env, "samsung", {
		names: await syncLabels(db, "device", "name", names, FUS_INFORM),
		devices: await syncDevices(db, records),
	});
	return planGalaxy(env.SCOPE, read, held);
}
