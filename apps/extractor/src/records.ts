/** A unit's R2 records, read and turned into the rows packages/db writes: one release record (a Pixel's is its device's part of the build) or OTA files. */

import * as v from "valibot";

import { compareUtf8 } from "@carrier-explode/binary";
import type { Holding, ModemConfigRow, ModemRow, OtaFileRow, ReleaseRows } from "@carrier-explode/db";
import { firmwareFamily, releaseSortKey, type DeviceOrder } from "@carrier-explode/schema";
import { otaFilesSchema, pixelOtaFilesSchema, releaseSchema } from "@carrier-explode/schema/records";
import {
	isSourceKey,
	MAIN_LINE,
	type AndroidArtifact,
	type AndroidModem,
	type Release,
	type SourceKey,
} from "@carrier-explode/schema/types";
import { keys, readRecord, type OtaFeed, type ReleaseKey } from "@carrier-explode/storage";
import { DataError } from "./errors.ts";

/** A normalized object the unit refers to: a Profile (keys.profile) or a ModemConfig (keys.modemConfig). */
export interface NormRef {
	readonly sha: string;
	readonly kind: "profile" | "modem";
}

const normRef = (kind: NormRef["kind"], sha: string): NormRef => ({ sha, kind });

/** What indexing writes for a release record: its release's rows as the record alone states them, and its copies. */
export interface ReleaseFacts {
	readonly rows: ReleaseRows;
	readonly holding: Extract<Holding, { readonly kind: "release" }>;
	readonly norm: readonly NormRef[];
}

/** What indexing writes for one OTA file. */
export interface OtaFacts {
	readonly file: OtaFileRow;
	readonly holding: Extract<Holding, { readonly kind: "ota" }>;
	readonly norm: readonly NormRef[];
}

export async function readHeld<T>(
	bucket: R2Bucket,
	key: string,
	schema: v.GenericSchema<unknown, T>,
): Promise<T> {
	const record = await readRecord(bucket, key, schema);
	if (record === null) throw new DataError(`${key}: missing`);
	return record;
}

/** A record's sources, keyed as its schema checked them. */
function bySource<T>(record: Readonly<Record<string, T>>): Array<readonly [SourceKey, T]> {
	return Object.entries(record).map(([key, value]) => {
		if (!isSourceKey(key)) throw new Error(`${key}: not a source key`);
		return [key, value] as const;
	});
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const recordKey = (k: ReleaseKey): string => keys.release(k.platform, ...k.id);

/** The device a record is the part of its release for; null for a record that is the whole release. */
export const partDevice = (k: ReleaseKey): string | null => (k.platform === "android" ? k.id[1] : null);

/** The release record at `k`, which must be what its key names. */
export async function readRelease(bucket: R2Bucket, k: ReleaseKey): Promise<Release> {
	const key = recordKey(k);
	const r = await readHeld(bucket, key, releaseSchema);
	const device = partDevice(k);
	if (r.platform !== k.platform || r.id !== k.id[0] || (device !== null && !same(r.devices, [device])))
		throw new DataError(`${key}: holds ${r.platform} ${r.id} for ${r.devices.join(", ")}`);
	return r;
}

/** Copies with every device an artifact names as its own line. */
const deviceCopies = (sources: Readonly<Record<string, readonly AndroidArtifact[]>>): Holding["copies"] =>
	bySource(sources).flatMap(([source, artifacts]) =>
		artifacts.flatMap((a) => a.devices.map((line) => ({ source, line, sha: a.sha, version: a.version }))),
	);

const modemRows = (
	modems: readonly AndroidModem[],
): { modems: ModemRow[]; configs: ModemConfigRow[]; norm: NormRef[] } => ({
	modems: modems.map((m) => ({
		name: m.firmware,
		family: firmwareFamily(m.family, m.firmware),
		devices: m.devices,
		package: null,
		size: null,
		kind: null,
	})),
	configs: modems.flatMap((m) =>
		m.devices.flatMap((device) => Object.entries(m.configs).map(([label, sha]) => ({ device, label, sha }))),
	),
	norm: modems.flatMap((m) => Object.values(m.configs).map((sha) => normRef("modem", sha))),
});

/** A Pixel's or Galaxy's record's lines: its devices. */
function deviceLines(r: Release): readonly [string, ...string[]] {
	const [first, ...rest] = r.devices;
	if (first === undefined) throw new Error(`${r.platform} ${r.id}: a release record for no device`);
	return [first, ...rest];
}

export function releaseFacts(r: Release, order: DeviceOrder): ReleaseFacts {
	const header = {
		id: r.id,
		version: r.version,
		released: r.released ?? null,
		devices: r.devices.toSorted(order),
		sortKey: releaseSortKey(r),
	};
	switch (r.platform) {
		case "ios": {
			const sources = bySource(r.sources);
			return {
				rows: {
					release: {
						...header,
						platform: r.platform,
						label: r.label,
						prerelease: r.prerelease,
						sourceCount: sources.length,
					},
					modems: r.modems.map((m) => ({
						name: m.package.name,
						family: m.family,
						devices: m.devices,
						package: m.package.sha,
						size: m.package.size,
						kind: m.package.kind,
					})),
					configs: [],
				},
				holding: {
					kind: "release",
					id: r.id,
					lines: [MAIN_LINE],
					copies: sources.map(([source, a]) => ({ source, line: MAIN_LINE, sha: a.sha, version: a.version })),
				},
				norm: sources.map(([, a]) => normRef("profile", a.sha)),
			};
		}
		case "android": {
			const m = modemRows(r.modems);
			const artifacts = Object.values(r.sources).flat();
			return {
				rows: {
					release: {
						...header,
						platform: r.platform,
						patch: r.patch,
						sourceCount: Object.keys(r.sources).length,
					},
					modems: m.modems,
					configs: m.configs,
				},
				holding: { kind: "release", id: r.id, lines: deviceLines(r), copies: deviceCopies(r.sources) },
				norm: [...artifacts.map((a) => normRef("profile", a.sha)), ...m.norm],
			};
		}
		case "samsung": {
			const m = modemRows(r.modems);
			return {
				rows: {
					release: { ...header, platform: r.platform, sourceCount: Object.keys(r.sources).length },
					modems: m.modems,
					configs: m.configs,
				},
				holding: { kind: "release", id: r.id, lines: deviceLines(r), copies: deviceCopies(r.sources) },
				norm: [
					...Object.values(r.sources)
						.flat()
						.map((a) => normRef("profile", a.sha)),
					...m.norm,
				],
			};
		}
	}
}

/** A row's fields but its devices (and a header's source count), in key order: what every device's record of a build must agree on. */
const shared = (r: object): unknown =>
	Object.entries({ ...r, devices: [], sourceCount: 0 }).toSorted(([a], [b]) => a.localeCompare(b));

/** A device's configurations' labels and shas, in label order. */
const configsOf = (configs: readonly ModemConfigRow[], device: string): unknown =>
	configs
		.filter((c) => c.device === device)
		.map(({ label, sha }) => [label, sha] as const)
		.toSorted(([a], [b]) => compareUtf8(a, b));

/**
 * A build's rows once `part` (one device's record of it) is that device's: the other devices' rows as the index holds
 * them, with the part's. The device joins a modem other devices run when it carries the same firmware and configurations.
 */
export function withPart(
	held: ReleaseRows | undefined,
	part: ReleaseRows,
	device: string,
	order: DeviceOrder,
): ReleaseRows {
	if (held === undefined) return part;
	const { id } = part.release;
	if (!same(shared(held.release), shared(part.release)))
		throw new Error(`${id}: ${device}'s record disagrees with its other devices' on the build's header`);
	const modems: ModemRow[] = held.modems
		.map((m) => ({ ...m, devices: m.devices.filter((d) => d !== device) }))
		.filter((m) => m.devices.length > 0);
	const otherConfigs = held.configs.filter((c) => c.device !== device);
	const ownConfigs = configsOf(part.configs, device);
	for (const m of part.modems) {
		const joined = modems.find(
			(o) =>
				same(shared(o), shared(m)) && o.devices.every((d) => same(configsOf(otherConfigs, d), ownConfigs)),
		);
		if (joined === undefined) modems.push(m);
		else modems[modems.indexOf(joined)] = { ...joined, devices: [...joined.devices, device].toSorted() };
	}
	return {
		release: {
			...part.release,
			devices: [
				...new Set([...held.release.devices.filter((d) => d !== device), ...part.release.devices]),
			].toSorted(order),
		},
		modems,
		configs: [...otherConfigs, ...part.configs],
	};
}

/** Each (source, line) a file is listed for once, with the OS versions or trains it is listed under. */
function listedCopies(
	sha: string,
	version: string,
	listings: ReadonlyArray<{ readonly source: SourceKey; readonly line: string; readonly os: string | null }>,
): Extract<Holding, { readonly kind: "ota" }>["copies"] {
	const grouped = Map.groupBy(listings, (l) => JSON.stringify([l.source, l.line]));
	return [...grouped.values()].flatMap(([first, ...rest]) =>
		first === undefined
			? []
			: [
					{
						source: first.source,
						line: first.line,
						sha,
						version,
						os: [...new Set([first, ...rest].flatMap((l) => l.os ?? []))].toSorted(),
					},
				],
	);
}

export async function otaFacts(bucket: R2Bucket, feed: OtaFeed, url: string): Promise<OtaFacts> {
	const key = await keys.otaFile(feed, url);
	if (feed === "apple") {
		const f = await readHeld(bucket, key, otaFilesSchema.item);
		return {
			file: {
				url: f.url,
				sha: f.sha,
				version: f.version,
				published: f.published ?? null,
				digests: f.digests,
			},
			holding: {
				kind: "ota",
				url: f.url,
				copies: listedCopies(
					f.sha,
					f.version,
					f.listings.map((l) => ({ source: l.source, line: l.model ?? MAIN_LINE, os: l.os })),
				),
			},
			norm: [normRef("profile", f.sha)],
		};
	}
	const f = await readHeld(bucket, key, pixelOtaFilesSchema.item);
	return {
		file: { url: f.url, sha: f.sha, version: f.version, published: f.published ?? null, digests: {} },
		holding: {
			kind: "ota",
			url: f.url,
			copies: listedCopies(
				f.sha,
				f.version,
				f.listings.map((l) => ({ source: l.source, line: l.device, os: l.train })),
			),
		},
		norm: [normRef("profile", f.sha)],
	};
}
