/** The FAT reader on images built here: FAT12, FAT16 and FAT32, long and short names, fragmented chains. */

import { describe, expect, it } from "vitest";
import {
	bytesSource,
	FsError,
	FsNotFoundError,
	openFilesystem,
	streamFat,
	type Filesystem,
} from "../src/index.ts";

const SECTOR = 512;
const RESERVED = 1;
const FATS = 2;
const ROOT_ENTRIES = 64;

type Tree = { readonly [name: string]: Uint8Array | Tree };
const isFile = (t: Uint8Array | Tree): t is Uint8Array => t instanceof Uint8Array;

/** An 8.3 name stored as upper case with the lower-case flags, or a long name behind a `~1` alias. */
function shortFor(
	name: string,
	i: number,
): { readonly raw: string; readonly lower: number; readonly long: boolean } {
	const m = /^([a-z0-9_]{1,8})(?:\.([a-z0-9]{1,3}))?$/.exec(name);
	if (m?.[1] !== undefined)
		return {
			raw: m[1].toUpperCase().padEnd(8) + (m[2] ?? "").toUpperCase().padEnd(3),
			lower: 0x08 | 0x10,
			long: false,
		};
	return { raw: `LONG~${i}`.padEnd(8) + "   ", lower: 0, long: true };
}

function checksum(raw: string): number {
	let sum = 0;
	for (let i = 0; i < 11; i++) sum = (((sum & 1) << 7) + (sum >> 1) + raw.charCodeAt(i)) & 0xff;
	return sum;
}

function lfnEntries(name: string, sum: number): Uint8Array[] {
	const units = [...name].map((c) => c.charCodeAt(0));
	const parts: number[][] = [];
	for (let i = 0; i < units.length; i += 13) parts.push(units.slice(i, i + 13));
	const offsets = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];
	return parts
		.map((part, seq) => {
			const e = new Uint8Array(32);
			const dv = new DataView(e.buffer);
			e[0] = (seq + 1) | (seq === parts.length - 1 ? 0x40 : 0);
			e[11] = 0x0f;
			e[13] = sum;
			offsets.forEach((o, k) =>
				dv.setUint16(o, k < part.length ? (part[k] ?? 0) : k === part.length ? 0 : 0xffff, true),
			);
			return e;
		})
		.toReversed();
}

const dirEntry = (raw: string, attr: number, lower: number, cluster: number, size: number): Uint8Array => {
	const e = new Uint8Array(32);
	const ev = new DataView(e.buffer);
	for (let i = 0; i < 11; i++) e[i] = raw.charCodeAt(i);
	e[11] = attr;
	e[12] = lower;
	ev.setUint16(20, cluster >>> 16, true);
	ev.setUint16(26, cluster & 0xffff, true);
	ev.setUint32(28, size, true);
	return e;
};

/** A FAT image of `clusters` one-sector clusters. Files named `frag*` get every other cluster, so their chains jump. */
function fatImage(type: 12 | 16 | 32, clusters: number, tree: Tree): Uint8Array {
	const fatBytes = Math.ceil(type === 12 ? (clusters + 2) * 1.5 : (clusters + 2) * (type / 8));
	const fatSectors = Math.ceil(fatBytes / SECTOR);
	const rootSectors = type === 32 ? 0 : (ROOT_ENTRIES * 32) / SECTOR;
	const dataSector = RESERVED + FATS * fatSectors + rootSectors;
	const total = dataSector + clusters;
	const img = new Uint8Array(total * SECTOR);
	const dv = new DataView(img.buffer);
	const fat = new Uint8Array(fatSectors * SECTOR);
	const fv = new DataView(fat.buffer);
	const eoc = type === 12 ? 0xfff : type === 16 ? 0xffff : 0x0fffffff;
	const setNext = (c: number, v: number): void => {
		if (type === 16) fv.setUint16(c * 2, v, true);
		else if (type === 32) fv.setUint32(c * 4, v, true);
		else {
			const at = Math.floor(c * 1.5);
			const old = fv.getUint16(at, true);
			fv.setUint16(at, c & 1 ? (old & 0x000f) | (v << 4) : (old & 0xf000) | v, true);
		}
	};
	let free = 2;
	const alloc = (n: number, fragmented: boolean): number[] => {
		const got = Array.from({ length: n }, (_, i) => free + (fragmented ? 2 * i : i));
		free += fragmented ? 2 * n : n;
		got.forEach((c, i) => setNext(c, got[i + 1] ?? eoc));
		return got;
	};
	const write = (chain: readonly number[], data: Uint8Array): void =>
		chain.forEach((c, i) =>
			img.set(data.subarray(i * SECTOR, (i + 1) * SECTOR), (dataSector + c - 2) * SECTOR),
		);

	const dirBytes = (t: Tree, self: number, parent: number): Uint8Array => {
		const out: Uint8Array[] = [];
		if (self)
			out.push(dirEntry(".          ", 0x10, 0, self, 0), dirEntry("..         ", 0x10, 0, parent, 0));
		else out.push(dirEntry("MODEM      ", 0x08, 0, 0, 0));
		out.push(dirEntry("GONE    TXT", 0x20, 0, 0, 0));
		(out.at(-1) ?? new Uint8Array(1))[0] = 0xe5;
		Object.entries(t).forEach(([name, child], i) => {
			const short = shortFor(name, i + 1);
			if (short.long) out.push(...lfnEntries(name, checksum(short.raw)));
			if (isFile(child)) {
				const chain = child.length ? alloc(Math.ceil(child.length / SECTOR), name.startsWith("frag")) : [];
				write(chain, child);
				out.push(dirEntry(short.raw, 0x20, short.lower, chain[0] ?? 0, child.length));
			} else {
				const [first] = alloc(1, false);
				if (first === undefined) throw new Error("no cluster");
				write([first], dirBytes(child, first, self));
				out.push(dirEntry(short.raw, 0x10, short.lower, first, 0));
			}
		});
		const bytes = new Uint8Array(Math.max(SECTOR, out.length * 32));
		out.forEach((e, i) => bytes.set(e, i * 32));
		if (bytes.length > SECTOR) throw new Error("directory larger than a cluster");
		return bytes;
	};

	setNext(0, (eoc & ~0xff) | 0xf8);
	setNext(1, eoc);
	if (type === 32) {
		const [root] = alloc(1, false);
		if (root === undefined) throw new Error("no cluster");
		write([root], dirBytes(tree, 0, 0));
		dv.setUint32(44, root, true);
	} else {
		img.set(dirBytes(tree, 0, 0), (RESERVED + FATS * fatSectors) * SECTOR);
	}
	for (let i = 0; i < FATS; i++) img.set(fat, (RESERVED + i * fatSectors) * SECTOR);
	img.set([0xeb, 0x3c, 0x90], 0);
	dv.setUint16(11, SECTOR, true);
	img[13] = 1;
	dv.setUint16(14, RESERVED, true);
	img[16] = FATS;
	dv.setUint16(17, type === 32 ? 0 : ROOT_ENTRIES, true);
	if (total < 0x10000) dv.setUint16(19, total, true);
	else dv.setUint32(32, total, true);
	if (type === 32) dv.setUint32(36, fatSectors, true);
	else dv.setUint16(22, fatSectors, true);
	img.set(new TextEncoder().encode(type === 32 ? "FAT32   " : `FAT${type}   `), type === 32 ? 82 : 54);
	img[510] = 0x55;
	img[511] = 0xaa;
	return img;
}

const bytesOf = (n: number, seed: number): Uint8Array =>
	Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251);

const TREE: Tree = {
	image: { "modem.b00": bytesOf(1012, 1), "frag.bin": bytesOf(3000, 2), "empty.txt": new Uint8Array() },
	mcfg: {
		configs: {
			mcfg_sw: {
				"Commercial-VoLTE": { "mcfg_sw.mbn": bytesOf(1700, 3) },
				tmo: { commerci: { "mcfg_sw.mbn": bytesOf(600, 4) } },
			},
		},
	},
	"ver_info.txt": new TextEncoder().encode("Pixel modem"),
};

/** Every file and listing under `dir`, by path. */
async function contents(fs: Filesystem, dir: string): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	const entries = await fs.readdir(dir);
	out[`${dir}/`] = entries.map((e) => `${e.name}:${e.kind}`).join(",");
	for (const e of entries) {
		const path = dir ? `${dir}/${e.name}` : e.name;
		if (e.kind === "dir") Object.assign(out, await contents(fs, path));
		else out[path] = [...(await fs.readFile(path))].join(",");
	}
	return out;
}
async function* chunked(img: Uint8Array, onPull: (at: number) => void): AsyncGenerator<Uint8Array> {
	for (let at = 0; at < img.length; at += 1000) {
		onPull(at + 1000);
		yield img.subarray(at, at + 1000);
	}
}

describe("FAT", () => {
	for (const [type, clusters] of [
		[12, 200],
		[16, 4200],
		[32, 65600],
	] as const) {
		it(`reads FAT${type}: names, nested directories, fragmented chains`, async () => {
			const fs = await openFilesystem(bytesSource(fatImage(type, clusters, TREE)));
			expect(fs.kind).toBe("fat");
			expect((await fs.readdir("/")).map((e) => [e.name, e.kind])).toEqual([
				["image", "dir"],
				["mcfg", "dir"],
				["ver_info.txt", "file"],
			]);
			expect((await fs.readdir("mcfg/configs/mcfg_sw")).map((e) => e.name)).toEqual([
				"Commercial-VoLTE",
				"tmo",
			]);
			expect(await fs.readFile("mcfg/configs/mcfg_sw/Commercial-VoLTE/mcfg_sw.mbn")).toEqual(
				bytesOf(1700, 3),
			);
			expect(await fs.readFile("/MCFG/configs/MCFG_SW/tmo/commerci/MCFG_SW.MBN")).toEqual(bytesOf(600, 4));
			expect(await fs.readFile("image/frag.bin")).toEqual(bytesOf(3000, 2));
			const pieces: Uint8Array[] = [];
			for await (const p of fs.readStream("image/frag.bin")) pieces.push(p);
			expect(new Uint8Array(Buffer.concat(pieces))).toEqual(bytesOf(3000, 2));
			expect(await fs.readFile("image/modem.b00")).toEqual(bytesOf(1012, 1));
			expect(await fs.readFile("image/empty.txt")).toEqual(new Uint8Array());
			expect(new TextDecoder().decode(await fs.readFile("ver_info.txt"))).toBe("Pixel modem");
			await expect(fs.readdir("image/missing")).rejects.toThrow(FsNotFoundError);
			await expect(fs.readFile("image")).rejects.toThrow(FsError);
			await expect(fs.readdir("ver_info.txt")).rejects.toThrow(FsError);
			await expect(fs.readlink("ver_info.txt")).rejects.toThrow(/FAT has none/);
			await expect(fs.readlink("missing")).rejects.toThrow(FsNotFoundError);
		});
	}

	it("throws on a cluster chain that loops", async () => {
		const img = fatImage(16, 4200, { "frag.bin": bytesOf(1500, 5) });
		const dv = new DataView(img.buffer);
		const fatSectors = Math.ceil((4202 * 2) / SECTOR);
		// The root holds the volume label, a deleted entry, then frag.bin on clusters 2, 4, 6: claim more bytes and point 6 back at 2.
		dv.setUint32((RESERVED + FATS * fatSectors) * SECTOR + 2 * 32 + 28, 100_000, true);
		dv.setUint16(RESERVED * SECTOR + 6 * 2, 2, true);
		await expect((await openFilesystem(bytesSource(img))).readFile("frag.bin")).rejects.toThrow(/loops/);
	});

	for (const [type, clusters] of [
		[12, 200],
		[16, 4200],
	] as const) {
		it(`reads from a stream, in one pass, what openFilesystem reads of what it keeps (FAT${type})`, async () => {
			const img = fatImage(type, clusters, TREE);
			const whole = await openFilesystem(bytesSource(img));
			const all = await streamFat(
				chunked(img, () => {}),
				"stream",
				() => true,
			);
			expect(await contents(all, "")).toEqual(await contents(whole, ""));
			let pulled = 0;
			const mcfg = await streamFat(
				chunked(img, (at) => {
					pulled = at;
				}),
				"stream",
				(path) => path === "mcfg" || path.startsWith("mcfg/"),
			);
			expect(await contents(mcfg, "mcfg")).toEqual(await contents(whole, "mcfg"));
			await expect(mcfg.readFile("image/modem.b00")).rejects.toThrow(/not kept/);
			expect(pulled).toBeLessThan(img.length);
		});
	}

	it("refuses FAT32 from a stream: its root is in the data area", async () => {
		await expect(
			streamFat(
				chunked(fatImage(32, 65600, TREE), () => {}),
				"stream",
				() => true,
			),
		).rejects.toThrow(/FAT32/);
	});

	it("fails on a kept cluster the stream has passed before its directory named it", async () => {
		const img = fatImage(12, 200, { a: { "x.bin": bytesOf(600, 6) } });
		const dv = new DataView(img.buffer);
		// The root's entry for a/ (after the label and a deleted entry) now points at cluster 3, x.bin's first; x.bin at 2.
		const fatSectors = Math.ceil((202 * 1.5) / SECTOR);
		const root = (RESERVED + FATS * fatSectors) * SECTOR;
		const dataAt = root + Math.ceil((ROOT_ENTRIES * 32) / SECTOR) * SECTOR;
		const dirA = img.slice(dataAt, dataAt + SECTOR);
		img.set(img.slice(dataAt + SECTOR, dataAt + 3 * SECTOR), dataAt);
		img.set(dirA, dataAt + 2 * SECTOR);
		dv.setUint16(root + 2 * 32 + 26, 4, true);
		dv.setUint16(dataAt + 2 * SECTOR + 2 * 32 + 26, 2, true);
		const fat12 = (c: number, v: number): void => {
			for (let f = 0; f < FATS; f++) {
				const at = (RESERVED + f * fatSectors) * SECTOR + Math.floor(c * 1.5);
				const old = dv.getUint16(at, true);
				dv.setUint16(at, c & 1 ? (old & 0x000f) | (v << 4) : (old & 0xf000) | v, true);
			}
		};
		fat12(2, 3);
		fat12(3, 0xfff);
		fat12(4, 0xfff);
		async function* whole(): AsyncGenerator<Uint8Array> {
			yield img;
		}
		await expect(streamFat(whole(), "stream", () => true)).rejects.toThrow(/before the directory/);
	});
});
