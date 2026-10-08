/**
 * The IPSW feed: the in-scope iPhones' IPSWs from ipsw.me, and their betas from AppleDB, minus the builds the bucket
 * holds. AppleDB also gives every device's boards, release day and name.
 */

import * as v from "valibot";

import { indexDb, syncDevices, syncLabels, type ListedDevice } from "@carrier-explode/db";
import { fetchWithRetry } from "@carrier-explode/http";
import type { Label } from "@carrier-explode/schema/records";
import type { Device } from "@carrier-explode/schema/types";
import type { Env } from "../env.ts";
import { allOrThrow, fanOut } from "../fan-out.ts";
import { devicesSynced } from "../queues.ts";
import { iosInScope } from "../scope.ts";
import { betaCandidates, listedBetas, listedReleases, planIos, type IosBuild } from "./plan.ts";

const IPSW_ME = "https://api.ipsw.me/v4";
const APPLEDB = "https://api.appledb.dev/ios/";
const APPLEDB_DEVICES = "https://api.appledb.dev/device/main.json";

async function getJson<S extends v.GenericSchema>(url: string, schema: S): Promise<v.InferOutput<S>> {
	const body: unknown = await (await fetchWithRetry(url)).json();
	return v.parse(schema, body);
}

/** YYYY-MM-DD; ipsw.me stamps `2026-09-15T17:05:25Z`. */
const day = (stamp: string | null | undefined): { released?: string } =>
	stamp ? { released: stamp.slice(0, 10) } : {};

/** An ipsw.me firmware entry, with the device it was listed under. */
export interface Firmware {
	readonly version: string;
	readonly build: string;
	readonly device: string;
	readonly url: string;
	readonly released?: string;
}

const DEVICES = `${IPSW_ME}/devices`;
const DeviceList = v.array(v.looseObject({ identifier: v.string(), name: v.string() }));
const DeviceFirmwares = v.looseObject({
	firmwares: v.array(
		v.looseObject({
			version: v.string(),
			buildid: v.string(),
			url: v.string(),
			releasedate: v.nullish(v.string()),
		}),
	),
});

/** Every device ipsw.me knows (iPhone, iPad, Watch and more), with the name Apple sells it as. */
const appleDevices = async (): Promise<{
	readonly evidence: string;
	readonly names: ReadonlyArray<Pick<Label, "code" | "value">>;
}> => ({
	evidence: DEVICES,
	names: (await getJson(DEVICES, DeviceList)).map((d) => ({ code: d.identifier, value: d.name })),
});

/** Every Apple device AppleDB records with a board and a release day (ipsw.me lists no Watch it has no IPSW for), and their names. */
async function appleDbDevices(): Promise<{
	readonly records: ListedDevice[];
	readonly names: ReadonlyArray<Pick<Label, "code" | "value">>;
}> {
	const raw = await getJson(APPLEDB_DEVICES, appleDbDevicesSchema);
	return {
		records: appleDeviceRecords(raw).map(({ code, released, boards }) => ({
			code,
			platform: "ios",
			released,
			boards,
		})),
		names: appleDeviceNames(raw),
	};
}

/** Every IPSW ipsw.me lists for a device. */
async function deviceFirmwares(device: string): Promise<Firmware[]> {
	const d = await getJson(`${IPSW_ME}/device/${encodeURIComponent(device)}?type=ipsw`, DeviceFirmwares);
	// oxlint-disable-next-line oxc/no-map-spread -- the spreads only leave out absent optional fields; nothing is copied.
	return d.firmwares.map((f) => ({
		version: f.version,
		build: f.buildid,
		device,
		url: f.url,
		...day(f.releasedate),
	}));
}

export interface IpswRef {
	readonly device: string;
	readonly url: string;
}

/** AppleDB's index: `iOS;24B5089g`, `watchOS;...`, `iOS;24B5084k-sim`... */
async function appledbKeys(): Promise<string[]> {
	return getJson(`${APPLEDB}index.json`, v.array(v.string()));
}

export interface AppleDbEntry {
	readonly version: string;
	readonly build: string;
	readonly beta: boolean;
	readonly released?: string;
	/** iPhone -> IPSW URL, only the iPhones with a link. */
	readonly ipsws: ReadonlyMap<string, string>;
}

const AppleDbFirmware = v.looseObject({
	version: v.string(),
	build: v.string(),
	beta: v.optional(v.boolean(), false),
	released: v.optional(v.string()),
	/** device -> { ipsw }, or for an alias a string naming another device. */
	devices: v.optional(v.record(v.string(), v.unknown()), {}),
});

const IpswLink = v.looseObject({ ipsw: v.pipe(v.string(), v.minLength(1)) });

export function appledbEntry(raw: unknown): AppleDbEntry {
	const e = v.parse(AppleDbFirmware, raw);
	const ipsws = new Map<string, string>();
	for (const [device, entry] of Object.entries(e.devices)) {
		if (device.startsWith("iPhone") && v.is(IpswLink, entry)) ipsws.set(device, entry.ipsw);
	}
	return { version: e.version, build: e.build, beta: e.beta, ...day(e.released), ipsws };
}

async function appledbFirmware(build: string): Promise<AppleDbEntry> {
	return appledbEntry(await getJson(`${APPLEDB}${encodeURIComponent(`iOS;${build}`)}.json`, v.unknown()));
}

const DAY = /^\d{4}(-\d{2}){0,2}$/;

export const appleDbDevicesSchema = v.array(
	v.looseObject({
		name: v.string(),
		identifier: v.array(v.string()),
		board: v.array(v.string()),
		/** A day, or one per model or colour that followed. */
		released: v.optional(v.union([v.string(), v.array(v.string())])),
	}),
);

/** One record per product type: several AppleDB records can share one (a model, a case), so their boards merge and the earliest day wins. */
export function appleDeviceRecords(records: v.InferOutput<typeof appleDbDevicesSchema>): Device[] {
	const byCode = new Map<string, { released: string; boards: string[] }>();
	for (const r of records) {
		const [first] = [r.released ?? []]
			.flat()
			.filter((d) => DAY.test(d))
			.toSorted();
		if (first === undefined || r.board.length === 0) continue;
		for (const code of r.identifier) {
			const held = byCode.get(code);
			byCode.set(
				code,
				held === undefined
					? { released: first, boards: [...r.board] }
					: {
							released: first < held.released ? first : held.released,
							boards: [...new Set([...held.boards, ...r.board])],
						},
			);
		}
	}
	return [...byCode].map(([code, { released, boards }]) => ({ code, family: "apple", released, boards }));
}

/** Each product type's name, where its records agree on one: left and right AirPods share a code. */
export function appleDeviceNames(
	records: v.InferOutput<typeof appleDbDevicesSchema>,
): Array<Pick<Label, "code" | "value">> {
	const names = Map.groupBy(
		records.flatMap((r) => r.identifier.map((code) => ({ code, value: r.name }))),
		(n) => n.code,
	);
	return [...names].flatMap(([code, ns]) =>
		new Set(ns.map((n) => n.value)).size === 1 && ns[0] ? [{ code, value: ns[0].value }] : [],
	);
}

export async function checkIos(
	env: Env,
	held: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<IosBuild[]> {
	// Apple's device names, boards and release days, so pages name, match and order phones from the feeds.
	const [names, { records, names: appleDbNames }] = await Promise.all([appleDevices(), appleDbDevices()]);
	const db = indexDb(env.DB);
	const named = await syncLabels(db, "device", "name", names.names, names.evidence);
	const devices = await syncDevices(db, records);
	// AppleDB records phones before ipsw.me lists them, and ipsw.me answers 404 for one it does not.
	const listed = new Set(names.names.map((n) => n.code));
	const recorded = new Set(records.map((d) => d.code));
	const alsoNamed = await syncLabels(
		db,
		"device",
		"name",
		appleDbNames.filter((n) => recorded.has(n.code) && !listed.has(n.code)),
		APPLEDB_DEVICES,
	);
	await devicesSynced(env, "ios", { devices, names: named + alsoNamed });
	const phones = records.filter((d) => iosInScope(env.SCOPE, d) && listed.has(d.code)).map((d) => d.code);
	const releases = allOrThrow(
		"ipsw.me firmwares",
		await fanOut(phones, env.FEED_CONCURRENCY.appleCatalogs, deviceFirmwares),
	).flat();
	const betas = allOrThrow(
		"AppleDB records",
		await fanOut(
			betaCandidates(await appledbKeys(), releases),
			env.FEED_CONCURRENCY.appleCatalogs,
			appledbFirmware,
		),
	);
	return planIos(
		env.SCOPE,
		[...listedReleases(releases), ...listedBetas(betas)],
		records,
		held,
		new Date().toISOString().slice(0, 10),
	);
}
