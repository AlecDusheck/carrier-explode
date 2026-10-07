/**
 * Pixel MediaTek MCF (one SBP's OP-OTA, and its NW-OTA) -> ModemConfig. Only SBP items are named, by the build's md1rom;
 * values are typed by the item shapes the extractor read from it, and ones that do not fit stay bytes.
 */

import { canonical } from "@carrier-explode/values";
import * as v from "valibot";

import { bytesToHex, compareUtf8 } from "@carrier-explode/binary";
import {
	decodeNwOta,
	decodeOpOta,
	ITEM_UNITS,
	nameOf,
	readValue,
	shapeOf,
	type ItemShape,
	type ItemShapes,
	type McfCondition,
	type McfItemRecord,
	type McfValue,
	type PlmnCondition,
} from "@carrier-explode/decode-mediatek";

import { simMatcher, uniqueSims } from "../../sims.ts";
import { OWNER_SEPARATOR, type ModemItem, type ModemValue } from "../../types.ts";
import {
	jsonMember,
	member,
	readOr,
	type ArchiveFiles,
	type ConfigDraft,
	type MappedConfig,
} from "../archive.ts";

export const MEDIATEK_OP_OTA = "op.mcfopota";
const NW_OTA = /^[^/]+\.mcfnwota$/;

const sbpSchema = v.object({
	id: v.number(),
	operator: v.nullable(v.string()),
	plmns: v.array(
		v.object({ mcc: v.string(), mnc: v.nullable(v.string()) }) satisfies v.GenericSchema<
			unknown,
			Pick<PlmnCondition, "mcc" | "mnc">
		>,
	),
});

const itemsSchema = v.object({
	/** The modem build whose md1rom the shapes come from. */
	build: v.string(),
	items: v.record(v.string(), v.tuple([v.number(), v.number(), v.picklist(ITEM_UNITS), v.number()])),
	owners: v.record(v.string(), v.string()),
	names: v.record(v.string(), v.string()),
}) satisfies v.GenericSchema<unknown, ItemShapes & { readonly build: string }>;

interface TypedRecord {
	readonly record: McfItemRecord;
	readonly shape: ItemShape | undefined;
	readonly values: readonly { readonly path: readonly number[]; readonly value: McfValue }[];
}

function typed(record: McfItemRecord, shapes: ItemShapes): TypedRecord {
	const shape = shapeOf(shapes, record.itemId, record.lid);
	return {
		record,
		shape,
		values: record.values.map(({ path, bytes }) => ({ path, value: readValue(shape, path, bytes) })),
	};
}

const numbers = (values: readonly number[]): ModemValue => ({
	kind: "list",
	values: values.map((n) => ({ kind: "number", value: n })),
});

/** `asText`: the item's byte runs all read as C strings, so these are taken as text rather than byte lists. */
function modemValue(value: McfValue, asText: boolean): ModemValue {
	switch (value.kind) {
		case "number":
			return value;
		case "numbers":
			return numbers(value.values);
		case "chars":
			return asText && value.text !== null ? { kind: "text", value: value.text } : numbers(value.values);
		case "bytes":
		case "unknown":
			return { kind: "bytes", hex: bytesToHex(value.bytes) };
	}
}

/** One run of the item that is no C string makes all its runs numbers: a band list `29 4d 4e 00` reads as ")MN" by chance. */
const runsReadAsText = (records: readonly TypedRecord[]): boolean =>
	records.every((r) => r.values.every((x) => x.value.kind !== "chars" || x.value.text !== null));

const pathKey = (path: readonly number[]): string => path.map((i) => `${i}$`).join("");

/** A record's values: one scalar as itself, else values by array path (`0$1$`, as MCF writes it). */
function recordValue(r: TypedRecord, asText: boolean): ModemValue {
	const [only, ...more] = r.values;
	if (only !== undefined && more.length === 0 && only.path.length === 0)
		return modemValue(only.value, asText);
	return {
		kind: "fields",
		fields: Object.fromEntries(r.values.map((x) => [pathKey(x.path), modemValue(x.value, asText)])),
	};
}

/** `466-97`, `466-any`, `any`; segmented conditions keep their raw form. */
function conditionKey(c: McfCondition): string {
	if (c.kind === "always") return "any";
	if (c.kind === "plmn") return c.mcc === null ? "any" : `${c.mcc}-${c.mnc ?? "any"}`;
	return canonical(
		c.segments.map((s) => (s.kind === "bytes" ? { kind: s.kind, hex: bytesToHex(s.bytes) } : { ...s })),
	);
}

const itemKey = ({ record: r }: TypedRecord): string => `lid:0x${r.lid.toString(16)}/${r.itemId}`;

/** `D2 · 8-bit, 2-index array`, `SBP · 1-bit field`. */
function shapeText([lid, size, unit, depth]: ItemShape, shapes: ItemShapes): string {
	const width = unit === "bit" ? `${size}-bit field` : `${8 * size}-bit`;
	const array = depth === 0 ? "" : `, ${depth}-index array`;
	return `${shapes.owners[lid] ?? "LID owner unknown"}${OWNER_SEPARATOR}${width}${array}`;
}

/** One item per LID and item id; one that differs by PLMN is keyed by condition. */
function items(records: readonly TypedRecord[], shapes: ItemShapes): ModemItem[] {
	const byId = new Map<string, TypedRecord[]>();
	for (const r of records) byId.set(itemKey(r), [...(byId.get(itemKey(r)) ?? []), r]);
	return [...byId].map(([id, rs]): ModemItem => {
		const asText = runsReadAsText(rs);
		const byCondition = new Map(rs.map((r) => [conditionKey(r.record.condition), recordValue(r, asText)]));
		const first = rs[0]?.record;
		const shape = rs[0]?.shape;
		const name = first === undefined ? undefined : nameOf(shapes, first.itemId, first.lid);
		const [only, ...more] = byCondition.values();
		const value: ModemValue =
			only !== undefined && more.length === 0
				? only
				: { kind: "fields", fields: Object.fromEntries(byCondition) };
		return {
			id,
			name: name ?? null,
			description: shape ? shapeText(shape, shapes) : null,
			value,
			label: null,
			certainty: name === undefined ? "opaque" : "medium",
		};
	});
}

/** Values the item table cannot place, each kept as bytes: one line per item and reason. */
function unplaced(records: readonly TypedRecord[]): string[] {
	const lines = records.flatMap((r) =>
		r.values.flatMap((x) =>
			x.value.kind === "unknown" ? [`${itemKey(r)}: ${x.value.reason}; kept as bytes`] : [],
		),
	);
	return [...new Set(lines)];
}

/** SBP 0 is no operator's: the modem's settings for none. */
const NO_OPERATOR = 0;

export function mediatekConfig(files: ArchiveFiles, sha: string): MappedConfig {
	const sbp = jsonMember(files, "sbp.json", sbpSchema);
	const shapes = jsonMember(files, "items.json", itemsSchema);
	const op = decodeOpOta(member(files, MEDIATEK_OP_OTA));
	const errors: string[] = [];
	const nw = [...files]
		.filter(([name]) => NW_OTA.test(name))
		.toSorted(([a], [b]) => compareUtf8(a, b))
		.flatMap(([name, b]) => readOr(errors, name, [], () => decodeNwOta(b).records));
	const records = [...op.records, ...nw].map((r) => typed(r, shapes));
	const id = sbp.operator === null ? String(sbp.id) : `${sbp.id} (${sbp.operator})`;
	const config: ConfigDraft = {
		family: "mediatek",
		sha,
		label: `SBP ${id}`,
		scope: sbp.id === NO_OPERATOR ? "firmware" : "carrier",
		selection: uniqueSims(
			sbp.plmns.flatMap((p) => (p.mnc === null ? [] : (simMatcher({ mccmnc: `${p.mcc}${p.mnc}` }) ?? []))),
		),
		facts: [
			{ label: "Build", value: op.header.build },
			{ label: "SBP", value: id },
			{ label: "Item table", value: shapes.build },
		],
		items: items(records, shapes),
		combos: [],
		errors: [...errors, ...unplaced(records)],
	};
	return { config, base: null };
}
