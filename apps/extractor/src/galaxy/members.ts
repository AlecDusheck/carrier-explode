/**
 * A Samsung firmware's carrier packs and modem, each streamed from its member. CSC: until optics.img.lz4 (ext4 or EROFS).
 * CP: modem.bin, plain or LZ4-framed: a Snapdragon's NON-HLOS FAT volume, of which only what the Qualcomm reader reads
 * is kept, or an Exynos's Shannon image, whose configs sit in its encrypted MAIN section and so are not read.
 */

import { concatBytes } from "@carrier-explode/binary";
import {
	bytesSource,
	decodeLz4,
	decodeLz4Stream,
	isSparse,
	openFilesystem,
	streamFat,
	unsparse,
	type Filesystem,
} from "@carrier-explode/firmware";
import { DataError } from "../errors.ts";
import { MODEM_PATHS, qualcommModem, type ExtractedModem } from "../modem/index.ts";
import type { Firmware } from "./firmware.ts";
import { collect, tarEntries } from "./tar.ts";

export class GalaxyError extends DataError {
	override name = "GalaxyError";
}

const OPTICS = "optics.img.lz4";
/** Packs sit at configs/carriers/<code>/conf (US packages) or configs/carriers/single/<code>/conf. */
const CARRIERS = "configs/carriers";

/** The CSC member's optics image, as a filesystem. */
async function optics(fw: Firmware): Promise<Filesystem> {
	const entry = fw.member("CSC_");
	const member = await fw.stream(entry);
	const names: string[] = [];
	try {
		for await (const e of tarEntries(member)) {
			names.push(e.name);
			if (e.name !== OPTICS) continue;
			const image = decodeLz4(await collect(e.body));
			return await openFilesystem(bytesSource(isSparse(image) ? unsparse(image) : image));
		}
	} finally {
		// Optics comes before the member's end; closing the stream closes the download.
		member.destroy();
	}
	throw new GalaxyError(`${entry.name}: no ${OPTICS} among ${names.join(", ")}`);
}

/** Every file under `dir`, by its path below it. */
async function filesUnder(fs: Filesystem, dir: string, base = ""): Promise<Map<string, Uint8Array>> {
	const out = new Map<string, Uint8Array>();
	for (const e of await fs.readdir(dir)) {
		const rel = base ? `${base}/${e.name}` : e.name;
		if (e.kind === "dir") for (const [p, b] of await filesUnder(fs, `${dir}/${e.name}`, rel)) out.set(p, b);
		else if (e.kind === "file") out.set(rel, await fs.readFile(`${dir}/${e.name}`));
	}
	return out;
}

/** Where each sales code's conf/ directory is: a directory under `dir`, or one level further down, that holds conf/omc.info. */
async function packDirs(fs: Filesystem, dir: string, depth = 0): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	for (const e of await fs.readdir(dir)) {
		if (e.kind !== "dir") continue;
		const path = `${dir}/${e.name}`;
		const conf = (await fs.readdir(path)).find((c) => c.name === "conf" && c.kind === "dir");
		const hasInfo =
			conf !== undefined && (await fs.readdir(`${path}/conf`)).some((c) => c.name === "omc.info");
		if (hasInfo) {
			if (out.has(e.name)) throw new GalaxyError(`${e.name} has two carrier packs`);
			out.set(e.name, `${path}/conf`);
		} else if (depth === 0) {
			for (const [code, p] of await packDirs(fs, path, 1)) {
				if (out.has(code)) throw new GalaxyError(`${code} has two carrier packs`);
				out.set(code, p);
			}
		}
	}
	return out;
}

export interface CarrierPack {
	readonly path: string;
	readonly files: Map<string, Uint8Array>;
}

/** Each sales code's conf/ files, with the path they were read from: what a carrier pack holds. */
export async function carrierPacks(fw: Firmware): Promise<Map<string, CarrierPack>> {
	const fs = await optics(fw);
	const packs = new Map<string, CarrierPack>();
	for (const [code, path] of await packDirs(fs, CARRIERS))
		packs.set(code, { path, files: await filesUnder(fs, path) });
	if (packs.size === 0) throw new GalaxyError(`${CARRIERS} holds no carrier pack`);
	return packs;
}

const MODEM = "modem.bin";
const MODEM_LZ4 = "modem.bin.lz4";
const KEPT = MODEM_PATHS.map((p) => p.toLowerCase());

/** A path on the way to, or under, one the reader reads; FAT names are case-insensitive. */
const kept = (path: string): boolean => {
	const p = path.toLowerCase();
	return KEPT.some((k) => k === p || k.startsWith(`${p}/`) || p.startsWith(`${k}/`));
};

/** A Shannon image starts with its table of sections. */
const SHANNON_TOC = new TextEncoder().encode("TOC\0");

/** The stream's first `n` bytes (fewer if it ends first), and the whole stream to read again. */
async function peek(
	input: AsyncIterable<Uint8Array>,
	n: number,
): Promise<{ readonly head: Uint8Array; readonly stream: AsyncIterable<Uint8Array> }> {
	const it = input[Symbol.asyncIterator]();
	const seen: Uint8Array[] = [];
	for (let got = 0; got < n;) {
		const next = await it.next();
		if (next.done) break;
		seen.push(next.value);
		got += next.value.length;
	}
	async function* stream(): AsyncGenerator<Uint8Array> {
		yield* seen;
		for (let next = await it.next(); !next.done; next = await it.next()) yield next.value;
	}
	return { head: concatBytes(seen).subarray(0, n), stream: stream() };
}

/** A CP's decoded modem.bin: a FAT volume's configs, or null for a Shannon image. */
export async function cpImage(
	image: AsyncIterable<Uint8Array>,
	label: string,
): Promise<ExtractedModem | null> {
	const { head, stream } = await peek(image, SHANNON_TOC.length);
	if (SHANNON_TOC.every((b, i) => head[i] === b)) return null;
	return qualcommModem({ modem: await streamFat(stream, label, kept), vendor: null });
}

/** The CP member's modem; null for an Exynos's, whose configs are encrypted. */
export async function cpModem(fw: Firmware): Promise<ExtractedModem | null> {
	const entry = fw.member("CP_");
	const member = await fw.stream(entry);
	try {
		for await (const e of tarEntries(member)) {
			if (e.name !== MODEM && e.name !== MODEM_LZ4) continue;
			return await cpImage(
				e.name === MODEM_LZ4 ? decodeLz4Stream(e.body) : e.body,
				`${entry.name}/${e.name}`,
			);
		}
		throw new GalaxyError(`${entry.name}: neither ${MODEM} nor ${MODEM_LZ4}`);
	} finally {
		// Closing the stream closes the download: the kept clusters come long before the member's end.
		member.destroy();
	}
}
