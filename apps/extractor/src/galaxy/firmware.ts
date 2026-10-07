/**
 * A Samsung firmware file read in place: its zip directory by range reads, and one member at a time as a stream
 * through AES-ECB and inflate, never held whole.
 */

import { createDecipheriv } from "node:crypto";
import { pipeline, Readable, Transform, type TransformCallback } from "node:stream";
import { createInflateRaw } from "node:zlib";

import { concatBytes } from "@carrier-explode/binary";
import { openZip, type RangeSource, type RemoteZip, type ZipEntry } from "@carrier-explode/firmware";
import { builtOn, enc4Key, FusError, FusSession, type FirmwareRef, type Inform } from "./fus.ts";

const BLOCK = 16;
/** Connections a member's stream may lose in a row before it fails: Samsung's server drops some mid-file. */
const RESUMES = 5;
const RESUME_DELAY_MS = 5000;

class FirmwareStreamError extends Error {
	override name = "FirmwareStreamError";
}

/** A stage's error reaches the last stream's reader. */
const settled = (): undefined => undefined;

/** ECB takes no IV; workerd refuses a null one, so it is empty. */
const NO_IV = new Uint8Array(0);
const decipher = (key: Uint8Array): ReturnType<typeof createDecipheriv> =>
	createDecipheriv("aes-128-ecb", key, NO_IV).setAutoPadding(false);

/** An open firmware file: its zip, and how to stream one of its members. */
export interface Firmware {
	readonly zip: RemoteZip;
	/** The member whose name starts with `prefix` (`CSC_`, `AP_`). */
	member(prefix: string): ZipEntry;
	/** A member's bytes, inflated, as they stream; destroying it closes the download. */
	stream(entry: ZipEntry): Promise<Readable>;
}

/** `fus` has readied the file `inform` names (initDownload). */
async function openFirmware(fus: FusSession, inform: Inform, key: Uint8Array): Promise<Firmware> {
	const file = inform.binaryName;
	const download = (start: number, end: number): Promise<ReadableStream<Uint8Array>> =>
		fus.download(start, end);
	const read = async (start: number, end: number): Promise<Uint8Array> => {
		const enc = new Uint8Array(await new Response(await download(start, end)).arrayBuffer());
		if (enc.length !== end - start)
			throw new FirmwareStreamError(`${file}: asked for ${end - start} bytes at ${start}, got ${enc.length}`);
		const d = decipher(key);
		return concatBytes([d.update(enc), d.final()]);
	};
	// The file ends in PKCS#7 padding, which its last block gives the length of; the zip ends before it.
	const last = await read(inform.size - BLOCK, inform.size);
	const pad = last[BLOCK - 1] ?? 0;
	if (pad < 1 || pad > BLOCK || !last.subarray(BLOCK - pad).every((x) => x === pad))
		throw new FirmwareStreamError(`${file}: no PKCS#7 padding at its end`);
	const source: RangeSource = {
		label: file,
		size: inform.size - pad,
		async read(offset: number, length: number): Promise<Uint8Array> {
			const start = offset - (offset % BLOCK);
			const plain = await read(start, Math.ceil((offset + length) / BLOCK) * BLOCK);
			return plain.slice(offset - start, offset - start + length);
		},
	};
	const zip = await openZip(source);
	return {
		zip,
		member(prefix: string): ZipEntry {
			const entry = zip.entries.find((e) => e.name.startsWith(prefix));
			if (entry === undefined)
				throw new FirmwareStreamError(
					`${file}: no ${prefix} member among ${zip.entries.map((e) => e.name).join(", ")}`,
				);
			return entry;
		},
		async stream(entry: ZipEntry): Promise<Readable> {
			if (entry.method !== 8 && entry.method !== 0)
				throw new FirmwareStreamError(`${entry.name}: compression method ${entry.method}`);
			const data = await zip.dataOffset(entry);
			const start = data - (data % BLOCK);
			const end = Math.ceil((data + entry.compressedSize) / BLOCK) * BLOCK;
			const body = Readable.from(ranged(download, start, end));
			const plain = (): [Readable, Transform, Transform] => [
				body,
				decipher(key),
				window(data - start, entry.compressedSize),
			];
			return entry.method === 8
				? pipeline(...plain(), createInflateRaw(), settled)
				: pipeline(...plain(), settled);
		},
	};
}

/** A firmware as a unit names it: FUS's model, region and version, and its CSC build. */
export interface GalaxyRef extends FirmwareRef {
	readonly build: string;
}

/** What FUS says of an opened firmware, beyond its file. */
export interface OpenedFirmware {
	readonly firmware: Firmware;
	/** The day it was built, from its file name. */
	readonly released: string;
	/** `Galaxy S26 (SM-S942U)`. */
	readonly displayName: string;
}

/** The firmware FUS serves for `ref`, opened; fails if FUS serves another build. */
export async function openGalaxyFirmware(ref: GalaxyRef): Promise<OpenedFirmware> {
	const fus = new FusSession();
	const inform = await fus.inform(ref);
	const build = inform.version.split("/")[1];
	if (build !== ref.build)
		throw new FusError(
			`${ref.model} ${ref.region}: asked for ${ref.build}, FUS serves ${build ?? inform.version}`,
		);
	await fus.initDownload(ref, inform);
	return {
		firmware: await openFirmware(fus, inform, enc4Key(inform)),
		released: builtOn(inform),
		displayName: inform.displayName,
	};
}

/** `AP_…_MULTI_CERT_meta_OS17.tar.md5` → 17: the Android major the firmware runs, as Samsung names its AP member. */
export function androidMajor(firmware: Firmware): number {
	const { name } = firmware.member("AP_");
	const m = /_OS(\d+)\.tar\.md5$/.exec(name);
	if (m?.[1] === undefined) throw new FirmwareStreamError(`${name}: no _OS<major> in the AP member's name`);
	return Number.parseInt(m[1], 10);
}

/**
 * The file's bytes [start, end), reopening at the byte reached when a connection drops. AES-ECB deciphers each block
 * alone, so the stages after it never see the seam.
 */
export async function* ranged(
	download: (start: number, end: number) => Promise<ReadableStream<Uint8Array>>,
	start: number,
	end: number,
): AsyncGenerator<Uint8Array> {
	let at = start;
	for (let lost = 0; at < end;) {
		const body = await download(at, end);
		try {
			for await (const chunk of body) {
				at += chunk.length;
				lost = 0;
				yield chunk;
			}
		} catch (e) {
			// Only a body cut short is resumed: fetch fails its reader with a TypeError ("terminated").
			if (!(e instanceof TypeError) || ++lost > RESUMES) throw e;
			await new Promise((resume) => setTimeout(resume, RESUME_DELAY_MS));
		}
	}
}

/** Drops the bytes before the member and those after it: the ranged GET is block-aligned on both ends. */
function window(skip: number, keep: number): Transform {
	let seen = 0;
	return new Transform({
		transform(chunk: Uint8Array, _enc, done: TransformCallback): void {
			const from = Math.max(0, skip - seen);
			const to = Math.min(chunk.length, skip + keep - seen);
			seen += chunk.length;
			done(null, from < to ? chunk.subarray(from, to) : undefined);
		},
	});
}
