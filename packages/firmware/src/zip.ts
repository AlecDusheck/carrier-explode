/** A zip read in place: the central directory from the tail (zip64 too), then members by offset. */

import { crc32, latin1, safeU64le, slice, u16le, u32le } from "@carrier-explode/binary";
import type { RetryOptions } from "@carrier-explode/http";
import { HttpSource, subSource, type RangeSource } from "./source.ts";

export class ZipFormatError extends Error {
	override name = "ZipFormatError";
}

export interface ZipEntry {
	readonly name: string;
	/** 0 stored, 8 deflate; others are listed but not readable here. */
	readonly method: number;
	readonly compressedSize: number;
	readonly size: number;
	readonly crc32: number;
	readonly localHeaderOffset: number;
}

export interface RemoteZip {
	readonly source: RangeSource;
	readonly entries: readonly ZipEntry[];
	entry(name: string): ZipEntry | undefined;
	/** Where the member's (possibly compressed) bytes start. */
	dataOffset(entry: ZipEntry): Promise<number>;
	/** The member's bytes, inflated if deflated, checked against its size and CRC-32. */
	read(entry: ZipEntry): Promise<Uint8Array>;
	/** A stored member as a source of its own, read in place (payload.bin inside an OTA). */
	storedSource(entry: ZipEntry): Promise<RangeSource>;
}

const EOCD = 0x06054b50;
const EOCD_SIZE = 22;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_EOCD_SIZE = 56;
const CENTRAL = 0x02014b50;
const CENTRAL_SIZE = 46;
const LOCAL = 0x04034b50;
const LOCAL_SIZE = 30;
/** EOCD's comment is at most 65535 bytes, and the zip64 locator sits right before the EOCD. */
const TAIL = EOCD_SIZE + 0xffff + ZIP64_LOCATOR_SIZE;
const U32_MAX = 0xffffffff;
const ZIP64_EXTRA_ID = 1;
const UTF8_NAMES = 0x800;
const STORED = 0;
const DEFLATED = 8;

interface Directory {
	readonly offset: number;
	readonly size: number;
	readonly count: number;
}

/** The last EOCD whose comment length reaches exactly to the end of the file. */
function findEocd(tail: Uint8Array): number {
	for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
		if (u32le(tail, i) === EOCD && i + EOCD_SIZE + u16le(tail, i + 20) === tail.length) return i;
	}
	throw new ZipFormatError("no end-of-central-directory record: not a zip, or truncated");
}

/** A zip64 locator, when present, overrides the EOCD: its fields saturate only when they overflow. */
async function directory(src: RangeSource): Promise<Directory> {
	const tailStart = Math.max(0, src.size - TAIL);
	const tail = await src.read(tailStart, src.size - tailStart);
	const at = findEocd(tail);
	const loc = at - ZIP64_LOCATOR_SIZE;
	if (loc < 0 || u32le(tail, loc) !== ZIP64_LOCATOR) {
		return { count: u16le(tail, at + 10), size: u32le(tail, at + 12), offset: u32le(tail, at + 16) };
	}
	const recordAt = safeU64le(tail, loc + 8);
	const record =
		recordAt >= tailStart ? tail.subarray(recordAt - tailStart) : await src.read(recordAt, ZIP64_EOCD_SIZE);
	if (u32le(record, 0) !== ZIP64_EOCD) throw new ZipFormatError(`no zip64 EOCD at ${recordAt}`);
	return { count: safeU64le(record, 32), size: safeU64le(record, 40), offset: safeU64le(record, 48) };
}

/** The zip64 extra field's u64s: the saturated CD fields, in size, compressed size, offset order. */
function zip64Values(extra: Uint8Array): number[] {
	for (let p = 0; p + 4 <= extra.length; p += 4 + u16le(extra, p + 2)) {
		if (u16le(extra, p) !== ZIP64_EXTRA_ID) continue;
		const body = slice(extra, p + 4, u16le(extra, p + 2));
		return Array.from({ length: Math.floor(body.length / 8) }, (_, i) => safeU64le(body, i * 8));
	}
	return [];
}

interface Sizes {
	readonly size: number;
	readonly compressedSize: number;
	readonly localHeaderOffset: number;
}

/** A CD entry's sizes and offset; each saturated one takes the next zip64 extra value, in this order. */
function sizes(name: string, cd: Uint8Array, p: number, extra: Uint8Array): Sizes {
	const wide = zip64Values(extra)[Symbol.iterator]();
	const widen = (v: number): number => {
		if (v !== U32_MAX) return v;
		const next = wide.next();
		if (next.done) throw new ZipFormatError(`${name}: zip64 extra field is too short`);
		return next.value;
	};
	const size = widen(u32le(cd, p + 24));
	const compressedSize = widen(u32le(cd, p + 20));
	return { size, compressedSize, localHeaderOffset: widen(u32le(cd, p + 42)) };
}

const utf8 = new TextDecoder();

function parseEntries(cd: Uint8Array, count: number): ZipEntry[] {
	const entries: ZipEntry[] = [];
	for (let i = 0, p = 0; i < count; i++) {
		if (u32le(cd, p) !== CENTRAL)
			throw new ZipFormatError(`central directory entry ${i} at ${p} has a bad signature`);
		const nameLen = u16le(cd, p + 28);
		const extraLen = u16le(cd, p + 30);
		const commentLen = u16le(cd, p + 32);
		const rawName = slice(cd, p + CENTRAL_SIZE, nameLen);
		// Without the UTF-8 flag names are CP437, which matches Latin-1 for the ASCII names firmware uses.
		const name = u16le(cd, p + 8) & UTF8_NAMES ? utf8.decode(rawName) : latin1(rawName);
		const extra = slice(cd, p + CENTRAL_SIZE + nameLen, extraLen);
		entries.push({ name, method: u16le(cd, p + 10), crc32: u32le(cd, p + 16), ...sizes(name, cd, p, extra) });
		p += CENTRAL_SIZE + nameLen + extraLen + commentLen;
	}
	return entries;
}

/** Raw deflate through DecompressionStream, which Node, Workers and browsers all have. */
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([new Uint8Array(bytes)])
		.stream()
		.pipeThrough(new DecompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A zip over any RangeSource. */
export async function openZip(src: RangeSource): Promise<RemoteZip> {
	const dir = await directory(src);
	const entries = parseEntries(await src.read(dir.offset, dir.size), dir.count);
	const byName = new Map(entries.map((e) => [e.name, e]));
	const offsets = new Map<ZipEntry, Promise<number>>();

	const dataOffset = (e: ZipEntry): Promise<number> => {
		const known = offsets.get(e);
		if (known) return known;
		const found = src.read(e.localHeaderOffset, LOCAL_SIZE).then((h) => {
			if (u32le(h, 0) !== LOCAL)
				throw new ZipFormatError(`${e.name}: no local header at ${e.localHeaderOffset}`);
			return e.localHeaderOffset + LOCAL_SIZE + u16le(h, 26) + u16le(h, 28);
		});
		offsets.set(e, found);
		// A failed read is not remembered: the next call tries again.
		found.catch(() => offsets.delete(e));
		return found;
	};
	const readRaw = async (e: ZipEntry): Promise<Uint8Array> => src.read(await dataOffset(e), e.compressedSize);
	const read = async (e: ZipEntry): Promise<Uint8Array> => {
		if (e.method !== STORED && e.method !== DEFLATED)
			throw new ZipFormatError(`${e.name}: compression method ${e.method} is not supported`);
		const raw = await readRaw(e);
		const data = e.method === DEFLATED ? await inflateRaw(raw) : raw;
		const crc = crc32(data);
		if (data.length !== e.size || crc !== e.crc32) {
			throw new ZipFormatError(
				`${e.name}: got ${data.length} bytes with CRC-32 ${crc.toString(16)}, the directory says ${e.size} and ${e.crc32.toString(16)}`,
			);
		}
		return data;
	};

	return {
		source: src,
		entries,
		entry: (name) => byName.get(name),
		dataOffset,
		read,
		storedSource: async (e) => {
			if (e.method !== STORED)
				throw new ZipFormatError(
					`${e.name} is compressed (method ${e.method}), so it cannot be read in place`,
				);
			return subSource(src, await dataOffset(e), e.size, `${src.label}!${e.name}`);
		},
	};
}

/** A zip at a URL, read over HTTP Range requests. The source's `stats` say what it cost. */
export async function openRemoteZip(
	url: string,
	opts: RetryOptions = {},
): Promise<RemoteZip & { readonly source: HttpSource }> {
	const source = await HttpSource.open(url, opts);
	return { ...(await openZip(source)), source };
}
