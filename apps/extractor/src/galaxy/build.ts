/** A Galaxy build's steps: the CSC and CP members in Worker steps, the AP member's IMS service in the container, then the release. */

import * as v from "valibot";

import { compareUtf8, packFiles, unpackFiles } from "@carrier-explode/binary";
import { decodeOmcText, omcVersion, openOmc, PACK_FILES, packOmc } from "@carrier-explode/decode-samsung";
import { androidModemSchema } from "@carrier-explode/schema/records";
import {
	sourceKey,
	type AndroidArtifact,
	type AndroidModem,
	type SamsungRelease,
	type SourceKey,
} from "@carrier-explode/schema/types";
import { keys, parseRecord, putJson } from "@carrier-explode/storage";
import type { ContainerJob } from "../container-protocol.ts";
import { normWriter, storeNormalized } from "../normalize.ts";
import { hashed, heldShas, readBytes, storeModemConfigs, type Hashed } from "../store.ts";
import type { UnitContext } from "../unit.ts";
import { apOutputSchema, type ApParams } from "./ap.ts";
import { androidMajor, openGalaxyFirmware } from "./firmware.ts";
import { carrierPacks, cpModem, GalaxyError } from "./members.ts";
import type { GalaxyBuild } from "./plan.ts";

/** The CSC step's output: the firmware's build day, and each sales code's omc.info as text (its raw pack waits under tmp/). */
const cscOutputSchema = v.object({
	released: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
	infos: v.record(v.pipe(v.string(), v.minLength(1)), v.string()),
});
type CscOutput = v.InferOutput<typeof cscOutputSchema>;

/** A step's JSON text, checked against its schema. */
const parseOutput = <S extends v.GenericSchema>(schema: S, text: string): v.InferOutput<S> =>
	v.parse(schema, parseRecord("step output", text));

/** A sales code's conf/ files, held for the release step: its pack waits on the AP member's IMS operator. */
const rawPackKey = (u: UnitContext, code: string): string => keys.tmp(u.instance, `csc/${code}`);

const packKey = (code: string): SourceKey<"samsung"> =>
	sourceKey({ platform: "samsung", kind: "carrier", name: code });

/** The CSC member streamed: each sales code's conf/ files to tmp/. Returns the build day and each code's omc.info, as JSON text. */
export async function csc(fw: GalaxyBuild, u: UnitContext): Promise<string> {
	const { firmware, released } = await openGalaxyFirmware(fw);
	const major = androidMajor(firmware);
	if (major !== fw.major)
		throw new GalaxyError(`${fw.build}: planned as Android ${fw.major}, its AP member names ${major}`);
	const infos: Record<string, string> = {};
	for (const [code, pack] of await carrierPacks(firmware)) {
		const info = pack.files.get(PACK_FILES.omcInfo);
		if (info === undefined) throw new GalaxyError(`${pack.path}: no ${PACK_FILES.omcInfo}`);
		await u.bucket.put(rawPackKey(u, code), packFiles(pack.files));
		infos[code] = decodeOmcText(info);
	}
	return JSON.stringify({ released, infos } satisfies CscOutput);
}

/** The release's modems: none for an Exynos CP. */
const cpOutputSchema = v.array(androidModemSchema);

/** The CP member streamed: its modem configurations stored and normalized. Returns the release's modems, as JSON text. */
export async function cp(fw: GalaxyBuild, u: UnitContext): Promise<string> {
	const { firmware } = await openGalaxyFirmware(fw);
	const extracted = await cpModem(firmware);
	if (extracted === null) return JSON.stringify([] satisfies AndroidModem[]);
	const w = normWriter(u.bucket);
	const modem: AndroidModem = {
		family: extracted.family,
		firmware: extracted.firmware,
		devices: [fw.model],
		configs: await storeModemConfigs(u.db, extracted.archives, (a, bytes) => storeNormalized(w, a, bytes)),
	};
	return JSON.stringify([modem] satisfies AndroidModem[]);
}

/** The galaxy.ap container job: the IMS operator of each sales code the CSC step found, from the AP member's IMS service. */
export function apJob(fw: GalaxyBuild, cscText: string): ContainerJob {
	const params: ApParams = {
		model: fw.model,
		region: fw.region,
		version: fw.version,
		build: fw.build,
		infos: parseOutput(cscOutputSchema, cscText).infos,
	};
	return { job: "galaxy.ap", params };
}

/** Each pack with its IMS operator stored and normalized unless held; releases/samsung/<build>.json written last. */
export async function release(
	fw: GalaxyBuild,
	cscText: string,
	cpText: string,
	apText: string,
	u: UnitContext,
): Promise<void> {
	const { released, infos } = parseOutput(cscOutputSchema, cscText);
	const modems = parseOutput(cpOutputSchema, cpText);
	const operators = parseOutput(apOutputSchema, apText);
	const packs: Array<{ readonly code: string; readonly a: Hashed }> = [];
	for (const code of Object.keys(infos).toSorted(compareUtf8)) {
		const operator = operators[code];
		if (operator === undefined)
			throw new GalaxyError(`${fw.build}: the AP job gave no IMS operator for ${code}`);
		packs.push({
			code,
			a: await hashed(packOmc(unpackFiles(await readBytes(u.bucket, rawPackKey(u, code))), operator)),
		});
	}
	const held = await heldShas(
		u.db,
		packs.map((p) => p.a.sha),
	);
	const sources: Record<SourceKey<"samsung">, AndroidArtifact[]> = {};
	const w = normWriter(u.bucket);
	for (const { code, a } of packs) {
		// Decoded before it is stored: a pack this decoder cannot read fails the step, not a page.
		const pack = openOmc(a.bytes);
		if (!held.has(a.sha))
			await storeNormalized(w, { kind: "samsung.omc", sha: a.sha, source: packKey(code) }, a.bytes);
		sources[packKey(code)] = [
			{ sha: a.sha, version: omcVersion(pack.omcInfo), size: a.bytes.length, devices: [fw.model] },
		];
	}
	const record: SamsungRelease = {
		platform: "samsung",
		id: fw.build,
		version: String(fw.major),
		released,
		devices: [fw.model],
		extractedAt: new Date().toISOString(),
		sources,
		modems,
	};
	await putJson(u.bucket, keys.release("samsung", fw.build), record);
}
