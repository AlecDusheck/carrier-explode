/** Pixel and Galaxy modem configurations as the pages read them: a carrier's, a build's firmware and the configurations it carries, and their band combinations. */

import { error } from "@sveltejs/kit";
import {
	modemConfigsOf,
	shippedModemConfigs,
	sourceModemConfigs,
	type CarrierModemConfig,
	type NamedModemConfig,
	type ShippedModemConfig,
} from "@carrier-explode/db";
import { keys } from "@carrier-explode/storage";
import { bandCombinationsSchema, modemConfigSchema } from "@carrier-explode/schema/records";
import type {
	BandCombination,
	ModemConfig,
	DeviceReleasePlatform,
	SourceKey,
} from "@carrier-explode/schema/types";
import type { BuildModem } from "../builds";
import type { Ver } from "#lib/types.ts";
import { cached, perRequest } from "../cache";
import { deviceNames, deviceOrder, resolve, shippedModems, type Resolved } from "../catalog";
import { db, indexVersion } from "../db";
import { mustRelease } from "../releases";
import { readModemJson } from "../store";

const modemConfigOf = perRequest((sha: string) => readModemJson(keys.modemConfig(sha), modemConfigSchema));

async function mustConfig(sha: string): Promise<ModemConfig> {
	const config = await modemConfigOf(sha);
	if (!config) error(404, `${keys.modemConfig(sha)} is not in the bucket.`);
	return config;
}

export interface ShownModem {
	readonly modem: CarrierModemConfig;
	readonly config: ModemConfig;
	/** Its firmware's page, as getBuildModems names it: the newest Pixel running the firmware. */
	readonly firmware: string;
}

const shippedConfigs = perRequest(async (): Promise<ShippedModemConfig[]> =>
	cached(`shipped-modem-configs:v1:${await indexVersion()}`, async () => shippedModemConfigs(await db())),
);

const sourceConfigs = perRequest(async (key: SourceKey): Promise<CarrierModemConfig[]> =>
	cached(`source-modem-configs:v1:${key}:${await indexVersion()}`, async () =>
		sourceModemConfigs(await db(), key, await shippedConfigs()),
	),
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

export interface ModemFirmware {
	readonly modem: BuildModem;
	readonly configs: readonly NamedModemConfig[];
}

/** The firmware a device runs in a build, and the configurations it carries; null when the build has none for it. */
export async function getModemFirmware(
	platform: DeviceReleasePlatform,
	build: string,
	device: string,
): Promise<ModemFirmware | null> {
	const modem = (await buildModems(platform, build)).find((m) => m.devices.some((d) => d.code === device));
	if (modem === undefined) return null;
	return { modem, configs: await modemConfigsOf(await db(), platform, build, device) };
}

/** One stored modem configuration, decoded. */
export const getModemConfigBySha = mustConfig;

/** One stored list of band combinations. */
export async function getModemCombos(key: string): Promise<readonly BandCombination[]> {
	const list = await readModemJson(keys.combos(key), bandCombinationsSchema);
	if (!list) error(404, `${keys.combos(key)} is not in the bucket.`);
	return list;
}
