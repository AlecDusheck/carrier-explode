/** The MCF container every `.mcf*ota` file shares: a file header with the LID table, then checksummed data sections. */

import { latin1, slice, u16le, u32le, view } from "@carrier-explode/binary";
import { McfError } from "./errors.ts";

/** The 8-byte kind name at header offset 0x14, one per file extension. */
const MCF_KINDS = ["OP-OTA", "NW-OTA", "OTA", "RAW-OTA"] as const;
export type McfKind = (typeof MCF_KINDS)[number];

const FILE_TAG = 0x0001_0004;
const SECTION_TAG = 0x0002_0004;
const FILE_MAGIC = 0x1021_aacc;
const SECTION_MAGIC = 0xccaa;
const FORMAT_VERSION = 11;
const FILE_HEADER = 0x20;
const SECTION_HEADER = 40;
const BUILD_LENGTH = 60;
const KIND_AT = 0x14;
const KIND_LENGTH = 8;

/** One LID (NVRAM logical id) and the MCF item ids the file sets in it. */
export interface McfLid {
	readonly lid: number;
	readonly itemIds: readonly number[];
}

export interface McfHeader {
	/** The modem build the file was made for: MCF image label then build stamp (`a900a-MP_…2026.0716.2351092.2532.00.0`). */
	readonly build: string;
	readonly lids: readonly McfLid[];
}

/** A data section: where it sits, its record count, and the record bytes after its header. */
export interface SectionBody {
	readonly offset: number;
	readonly length: number;
	readonly recordCount: number;
	readonly body: Uint8Array;
}

interface McfContainer {
	readonly kind: McfKind;
	readonly header: McfHeader;
	readonly bodies: readonly SectionBody[];
}

/** Sum of the little-endian u32 words; `b.length` is a multiple of 4. */
function wordSum(b: Uint8Array): number {
	const v = view(b);
	let sum = 0;
	for (let i = 0; i < b.length; i += 4) sum = (sum + v.getUint32(i, true)) >>> 0;
	return sum;
}

function readKind(bytes: Uint8Array): McfKind {
	const name = latin1(slice(bytes, KIND_AT, KIND_LENGTH)).replace(/\0+$/, "");
	const kind = MCF_KINDS.find((k) => k === name);
	if (kind === undefined) throw new McfError("kind", KIND_AT, `unknown MCF kind "${name}"`);
	return kind;
}

function readLids(bytes: Uint8Array, end: number): McfLid[] {
	const lids: McfLid[] = [];
	for (let o = FILE_HEADER; o < end;) {
		const lid = u32le(bytes, o);
		const count = u32le(bytes, o + 4);
		const next = o + 8 + 4 * count;
		if (next > end)
			throw new McfError("layout", o, `LID 0x${lid.toString(16)} lists ${count} items past the table end`);
		lids.push({ lid, itemIds: Array.from({ length: count }, (_, i) => u32le(bytes, o + 8 + 4 * i)) });
		o = next;
	}
	return lids;
}

function readSection(bytes: Uint8Array, offset: number): SectionBody {
	if (u32le(bytes, offset) !== SECTION_TAG) throw new McfError("magic", offset, "not an MCF data section");
	const length = u32le(bytes, offset + 4);
	if (length < SECTION_HEADER || length % 4 !== 0 || offset + length > bytes.length) {
		throw new McfError("layout", offset, `section length ${length} does not fit the file`);
	}
	if (u32le(bytes, offset + 8) !== SECTION_MAGIC)
		throw new McfError("magic", offset + 8, "bad data section magic");
	if (u32le(bytes, offset + 16) !== length - SECTION_HEADER) {
		throw new McfError("layout", offset + 16, "section payload length disagrees with its length");
	}
	// Each section's u32 words, its checksum included, sum to zero.
	if (wordSum(slice(bytes, offset, length)) !== 0)
		throw new McfError("checksum", offset, "section checksum mismatch");
	return {
		offset,
		length,
		recordCount: u32le(bytes, offset + 28),
		body: slice(bytes, offset + SECTION_HEADER, length - SECTION_HEADER),
	};
}

/** Reads and checks the framing of any MCF file; the records stay as bytes per section. */
export function readContainer(bytes: Uint8Array): McfContainer {
	if (u32le(bytes, 0) !== FILE_TAG || u32le(bytes, 8) !== FILE_MAGIC)
		throw new McfError("magic", 0, "not an MCF file");
	if (u16le(bytes, 12) !== FORMAT_VERSION)
		throw new McfError("magic", 12, `unsupported MCF format ${u16le(bytes, 12)}`);
	const kind = readKind(bytes);
	const headerLength = u32le(bytes, 4);
	const tableEnd = FILE_HEADER + u32le(bytes, 0x10);
	if (tableEnd + BUILD_LENGTH !== headerLength || headerLength > bytes.length) {
		throw new McfError("layout", 4, `header length ${headerLength} disagrees with its LID table`);
	}
	const bodies: SectionBody[] = [];
	let sum = 0;
	let at = headerLength;
	for (let i = u16le(bytes, 14); i > 0; i--) {
		const s = readSection(bytes, at);
		// The file header holds the sections' sum without their checksums: the negated checksums' total.
		sum = (sum - u32le(bytes, at + 0x24)) >>> 0;
		bodies.push(s);
		at += s.length;
	}
	if (at !== bytes.length)
		throw new McfError("layout", at, `${bytes.length - at} bytes after the last section`);
	if (u32le(bytes, 0x1c) !== sum) throw new McfError("checksum", 0x1c, "file checksum mismatch");
	const header = {
		build: latin1(slice(bytes, tableEnd, BUILD_LENGTH)).replace(/\0+$/, ""),
		lids: readLids(bytes, tableEnd),
	};
	return { kind, header, bodies };
}
