/** Android views: a CarrierSettings file on one device line at one version (catalog.ts Ver), decoded. */

import { error } from "@sveltejs/kit";
import {
	configDoc,
	decodeCarrierSettings,
	type ApnItem,
	type CarrierConfigValue,
	type CarrierSettings,
	type ConfigDoc,
} from "@carrier-explode/decode-android";
import {
	canonical,
	diffValues,
	isRecord,
	summariseDiff,
	type DiffCounts,
	type DiffRow,
	type PairKeys,
} from "@carrier-explode/values";
import { base64ToBytes, bytesToHex } from "@carrier-explode/binary";
import type { Json, SourceRef } from "@carrier-explode/schema/types";
import { configGroup, groupOrder } from "#lib/android/setting-groups.ts";
import { keyRules, leafCount, type SelectionRule } from "#lib/settings.ts";
import type { ApnView, Ver, Version } from "#lib/types.ts";
import { decodedVersion, resolve, versionChanges, versionOf, type VersionChanges } from "../catalog";
import { rulesAt } from "../profiles";
import { CARRIER_LIST, carrierListOf, type CarrierListView } from "./carrier-list";
import { carrierModems } from "./modems";

const decoded = decodedVersion("android", decodeCarrierSettings);

/** A config value as plain JSON: what the Files view and the diff read. */
function plainConfig(v: CarrierConfigValue): Json {
	if (v.kind !== "bundle") return v.value;
	return Object.fromEntries(Object.entries(v.value).map(([k, x]) => [k, plainConfig(x)]));
}

const plainConfigs = (s: CarrierSettings): Record<string, Json> =>
	Object.fromEntries(Object.entries(s.configs).map(([k, v]) => [k, plainConfig(v)]));

export interface AndroidVersion {
	readonly source: string;
	readonly ref: SourceRef;
	readonly line: string;
	readonly entry: Version;
	readonly previous: Version | null;
	readonly canonicalName: string;
	/** CarrierSettings.version, the file's own. */
	readonly version: string | undefined;
	/** `modems`: the modem configurations the carrier's SIMs select on this device. */
	readonly counts: {
		readonly settings: number;
		readonly apns: number;
		readonly modems: number;
		readonly files: number;
	};
	/** Fields the decoder did not recognise; nonzero means a proto newer than the decoder. */
	readonly unknownFields: number;
	/** The stored CarrierSettings file, as the Files tab names it. */
	readonly file: AndroidFileRow & { readonly sha: string };
}

export async function getAndroid(v: Ver): Promise<AndroidVersion> {
	const d = await decoded(v);
	const [entry, previous, modems] = await Promise.all([
		versionOf(d, d.entry),
		d.previous ? versionOf(d, d.previous) : null,
		carrierModems(d),
	]);
	return {
		source: d.key,
		ref: d.ref,
		line: d.line,
		entry,
		previous,
		canonicalName: d.file.canonicalName,
		version: d.file.version,
		counts: {
			settings: leafCount(plainConfigs(d.file)),
			apns: d.file.apns.length,
			modems: modems.length,
			// getAndroidFiles' rows: the settings file, its vendor configs and carrier_list.pb.
			files: vendorRows(d.file).length + 2,
		},
		unknownFields: d.file.unknown.length,
		file: { path: settingsPath(d.file), kind: "settings", size: d.size, sha: d.sha },
	};
}

/** The SIM rules the newest build's carrier_list.pb routes to the source, as the index read them. */
export async function getAndroidSelectedBy(v: Ver): Promise<SelectionRule[]> {
	const r = await resolve(v);
	return keyRules((await rulesAt(r.entry, r.key)).routed);
}

export interface AndroidSettings {
	/** Every config key, grouped for reading, as plain values for the value tree. */
	readonly groups: ReadonlyArray<{ readonly title: string; readonly values: Readonly<Record<string, Json>> }>;
	/** CarrierConfigManager's javadoc for the keys shown: all of it is too large to send. */
	readonly docs: Readonly<Record<string, ConfigDoc>>;
}

export async function getAndroidSettings(v: Ver): Promise<AndroidSettings> {
	const { file: settings } = await decoded(v);
	const groups = new Map<string, Record<string, Json>>();
	const docs: Record<string, ConfigDoc> = {};
	for (const [key, value] of Object.entries(settings.configs).toSorted(([a], [b]) => a.localeCompare(b))) {
		const title = configGroup(key);
		groups.set(title, { ...groups.get(title), [key]: plainConfig(value) });
		const doc = configDoc(key);
		if (doc) docs[key] = doc;
	}
	return {
		groups: [...groups]
			.toSorted((a, b) => groupOrder(a[0]) - groupOrder(b[0]) || a[0].localeCompare(b[0]))
			.map(([title, values]) => ({ title, values })),
		docs,
	};
}

export async function getAndroidApns(v: Ver): Promise<ApnView[]> {
	return (await decoded(v)).file.apns.map((a, i): ApnView => ({
		name: a.name ?? null,
		apn: a.value ?? null,
		roles: [...new Set(a.type)],
		root: `apns[${i}]`,
		fields: a,
	}));
}

/** A version's files, as the Files tab lists them: the CarrierSettings file, its vendor configs, and carrier_list.pb's entries naming it. */
export type AndroidFileKind = AndroidFile["kind"];

export interface AndroidFileRow {
	readonly path: string;
	readonly kind: AndroidFileKind;
	readonly size: number;
}

export type AndroidFile =
	| {
			readonly kind: "settings";
			readonly path: string;
			readonly canonicalName: string;
			readonly version: string | null;
			readonly configs: Readonly<Record<string, Json>>;
			readonly docs: Readonly<Record<string, ConfigDoc>>;
			readonly apns: readonly ApnItem[];
			/** Each opens as a file of its own. */
			readonly vendor: readonly AndroidFileRow[];
	  }
	| { readonly kind: "vendor"; readonly path: string; readonly hex: string }
	| ({ readonly kind: "carrier-list"; readonly path: string } & CarrierListView);

/** A part of others.pb has no version of its own (android.ota refuses one that does), so it is named as a part. */
const settingsPath = (s: CarrierSettings): string =>
	s.version === undefined ? `others.pb/${s.canonicalName}` : `${s.canonicalName}.pb`;
const vendorPath = (name: string): string => `vendor_configs/${name}`;

const vendorRows = (s: CarrierSettings): AndroidFileRow[] =>
	s.vendorConfigs.map((c) => ({
		path: vendorPath(c.name),
		kind: "vendor",
		size: c.value ? base64ToBytes(c.value).length : 0,
	}));

export async function getAndroidFiles(v: Ver): Promise<AndroidFileRow[]> {
	const d = await decoded(v);
	const list = await carrierListOf(d);
	return [
		{ path: settingsPath(d.file), kind: "settings", size: d.size },
		...vendorRows(d.file),
		{ path: CARRIER_LIST, kind: "carrier-list", size: list.size },
	];
}

export async function getAndroidFile(v: Ver, path: string): Promise<AndroidFile> {
	const d = await decoded(v);
	if (path === settingsPath(d.file)) {
		const docs = Object.fromEntries(
			Object.keys(d.file.configs).flatMap((k) => {
				const doc = configDoc(k);
				return doc ? [[k, doc]] : [];
			}),
		);
		return {
			kind: "settings",
			path,
			canonicalName: d.file.canonicalName,
			version: d.file.version ?? null,
			configs: plainConfigs(d.file),
			docs,
			apns: d.file.apns,
			vendor: vendorRows(d.file),
		};
	}
	if (path === CARRIER_LIST) return { kind: "carrier-list", path, ...(await carrierListOf(d)) };
	const vendor = d.file.vendorConfigs.find((c) => vendorPath(c.name) === path);
	if (vendor)
		return {
			kind: "vendor",
			path,
			hex: bytesToHex(vendor.value ? base64ToBytes(vendor.value) : new Uint8Array()),
		};
	error(404, `${d.ref.name} ${d.entry.slug} has no file ${path}.`);
}

export type AndroidChanges = VersionChanges<{
	readonly configs: { readonly rows: readonly DiffRow[]; readonly counts: DiffCounts };
	readonly apns: { readonly rows: readonly DiffRow[]; readonly counts: DiffCounts };
}>;

/** An APN pairs with the APN of its name, else (across carriers) with one of its types; plain values pair by no key. */
const apnKey =
	(field: "name" | "type") =>
	(item: unknown): string | null =>
		isRecord(item) && item[field] !== undefined ? canonical(item[field]) : null;
const APN_KEYS: PairKeys = [apnKey("name"), apnKey("type")];

const diff = (x: unknown, y: unknown): { rows: DiffRow[]; counts: DiffCounts } => {
	const rows = diffValues(x, y, isRecord, APN_KEYS);
	return { rows, counts: summariseDiff(rows) };
};

/** Config keys and APNs: what the Changes tab and /compare show for two Pixel files. */
export const { changes: getAndroidChanges, comparison: getAndroidComparison } = versionChanges(
	decoded,
	(a: CarrierSettings | null, b: CarrierSettings) => ({
		configs: diff(a ? plainConfigs(a) : {}, plainConfigs(b)),
		apns: diff(a?.apns ?? [], b.apns),
	}),
);
