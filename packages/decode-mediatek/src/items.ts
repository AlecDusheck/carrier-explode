/** Item records (OP-OTA, NW-OTA, OTA): an MCF item id, the condition it applies under, and its values by array path. */

import { latin1, slice, u16le, u32le, u8 } from "@carrier-explode/binary";
import type { McfLid, SectionBody } from "./container.ts";
import { McfError } from "./errors.ts";

const RECORD_HEADER = 12;
/** A segmented condition's first byte is a segment kind; a plain one's is a digit or the N of `NA`. */
const SEGMENT_KINDS: ReadonlySet<number> = new Set([1, 2, 3]);

/** `<sbp>_<mcc>_<mnc>`, each `NA` for any. */
export interface PlmnCondition {
	readonly kind: "plmn";
	readonly sbpId: number | null;
	readonly mcc: string | null;
	readonly mnc: string | null;
}

type McfConditionSegment =
	| PlmnCondition
	/** Precedes a `bytes` segment of `length` bytes. `tag` is unexplained: no item has its id, and equal match bytes come with different tags. */
	| { readonly kind: "header"; readonly length: number; readonly tag: number }
	| { readonly kind: "bytes"; readonly bytes: Uint8Array };

export type McfCondition =
	| { readonly kind: "always" }
	| PlmnCondition
	| { readonly kind: "segments"; readonly segments: readonly McfConditionSegment[] };

interface McfItemValue {
	/** Array indices into the item, outermost first; empty for a scalar. */
	readonly path: readonly number[];
	readonly bytes: Uint8Array;
}

export interface McfItemRecord {
	readonly lid: number;
	readonly itemId: number;
	/** Record byte 8: 1, 2, 3 and 17 seen, unexplained (1 and 2 pair records with equal values, as if per SIM stack). */
	readonly flags: number;
	readonly condition: McfCondition;
	readonly values: readonly McfItemValue[];
}

const pad4 = (n: number): number => (n + 3) & ~3;
const PLMN_TAG = /^(NA|\d+)_(NA|\d+)_(NA|\d+)$/;
const PATH = /^(?:\d+\$)*$/;

const tagPart = (s: string | undefined): string | null => (s === undefined || s === "NA" ? null : s);

function plmn(text: string, offset: number): PlmnCondition {
	const m = PLMN_TAG.exec(text);
	if (!m) throw new McfError("tag", offset, `condition "${text}" is not <sbp>_<mcc>_<mnc>`);
	const sbp = tagPart(m[1]);
	return { kind: "plmn", sbpId: sbp === null ? null : Number(sbp), mcc: tagPart(m[2]), mnc: tagPart(m[3]) };
}

/** Segments are 2-byte aligned; zero bytes after the last are padding. */
function segments(tag: Uint8Array, offset: number): McfConditionSegment[] {
	const out: McfConditionSegment[] = [];
	let i = 0;
	while (i < tag.length) {
		const kind = u8(tag, i);
		if (kind === 0) {
			if (tag.subarray(i).some((x) => x !== 0))
				throw new McfError("tag", offset, "data after condition padding");
			break;
		}
		if (kind === 2) {
			out.push({ kind: "header", length: u8(tag, i + 1), tag: u16le(tag, i + 2) });
			i += 4;
			continue;
		}
		if (kind !== 1 && kind !== 3) throw new McfError("tag", offset, `unknown condition segment kind ${kind}`);
		const data = slice(tag, i + 2, u8(tag, i + 1));
		out.push(kind === 1 ? plmn(latin1(data), offset) : { kind: "bytes", bytes: data });
		i = (i + 2 + data.length + 1) & ~1;
	}
	return out;
}

function condition(tag: Uint8Array, offset: number): McfCondition {
	const [first] = tag;
	if (first === undefined) return { kind: "always" };
	if (SEGMENT_KINDS.has(first)) return { kind: "segments", segments: segments(tag, offset) };
	return plmn(latin1(tag), offset);
}

function readValues(
	body: Uint8Array,
	base: number,
	start: number,
	end: number,
	count: number,
): McfItemValue[] {
	const values: McfItemValue[] = [];
	let q = start;
	for (let i = 0; i < count; i++) {
		const pathLength = u16le(body, q);
		const valueLength = u16le(body, q + 2);
		const text = latin1(slice(body, q + 4, pathLength));
		if (!PATH.test(text)) throw new McfError("path", base + q, `item path "${text}" is not <index>$…`);
		values.push({
			path: text.split("$").slice(0, -1).map(Number),
			bytes: slice(body, q + 4 + pathLength, valueLength),
		});
		q += pad4(4 + pathLength + valueLength);
	}
	if (q !== end) throw new McfError("layout", base + q, "item values do not fill their record");
	return values;
}

/** The item records of one section, each with the LID the file's table files its item under. */
export function readItemRecords(section: SectionBody, lids: readonly McfLid[]): McfItemRecord[] {
	const lidOf = new Map(lids.flatMap(({ lid, itemIds }) => itemIds.map((id) => [id, lid] as const)));
	const { body } = section;
	const base = section.offset + section.length - body.length;
	const records: McfItemRecord[] = [];
	for (let o = 0; o < body.length;) {
		const length = u32le(body, o);
		if (length < RECORD_HEADER || length % 4 !== 0 || o + length > body.length) {
			throw new McfError("layout", base + o, `record length ${length} does not fit its section`);
		}
		const itemId = u32le(body, o + 4);
		const lid = lidOf.get(itemId);
		if (lid === undefined)
			throw new McfError("layout", base + o, `item 0x${itemId.toString(16)} is not in the LID table`);
		const tag = slice(body, o + RECORD_HEADER, u8(body, o + 9));
		records.push({
			lid,
			itemId,
			flags: u8(body, o + 8),
			condition: condition(tag, base + o),
			values: readValues(body, base, o + RECORD_HEADER + pad4(tag.length), o + length, u16le(body, o + 10)),
		});
		o += length;
	}
	if (records.length !== section.recordCount)
		throw new McfError("layout", section.offset, "record count disagrees with the section header");
	return records;
}
