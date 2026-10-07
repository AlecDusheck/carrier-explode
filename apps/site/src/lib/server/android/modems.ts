/** Pixel and Galaxy modem configurations as the pages read them: a carrier's, a build's firmware and its own configurations, and their band combinations. */

import { error } from "@sveltejs/kit";
import * as v from "valibot";
import { modemConfigsOf, sourceModemConfigs, type CarrierModemConfig } from "@carrier-explode/db";
import { sha256Hex } from "@carrier-explode/binary";
import { keys } from "@carrier-explode/storage";
import { bandCombinationsSchema, modemConfigSchema } from "@carrier-explode/schema/records";
import {
	MODEM_SCOPES,
	PROFILE_SCHEMA,
	type BandCombination,
	type ModemConfig,
	type DeviceReleasePlatform,
	type SourceKey,
} from "@carrier-explode/schema/types";
import type { BuildModem } from "../builds";
import type { Ver } from "#lib/types.ts";
import { cached, perRequest } from "../cache";
import { deviceNames, deviceOrder, resolve, shippedModems, type Resolved } from "../catalog";
import { db } from "../db";
import { mustRelease } from "../releases";
import { readJson } from "../store";

const modemConfigOf = perRequest((sha: string) => readJson(keys.norm(sha), modemConfigSchema));

async function mustConfig(sha: string): Promise<ModemConfig> {
	const config = await modemConfigOf(sha);
	if (!config) error(404, `${keys.norm(sha)} is not in the bucket.`);
	return config;
}

export interface ShownModem {
	readonly modem: CarrierModemConfig;
	readonly config: ModemConfig;
	/** Its firmware's page, as getBuildModems names it: the newest Pixel running the firmware. */
	readonly firmware: string;
}

const sourceConfigs = perRequest(async (key: SourceKey): Promise<CarrierModemConfig[]> =>
	sourceModemConfigs(await db(), key),
);

/** The modem configurations the source's own SIM rules select on a Pixel, from the newest release that has them. */
export async function carrierModems(r: Resolved): Promise<CarrierModemConfig[]> {
	return (await sourceConfigs(r.key)).filter((c) => c.platform === "android" && c.devices.includes(r.line));
}

/** The modem configurations the carrier's SIMs select on the version's device; none on a Pixel without. */
export async function getAndroidModems(at: Ver): Promise<readonly ShownModem[]> {
	const r = await resolve(at);
	if (r.ref.platform !== "android") error(400, `${at.source} is not an Android source.`);
	const [mine, order] = await Promise.all([carrierModems(r), deviceOrder("android")]);
	return Promise.all(
		mine.map(async (c): Promise<ShownModem> => ({
			modem: c,
			config: await mustConfig(c.sha),
			firmware: c.devices.toSorted(order)[0] ?? r.line,
		})),
	);
}

/** A Pixel build's or Galaxy firmware's modem firmwares, each named by the newest device running it, newest first. */
export async function buildModems(platform: DeviceReleasePlatform, build: string): Promise<BuildModem[]> {
	const [release, shipped, names] = await Promise.all([
		mustRelease(platform, build),
		shippedModems(platform, build),
		deviceNames(platform),
	]);
	// The index lists a build's devices newest first.
	const rank = (device: string): number => release.devices.indexOf(device);
	return shipped
		.map((m): BuildModem => {
			const devices = m.devices
				.toSorted((a, b) => rank(a) - rank(b))
				.map((code) => ({ code, name: names.get(code) ?? code }));
			const id = devices[0]?.code;
			if (id === undefined) error(500, `${build}: a ${m.family} modem serves no device.`);
			return { id, label: m.familyName, firmware: m.name, devices };
		})
		.toSorted((a, b) => rank(a.id) - rank(b.id));
}

/** A configuration the firmware loads whatever the carrier: a base its carrier configurations are built on, or its own. */
export interface FirmwareConfig {
	readonly label: string;
	readonly sha: string;
	readonly kind: "base" | "own";
}

/** What a firmware page reads of each config: its scope and base, not its items. */
const scopeSchema = v.object({
	label: v.string(),
	scope: v.picklist(MODEM_SCOPES),
	base: v.nullable(v.string()),
});
const READ_AT_ONCE = 6;

/** The firmware's own configurations: every config's base, then the configs of scope "firmware". */
async function firmwareConfigs(configShas: readonly string[]): Promise<FirmwareConfig[]> {
	const shas = [...new Set(configShas)].toSorted();
	const key = await sha256Hex(new TextEncoder().encode(shas.join("\n")));
	return cached(`firmware-configs:v${PROFILE_SCHEMA}:${key}`, async () => {
		const heads: Array<v.InferOutput<typeof scopeSchema> & { readonly sha: string }> = [];
		for (let i = 0; i < shas.length; i += READ_AT_ONCE) {
			heads.push(
				...(await Promise.all(
					shas.slice(i, i + READ_AT_ONCE).map(async (sha) => {
						const head = await readJson(keys.norm(sha), scopeSchema);
						if (!head) error(500, `${keys.norm(sha)} is not in the bucket.`);
						return Object.assign(head, { sha });
					}),
				)),
			);
		}
		const bases = await Promise.all(
			[...new Set(heads.flatMap((h) => h.base ?? []))].map(async (sha): Promise<FirmwareConfig> => ({
				label: (await mustConfig(sha)).label,
				sha,
				kind: "base",
			})),
		);
		const own = heads
			.filter((h) => h.scope === "firmware")
			.map((h): FirmwareConfig => ({ label: h.label, sha: h.sha, kind: "own" }));
		return [...bases, ...own.toSorted((a, b) => a.label.localeCompare(b.label))];
	});
}

export interface ModemFirmware {
	readonly modem: BuildModem;
	readonly configs: readonly FirmwareConfig[];
}

/** The firmware a device runs in a build, and its own configurations; null when the build has none for it. */
export async function getModemFirmware(
	platform: DeviceReleasePlatform,
	build: string,
	device: string,
): Promise<ModemFirmware | null> {
	const modem = (await buildModems(platform, build)).find((m) => m.devices.some((d) => d.code === device));
	if (modem === undefined) return null;
	const configs = await modemConfigsOf(await db(), platform, build, device);
	return { modem, configs: await firmwareConfigs(configs.map((c) => c.sha)) };
}

/** One stored modem configuration, decoded. */
export const getModemConfigBySha = mustConfig;

/** One stored list of band combinations. */
export async function getModemCombos(key: string): Promise<readonly BandCombination[]> {
	const list = await readJson(keys.combos(key), bandCombinationsSchema);
	if (!list) error(404, `${keys.combos(key)} is not in the bucket.`);
	return list;
}
