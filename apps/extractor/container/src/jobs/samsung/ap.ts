/**
 * A Samsung firmware's IMS maps (imsservice.apk's res/raw) from its system partition: super.img.lz4 is decoded as
 * the AP member streams, and only the partition's runs are written to a sparse file, then read as a filesystem.
 */

import { open, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import {
	bytesSource,
	decodeLz4Stream,
	openFilesystem,
	openZip,
	readSuperMetadata,
	sparseRuns,
	type RangeSource,
	type SparseRun,
} from "@carrier-explode/firmware";
import type { Firmware } from "../../../../src/galaxy/firmware.ts";
import { tarEntries } from "../../../../src/galaxy/tar.ts";
import { DataError } from "../../../../src/errors.ts";

const SUPER = "super.img.lz4";
/** The LP geometry and metadata sit in super's first MiB. */
const HEAD = 1 << 20;
const SECTOR = 512;
const IMS_APK = "system/priv-app/imsservice/imsservice.apk";
const RAW = "res/raw/";

class ApError extends DataError {
	override name = "ApError";
}

/** A file on disk as a range source. */
const fileSource = (fh: FileHandle, size: number, label: string): RangeSource => ({
	label,
	size,
	async read(offset: number, length: number): Promise<Uint8Array> {
		const out = new Uint8Array(length);
		const { bytesRead } = await fh.read(out, 0, length, offset);
		if (bytesRead !== length)
			throw new ApError(`${label}: read ${bytesRead} of ${length} bytes at ${offset}`);
		return out;
	},
});

/** The runs of super that fall in a partition, written at their place in `fh`; the stream is left once past its end. */
async function writePartition(
	runs: AsyncGenerator<SparseRun>,
	head: Uint8Array,
	name: string,
	fh: FileHandle,
): Promise<number> {
	const meta = await readSuperMetadata(bytesSource(head));
	const extents = meta?.partitions.get(`${name}_a`) ?? meta?.partitions.get(name);
	if (extents === undefined) throw new ApError(`super has no ${name} partition`);
	const mapped: Array<readonly [deviceStart: number, deviceEnd: number, partitionOffset: number]> = [];
	let size = 0;
	for (const e of extents) {
		const length = e.sectors * SECTOR;
		if (e.kind === "linear") mapped.push([e.sector * SECTOR, e.sector * SECTOR + length, size]);
		size += length;
	}
	const end = Math.max(...mapped.map(([, b]) => b));
	const place = async (r: SparseRun): Promise<void> => {
		for (const [a, b, at] of mapped) {
			const from = Math.max(a, r.offset),
				to = Math.min(b, r.offset + r.bytes.length);
			if (from < to) await fh.write(r.bytes, from - r.offset, to - from, at + from - a);
		}
	};
	await place({ offset: 0, bytes: head });
	for await (const r of runs) {
		await place(r);
		if (r.offset + r.bytes.length >= end) break;
	}
	return size;
}

/** imsservice.apk's res/raw files, by name, from the firmware's system partition; `dir` holds the partition meanwhile. */
export async function imsMaps(fw: Firmware, dir: string): Promise<Map<string, Uint8Array>> {
	const entry = fw.member("AP_");
	const member = await fw.stream(entry);
	const path = join(dir, "system.img");
	const fh = await open(path, "w+");
	try {
		for await (const e of tarEntries(member)) {
			if (e.name !== SUPER) continue;
			const runs = sparseRuns(decodeLz4Stream(e.body));
			// Read by hand: leaving a for-await would close the generator the partition still needs.
			const head = new Uint8Array(HEAD);
			let first: SparseRun | undefined;
			for (let next = await runs.next(); !next.done; next = await runs.next()) {
				const r = next.value;
				if (r.offset < HEAD)
					head.set(r.bytes.subarray(0, Math.min(r.bytes.length, HEAD - r.offset)), r.offset);
				if (r.offset + r.bytes.length > HEAD) {
					first = r;
					break;
				}
			}
			async function* rest(): AsyncGenerator<SparseRun> {
				if (first !== undefined) yield first;
				yield* runs;
			}
			const size = await writePartition(rest(), head, "system", fh);
			const fs = await openFilesystem(fileSource(fh, size, `${entry.name}/${SUPER}/system`));
			const apk = await openZip(bytesSource(await fs.readFile(IMS_APK)));
			const out = new Map<string, Uint8Array>();
			for (const z of apk.entries)
				if (z.name.startsWith(RAW)) out.set(z.name.slice(RAW.length), await apk.read(z));
			if (out.size === 0) throw new ApError(`${IMS_APK} has no ${RAW}`);
			return out;
		}
		throw new ApError(`${entry.name}: no ${SUPER}`);
	} finally {
		// The partition comes long before the member's end; closing the stream closes the download.
		member.destroy();
		await fh.close();
		await rm(path, { force: true });
	}
}
