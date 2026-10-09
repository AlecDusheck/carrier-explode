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
	readonly values: readonly {
		readonly path: readonly number[];
		readonly bytes: Uint8Array;
		readonly value: McfValue;
	}[];
}

function typed(record: McfItemRecord, shapes: ItemShapes): TypedRecord {
	const shape = shapeOf(shapes, record.itemId, record.lid);
	return {
		record,
		shape,
		values: record.values.map(({ path, bytes }) => ({ path, bytes, value: readValue(shape, path, bytes) })),
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

type PathValue = TypedRecord["values"][number];

/**
 * The values of the records written under one condition, by path: MCF splits a long array over records, each a range
 * of its paths. A path records give different bytes keeps each, and is added to `clashes`.
 */
function mergedValues(records: readonly TypedRecord[], clashes: Set<string>): Map<string, PathValue[]> {
	const byPath = new Map<string, PathValue[]>();
	for (const r of records)
		for (const x of r.values) {
			const path = pathKey(x.path);
			const held = byPath.get(path) ?? [];
			if (!held.some((h) => bytesToHex(h.bytes) === bytesToHex(x.bytes))) held.push(x);
			if (held.length > 1) clashes.add(`${itemKey(r)}${path && ` ${path}`}`);
			byPath.set(path, held);
		}
	return byPath;
}

function pathValue(held: readonly PathValue[], asText: boolean): ModemValue {
	const [only, ...more] = held;
	if (only !== undefined && more.length === 0) return modemValue(only.value, asText);
	return { kind: "list", values: held.map((x) => modemValue(x.value, asText)) };
}

/** One condition's values: one scalar as itself, else values by array path (`0$1$`, as MCF writes it). */
function conditionValue(byPath: ReadonlyMap<string, readonly PathValue[]>, asText: boolean): ModemValue {
	const [only, ...more] = byPath;
	if (only !== undefined && more.length === 0 && only[0] === "") return pathValue(only[1], asText);
	return {
		kind: "fields",
		fields: Object.fromEntries([...byPath].map(([path, held]) => [path, pathValue(held, asText)])),
	};
}

/** The SIM PLMN a record applies under: `466-97`, `466-any`, `any`; segmented conditions keep their raw form. */
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

/** Each flags value with its record count: `1 (483 records)`. */
const flagCounts = (records: readonly TypedRecord[]): string =>
	[...Map.groupBy(records, (r) => r.record.flags)]
		.toSorted(([a], [b]) => a - b)
		.map(([flags, of]) => `${flags} (${of.length} record${of.length === 1 ? "" : "s"})`)
		.join(", ");

/**
 * One item per LID and item id, its values by the condition they apply under unless that is only `any`. Where the
 * config's records differ in flags, a condition names its flags too: records then differ by more than condition.
 */
function items(
	records: readonly TypedRecord[],
	shapes: ItemShapes,
	byFlags: boolean,
	clashes: Set<string>,
): ModemItem[] {
	const conditionOf = (r: TypedRecord): string => {
		const key = conditionKey(r.record.condition);
		return byFlags ? `${key} flags ${r.record.flags}` : key;
	};
	return [...Map.groupBy(records, itemKey)].map(([id, rs]): ModemItem => {
		const asText = runsReadAsText(rs);
		const byCondition = [...Map.groupBy(rs, conditionOf)].map(
			([condition, of]) => [condition, conditionValue(mergedValues(of, clashes), asText)] as const,
		);
		const first = rs[0]?.record;
		const shape = rs[0]?.shape;
		const name = first === undefined ? undefined : nameOf(shapes, first.itemId, first.lid);
		const [only, ...more] = byCondition;
		const value: ModemValue =
			only !== undefined && more.length === 0 && only[0] === "any"
				? only[1]
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

/** md1rom opens `<file>_<sbp>.mcfopota` and applies the records whose `<sbp>_<mcc>_<mnc>` tag fits the SIM. */
const LOADED_BY =
	"its SBP id, which the modem sets for the SIM; a PLMN in its selection is one its records apply to, not every SIM it loads for";

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
	const id = String(sbp.id);
	const clashes = new Set<string>();
	const byFlags = new Set(records.map((r) => r.record.flags)).size > 1;
	const configItems = items(records, shapes, byFlags, clashes);
	const config: ConfigDraft = {
		family: "mediatek",
		sha,
		label: `SBP ${id}`,
		scope: sbp.id === NO_OPERATOR ? "firmware" : "carrier",
		// The PLMNs its records name; MCC-only ones have no SimMatcher.
		selection: uniqueSims(
			sbp.plmns.flatMap((p) => (p.mnc === null ? [] : (simMatcher({ mccmnc: `${p.mcc}${p.mnc}` }) ?? []))),
		),
		facts: [
			{ label: "Build", value: op.header.build },
			{ label: "SBP", value: id },
			{ label: "Item table", value: shapes.build },
			{ label: "Loaded by", value: LOADED_BY },
			...(records.length === 0 ? [] : [{ label: "Record flags", value: flagCounts(records) }]),
		],
		items: configItems,
		combos: [],
		errors: [
			...errors,
			...unplaced(records),
			...[...clashes].map((at) => `${at}: written twice with different values; both kept`),
		],
	};
	return { config, base: null };
}
