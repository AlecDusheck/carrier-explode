/**
 * The Galaxy feed: the scoped phones from Google Play's device list, their builds from Samsung's version.xml under
 * the scope's sales codes, each with its Android major, which FUS is asked for once per firmware.
 */

import { indexDb, syncDevices, syncLabels } from "@carrier-explode/db";
import { fetchWithRetry, HttpError } from "@carrier-explode/http";
import { releaseSchema } from "@carrier-explode/schema/records";
import { keys, putJson, readRecord } from "@carrier-explode/storage";
import type { Env } from "../env.ts";
import { allOrThrow, chunks, fanOut } from "../fan-out.ts";
import { devicesSynced } from "../queues.ts";
import type { Scope } from "../scope.ts";
import { heldReleases } from "../store.ts";
import type { Steps } from "../unit.ts";
import { androidMajor, openGalaxyFirmware } from "./firmware.ts";
import { FUS_INFORM, FusRefusal } from "./fus.ts";
import { galaxyPhones, SUPPORTED_DEVICES, type GalaxyPhone } from "./phones.ts";
import {
	candidates,
	firmwareAnswerSchema,
	packageOf,
	fusVersion,
	galaxyDevices,
	launchedSince,
	oldestMonth,
	planGalaxy,
	type Candidate,
	type FirmwareAnswer,
	type FirmwareFacts,
	type GalaxyBuild,
	type ListedFirmware,
	type ReadFirmware,
} from "./plan.ts";
import {
	LaunchBound,
	mayLaunchSince,
	modelProbesSchema,
	newestGenerationFirst,
	NO_PROBES,
	reaskDue,
	salesCodesToAsk,
	type ModelProbes,
} from "./sales-codes.ts";

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

/**
 * One FUS conversation and a range read of the zip directory, its answer kept so FUS is not asked about this firmware
 * again: the firmware's facts, or the day FUS said it does not serve it (null).
 */
async function askFus(env: Env, fw: Candidate, today: string): Promise<ReadFirmware | null> {
	try {
		const { firmware, released, displayName } = await openGalaxyFirmware(fw);
		const facts: FirmwareFacts = {
			major: androidMajor(firmware),
			released,
			name: displayName,
		};
		await putJson(env.BUCKET, keys.galaxyFirmware(fw.build), facts);
		return { ...fw, ...facts };
	} catch (e) {
		if (!(e instanceof FusRefusal)) throw e;
		const refusal: FirmwareAnswer = { refused: today };
		await putJson(env.BUCKET, keys.galaxyFirmware(fw.build), refusal);
		return null;
	}
}

/**
 * A held firmware as its release record says, one FUS answered before as it said: "refused" while its refusal is
 * recent, "ask" for one FUS has not answered.
 */
async function knownFirmware(
	env: Env,
	held: ReadonlySet<string>,
	fw: Candidate,
	today: string,
): Promise<ReadFirmware | "refused" | "ask"> {
	if (held.has(fw.build)) {
		const r = await readRecord(env.BUCKET, keys.release("samsung", fw.build), releaseSchema);
		if (r === null) throw new Error(`${fw.build}: listed, then gone`);
		if (r.released === undefined) throw new Error(`${fw.build}: its release record has no build day`);
		return { ...fw, major: Number.parseInt(r.version, 10), released: r.released, name: null };
	}
	const answer = await readRecord(env.BUCKET, keys.galaxyFirmware(fw.build), firmwareAnswerSchema);
	if (answer === null) return "ask";
	if ("refused" in answer) return reaskDue(answer.refused, today) ? "ask" : "refused";
	return { ...fw, ...answer };
}

/** Models asked about in one step: a few minutes at most, its progress kept. */
const MODELS_PER_STEP = 10;

/** A phone under each sales code it is asked under, with its builds, until one predates the scope; what was answered is kept. */
async function listPhone(
	env: Env,
	phone: GalaxyPhone,
	before: ModelProbes,
	today: string,
): Promise<{ readonly listed: ListedFirmware[]; readonly probes: ModelProbes }> {
	const { salesCodes, releasedSince } = env.SCOPE.samsung;
	const probes: ModelProbes = { oldest: before.oldest, answers: { ...before.answers } };
	const listed: ListedFirmware[] = [];
	for (const region of salesCodesToAsk(salesCodes, before.answers, today)) {
		if (!mayLaunchSince(probes, releasedSince)) break;
		const versions = await fetchVersions(phone.model, region);
		const builds = versions.flatMap((v) => v.split("/")[1] ?? []);
		const newest = builds[0];
		probes.answers[region] = newest === undefined ? { refused: today } : { package: packageOf(newest) };
		const oldest = oldestMonth(builds, today);
		if (oldest !== undefined && (probes.oldest === null || oldest < probes.oldest)) probes.oldest = oldest;
		if (newest !== undefined) listed.push({ ...phone, region, versions });
	}
	if (JSON.stringify(probes) !== JSON.stringify(before))
		await putJson(env.BUCKET, keys.galaxyModel(phone.model), probes);
	return { listed, probes };
}

/** The scoped phones a past check has not seen launch before the scope, newest generation first, with what is known of them. */
async function openPhones(
	env: Env,
): Promise<Array<{ readonly phone: GalaxyPhone; readonly probes: ModelProbes }>> {
	const scope = env.SCOPE.samsung;
	const phones = allOrThrow(
		"Galaxy models",
		await fanOut(await fetchPhones(scope), env.FEED_CONCURRENCY.galaxyReads, async (phone) => ({
			phone,
			probes: (await readRecord(env.BUCKET, keys.galaxyModel(phone.model), modelProbesSchema)) ?? NO_PROBES,
		})),
	);
	const bound = new LaunchBound(scope.releasedSince);
	return phones
		.filter((p) => bound.seen(p.phone, p.probes))
		.filter((p) => bound.open(p.phone))
		.toSorted((a, b) => newestGenerationFirst(a.phone, b.phone));
}

/**
 * The scoped phones out since the scope's `releasedSince`, under each sales code that lists them, with their builds;
 * a phone seen launching earlier, or of a generation that did, is not asked about.
 */
async function listGalaxy(env: Env, today: string, steps: Steps): Promise<ListedFirmware[]> {
	const { releasedSince } = env.SCOPE.samsung;
	const phones = await steps("models", () => openPhones(env));
	const bound = new LaunchBound(releasedSince);
	const all: ListedFirmware[] = [];
	for (const batch of chunks(phones, MODELS_PER_STEP)) {
		const asked = await steps(`version.xml ${batch[0]?.phone.model ?? ""}`, async () => {
			const out: Array<{
				readonly phone: GalaxyPhone;
				readonly listed: ListedFirmware[];
				readonly probes: ModelProbes;
			}> = [];
			// One request at a time: Samsung's servers block a burst.
			for (const { phone, probes } of batch) {
				if (!bound.open(phone)) continue;
				const answered = await listPhone(env, phone, probes, today);
				bound.seen(phone, answered.probes);
				out.push({ phone, ...answered });
			}
			return out;
		});
		for (const a of asked) if (bound.seen(a.phone, a.probes)) all.push(...a.listed);
	}
	return [...Map.groupBy(all, (l) => l.model).values()]
		.filter((ls) =>
			launchedSince(
				ls.flatMap((l) => l.versions.flatMap((v) => v.split("/")[1] ?? [])),
				releasedSince,
				today,
			),
		)
		.flat();
}

export async function checkGalaxy(env: Env, today: string, steps: Steps): Promise<GalaxyBuild[]> {
	const listed = await listGalaxy(env, today, steps);
	const held = new Set(
		await steps("held", async () => (await heldReleases(env.BUCKET, "samsung")).map((k) => k.id[0])),
	);
	const known = await steps("known firmware", async () =>
		allOrThrow(
			"firmware",
			await fanOut(candidates(listed, today), env.FEED_CONCURRENCY.galaxyReads, async (fw) => ({
				fw,
				known: await knownFirmware(env, held, fw, today),
			})),
		),
	);
	const read = known.flatMap((k) => (typeof k.known === "object" ? [k.known] : []));
	// One at a time: FUS blocks a burst. A firmware still failing once its step's retries are spent waits for the next
	// check, its error kept in that step.
	for (const { fw } of known.filter((k) => k.known === "ask")) {
		const answer = await steps(`FUS ${fw.build}`, () => askFus(env, fw, today)).catch(() => null);
		if (answer !== null) read.push(answer);
	}
	await steps("devices", async () => {
		const { records, names } = galaxyDevices(read);
		const db = indexDb(env.DB);
		await devicesSynced(env, "samsung", {
			names: await syncLabels(db, "device", "name", names, FUS_INFORM),
			devices: await syncDevices(db, records),
		});
		return records.length;
	});
	return planGalaxy(env.SCOPE, read, held);
}
