/** What each family's extractor gives: one archive's members per carrier config, and the filesystem helpers they share. */

import { FsNotFoundError, type DirEntry, type Filesystem } from "@carrier-explode/firmware";
import type { ModemVendor } from "@carrier-explode/schema/types";
import { DataError } from "../errors.ts";

/** The partitions a family reads: vendor is opened only when asked for, and a Galaxy CP image has none. */
export interface ModemImages {
	readonly modem: Filesystem;
	readonly vendor: (() => Promise<Filesystem>) | null;
}

export interface ModemArchive {
	/** The family's name for the config: the key of AndroidModem.configs. */
	readonly label: string;
	/** Where its main file lives, `<partition>/<path>`: the artifact's origin. */
	readonly path: string;
	/** Built when stored: together a Shannon firmware's archives, each with its own item definitions and combination files, outgrow a step. */
	readonly files: () => Promise<ReadonlyMap<string, Uint8Array>>;
}

export interface ExtractedModem {
	readonly family: ModemVendor;
	readonly firmware: string;
	readonly archives: readonly ModemArchive[];
}

export class ModemExtractError extends DataError {
	override name = "ModemExtractError";
}

const utf8 = new TextEncoder();

export const jsonBytes = (value: unknown): Uint8Array => utf8.encode(JSON.stringify(value));

/** A directory's entries, or undefined when it does not exist. */
export async function listed(fs: Filesystem, dir: string): Promise<readonly DirEntry[] | undefined> {
	try {
		return await fs.readdir(dir);
	} catch (e) {
		if (e instanceof FsNotFoundError) return undefined;
		throw e;
	}
}

/**
 * The named files of a directory, read one at a time in inode order: files written together sit together, so over a
 * payload partition each operation is decompressed once rather than once per file.
 */
export async function readInOrder(
	fs: Filesystem,
	dir: string,
	entries: readonly DirEntry[],
): Promise<Map<string, Uint8Array>> {
	const out = new Map<string, Uint8Array>();
	for (const e of entries.toSorted((a, b) => a.inode - b.inode))
		out.set(e.name, await fs.readFile(`${dir}/${e.name}`));
	return out;
}

/** A file's bytes, or undefined when it does not exist. */
export async function readIfPresent(fs: Filesystem, path: string): Promise<Uint8Array | undefined> {
	try {
		return await fs.readFile(path);
	} catch (e) {
		if (e instanceof FsNotFoundError) return undefined;
		throw e;
	}
}

/** Every regular file under `dir` named `name` (case-insensitively, for FAT), as sorted paths. */
export async function findFiles(fs: Filesystem, dir: string, name: string): Promise<string[]> {
	const out: string[] = [];
	const want = name.toLowerCase();
	const walk = async (d: string): Promise<void> => {
		for (const e of await fs.readdir(d)) {
			if (e.name === "." || e.name === "..") continue;
			if (e.kind === "dir") await walk(`${d}/${e.name}`);
			else if (e.kind === "file" && e.name.toLowerCase() === want) out.push(`${d}/${e.name}`);
		}
	};
	await walk(dir);
	return out.toSorted();
}

/** Labels key AndroidModem.configs, so two configs may not share one. */
export function uniqueLabels(archives: readonly ModemArchive[]): readonly ModemArchive[] {
	const seen = new Map<string, string>();
	for (const a of archives) {
		const other = seen.get(a.label);
		if (other !== undefined)
			throw new ModemExtractError(`${a.path} and ${other} are both labelled ${a.label}`);
		seen.set(a.label, a.path);
	}
	return archives;
}

/** The modem build label: the directory images/default links to. Its siblings hold other modem images (SPI/, A0/). */
export async function tensorLabel(modem: Filesystem): Promise<string> {
	const label = await modem.readlink("images/default");
	if (label.includes("/"))
		throw new ModemExtractError(`modem/images/default links to ${label}, outside images/`);
	return label;
}

/** A gzip member's contents as they stream: nothing is held whole. */
export function gunzipped(gz: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
	const it = gz[Symbol.asyncIterator]();
	const compressed = new ReadableStream<Uint8Array>({
		async pull(controller) {
			const next = await it.next();
			if (next.done) controller.close();
			else controller.enqueue(next.value);
		},
		async cancel() {
			await it.return?.();
		},
	});
	return compressed.pipeThrough(new DecompressionStream("gzip"));
}
