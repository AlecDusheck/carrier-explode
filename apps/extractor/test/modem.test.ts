/** A Pixel's modem configs on small partition trees, one per family, built from the decoders' fixtures. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { parse } from "valibot";
import { describe, expect, it } from "vitest";

import { crc32, packFiles } from "@carrier-explode/binary";
import { sbpOperator } from "@carrier-explode/decode-mediatek";
import { decodeManifest, decodeUeCap } from "@carrier-explode/decode-shannon";
import { FsNotFoundError, type DirEntry, type Filesystem } from "@carrier-explode/firmware";
import { modemConfig, type NormalizedModem } from "@carrier-explode/schema";
import type { BandCombination } from "@carrier-explode/schema/types";

import {
	type ExtractedModem,
	familyModem,
	type ModemArchive,
	modemFamily,
	shannonItems,
	type ShannonItems,
	shannonItemsSchema,
} from "../src/modem/index.ts";
import { ueCapIndexes } from "../src/modem/shannon.ts";

const fixture = (pkg: string, name: string): Uint8Array =>
	new Uint8Array(
		readFileSync(join(import.meta.dirname, "..", "..", "..", "packages", pkg, "test", "fixtures", name)),
	);
const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array | undefined): string => new TextDecoder().decode(b);

/** A filesystem holding `files` and symlinks `links` by path; directories are implied by the paths. */
function memFs(
	kind: Filesystem["kind"],
	files: Readonly<Record<string, Uint8Array>>,
	links: Readonly<Record<string, string>> = {},
): Filesystem {
	return {
		kind,
		readdir: async (path) => {
			const prefix = path === "" ? "" : `${path}/`;
			const children = new Map<string, DirEntry["kind"]>();
			for (const [f, leaf] of [
				...Object.keys(files).map((name) => [name, "file"] as const),
				...Object.keys(links).map((l) => [l, "symlink"] as const),
			]) {
				if (!f.startsWith(prefix)) continue;
				const [head = "", ...rest] = f.slice(prefix.length).split("/");
				children.set(head, rest.length ? "dir" : leaf);
			}
			if (!children.size) throw new FsNotFoundError(path, "directory");
			return [...children].map(([name, k], inode) => ({ name, kind: k, inode }));
		},
		readFile: async (path) => {
			const bytes = files[path];
			if (bytes === undefined) throw new FsNotFoundError(path, "file");
			return bytes;
		},
		async *readStream(path) {
			const bytes = files[path];
			if (bytes === undefined) throw new FsNotFoundError(path, "file");
			// Small pieces, so the streamed readers cross piece seams.
			for (let at = 0; at < bytes.length; at += 4096) yield bytes.subarray(at, at + 4096);
		},
		readlink: async (path) => {
			const target = links[path];
			if (target === undefined) throw new FsNotFoundError(path, "symlink");
			return target;
		},
	};
}

/** A Tensor modem image: images/default links to the build `label`; SPI/ holds another modem. */
const tensorFs = (label: string, files: Readonly<Record<string, Uint8Array>>): Filesystem =>
	memFs(
		"ext4",
		{ "images/SPI/modem.bin.gz": gzipSync(Uint8Array.of(0)), ...files },
		{ "images/default": label },
	);

/** The family's steps in turn, a Shannon item table through the JSON it is handed on as. */
async function extract(modem: Filesystem, vendor: Record<string, Uint8Array> = {}): Promise<ExtractedModem> {
	const family = await modemFamily(modem);
	const items = async (): Promise<ShannonItems> => {
		if (family.family !== "shannon") throw new Error(`a ${family.family} modem has no item table`);
		return parse(
			shannonItemsSchema,
			JSON.parse(JSON.stringify([...(await shannonItems(modem, family.label))])),
		);
	};
	return familyModem(family, { modem: async () => modem, vendor: async () => memFs("ext4", vendor) }, items);
}

const members = async (a: ModemArchive | undefined): Promise<string[]> =>
	[...((await a?.files())?.keys() ?? [])].toSorted();
const config = async (a: ModemArchive | undefined): ReturnType<typeof modemConfig> =>
	modemConfig(packFiles((await a?.files()) ?? new Map()), "s1");
const lists = (n: NormalizedModem): (readonly BandCombination[] | undefined)[] =>
	n.config.combos.map((s) => n.combos.get(s.key));

const u16 = (n: number): number[] => [n & 0xff, n >> 8];
const u32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];

/** A bare HW MCFG segment of EFS file items. */
function hwMbn(efs: Readonly<Record<string, string>>): Uint8Array {
	// oxlint-disable-next-line oxc/no-map-spread -- a byte layout reads clearest as spreads, and this is test input.
	const items = Object.entries(efs).map(([path, data]) => {
		const p = ascii(`${path}\0`);
		const d = ascii(data);
		const body = [...u16(1), ...u16(p.length), ...p, ...u16(2), ...u16(d.length), ...d];
		return [...u32(8 + body.length), 2, 0, 0, 0, ...body];
	});
	return Uint8Array.from([
		...ascii("MCFG"),
		...u16(2),
		...u16(0),
		...u32(items.length),
		...u16(0),
		...u16(0),
		...u16(0),
		...u16(0),
		...items.flat(),
	]);
}

describe("qualcomm", () => {
	const MBN = "rfs/msm/mpss/readonly/vendor/mbn";
	const SW = `${MBN}/mcfg_sw/generic/APAC/DCM/pixel_Commercial/mcfg_sw.mbn`;
	const selDb = text(fixture("decode-qualcomm", "pixel5a/mcfg_sel_db-cut.xml"));
	const combos = "<CARRIER_LIST><PLMN-ID>440-10</PLMN-ID><DCM>b1A[4]</DCM></CARRIER_LIST>";
	const modem = memFs("fat", { "image/version.cfg": ascii("SSD:g7250-00286-230920-B-10835791\n") });
	const vendor = (hw: Record<string, Uint8Array>): Record<string, Uint8Array> => ({
		[SW]: fixture("decode-qualcomm", "pixel5a/dcm-cut.mbn"),
		...hw,
	});

	it("packs each SW config with its selection records and the HW configs' band combos", async () => {
		const got = await extract(
			modem,
			vendor({
				[`${MBN}/mcfg_hw/generic/Pixel/pixel_SS/mcfg_hw.mbn`]: hwMbn({
					"/nv/item_files/mcfg/mcfg_sel_db.xml": selDb,
					"/policyman/band_combos_per_plmn.xml": combos,
				}),
				[`${MBN}/mcfg_hw/generic/Pixel/pixel_DSDS/mcfg_hw.mbn`]: hwMbn({
					"/nv/item_files/mcfg/mcfg_sel_db.xml": selDb,
				}),
			}),
		);
		expect([got.family, got.firmware, got.archives.map((a) => [a.label, a.path])]).toEqual([
			"qualcomm",
			"g7250-00286-230920-B-10835791",
			[["Commercial-DCM", `vendor/${SW}`]],
		]);
		const [dcm] = got.archives;
		expect(await members(dcm)).toEqual(["band_combos_per_plmn.xml", "mcfg_sw.mbn", "selection.json"]);
		expect(text((await dcm?.files())?.get("band_combos_per_plmn.xml"))).toBe(combos);
		expect(JSON.parse(text((await dcm?.files())?.get("selection.json")))).toMatchObject([
			{ carrierName: "DCM" },
		]);
		const n = await config(dcm);
		const c = n.config;
		expect([c.family, c.label, c.scope, c.selection, lists(n)]).toEqual([
			"qualcomm",
			"Commercial-DCM",
			"carrier",
			[{ mccmnc: "44010" }],
			[[[{ band: "B1", dl: "A", dlLayers: 4 }]]],
		]);
	});

	it("leaves records out without a selection database, and refuses HW configs that disagree", async () => {
		const [bare] = (await extract(modem, vendor({}))).archives;
		expect(await members(bare)).toEqual(["mcfg_sw.mbn", "selection.json"]);
		expect(text((await bare?.files())?.get("selection.json"))).toBe("[]");
		await expect(
			extract(
				modem,
				vendor({
					[`${MBN}/mcfg_hw/a/mcfg_hw.mbn`]: hwMbn({ "/nv/item_files/mcfg/mcfg_sel_db.xml": selDb }),
					[`${MBN}/mcfg_hw/b/mcfg_hw.mbn`]: hwMbn({ "/nv/item_files/mcfg/mcfg_sel_db.xml": `${selDb}\n` }),
				}),
			),
		).rejects.toThrow(/mcfg_sel_db.xml differs/);
	});
});

const varint = (n: number): number[] =>
	n < 0x80 ? [n] : [(n & 0x7f) | 0x80, ...varint(Math.floor(n / 128))];
const field = (key: number, b: readonly number[]): number[] => [key, ...varint(b.length), ...b];
const sim = (mccMnc: string): Parameters<typeof ueCapIndexes>[0][number] => ({
	mccMnc,
	imsiPrefix: null,
	spn: null,
	gid1: null,
	gid2: null,
	iccidPrefix: null,
	accessRule: null,
	plmnName: null,
	preferredApn: null,
});

describe("shannon", () => {
	const CC = "firmware/carrierconfig";
	const UE = "firmware/uecapconfig";
	/** cfg.db's xx_test carriers use this manifest, on 310-260 and 310-26. */
	const MANIFEST = "73ca8883b120089c1907413bd97799ab071b89cb";
	const manifest = fixture("decode-shannon", "manifest.pb");
	const confseq = fixture("decode-shannon", "confseq-plain.pb");
	const NAMED = "!NRPM.MTU_DEFAULT_SIZE";
	const seqs = [
		...new Set(decodeManifest(manifest).entries.flatMap((e) => (e.scope === "file" ? [] : [e.confseq]))),
	];

	/** The combinations fixture is carrier 9's; the PLMN map puts 310-260 under TMO, carrier 2. */
	const tmoCombos = ((): Uint8Array => {
		const b = fixture("decode-shannon", "uecap-combinations.pb").slice();
		const at = b.findIndex((x, i) => x === 0x10 && b[i + 1] === 9);
		b[at + 1] = 2;
		return b;
	})();

	/** Defines the confseq fixtures' items and a plmn_mapping layer's. */
	const modemBin = fixture("decode-shannon", "modem-registry.bin");
	const hex = (name: string): string => crc32(ascii(name)).toString(16).padStart(8, "0");
	const modem = tensorFs("g5400c-1", { "images/g5400c-1/modem.bin": modemBin });
	const vendor = {
		[`${CC}/cfg.db`]: fixture("decode-shannon", "cfg.db"),
		[`${CC}/manifests/${MANIFEST}`]: manifest,
		// Every confseq the manifest names, all with one fixture's bytes.
		...Object.fromEntries(seqs.map((sha) => [`${CC}/confseqs/${sha}`, confseq])),
		[`${UE}/ap_plmn_mapping.binarypb`]: fixture("decode-shannon", "uecap-plmn.pb"),
		[`${UE}/TMO_1.binarypb`]: tmoCombos,
		[`${UE}/VZW_1.binarypb`]: fixture("decode-shannon", "uecap-combinations.pb"),
		[`${UE}/lte_1.binarypb`]: fixture("decode-shannon", "uecap-lte.pb"),
	};

	it("packs each manifest with its confseqs, item definitions, SIM matchers and its carrier's combination files", async () => {
		expect(decodeUeCap(tmoCombos)).toMatchObject({ kind: "combinations", carrierIndex: 2 });
		const got = await extract(modem, vendor);
		expect([got.family, got.firmware, got.archives.map((a) => [a.label, a.path])]).toEqual([
			"shannon",
			"g5400c-1",
			[["xx_test", `vendor/${CC}/manifests/${MANIFEST}`]],
		]);
		const [only] = got.archives;
		expect(await members(only)).toEqual([
			"carrier.json",
			...seqs.map((s) => `confseqs/${s}.pb`).toSorted(),
			"items.json",
			"manifest.pb",
			"uecap/TMO_1.binarypb",
		]);
		expect(JSON.parse(text((await only?.files())?.get("items.json")))).toMatchObject({
			[hex(NAMED)]: { name: NAMED, type: "u16", capacity: 1 },
		});
		expect(Object.keys(JSON.parse(text((await only?.files())?.get("items.json"))))).toHaveLength(4);
		expect(JSON.parse(text((await only?.files())?.get("carrier.json")))).toMatchObject([
			{ mccMnc: "310260" },
			{ mccMnc: "31026" },
			{ imsiPrefix: "31026097%" },
			{ gid1: "4276" },
		]);
		const c = (await config(only)).config;
		expect([c.family, c.label, c.scope, c.combos.map((x) => x.sources)]).toEqual([
			"shannon",
			"xx_test",
			"carrier",
			[["uecap/TMO_1.binarypb"]],
		]);
		expect(c.items.find((i) => i.name === NAMED)).toMatchObject({
			description: "u16",
			value: { kind: "number", value: 1400 },
		});
	});

	it("maps carrier indexes from a plmn_mapping confseq when uecapconfig has no ap_plmn_mapping", async () => {
		const item = (name: string, values: readonly number[]): number[] =>
			field(0x22, [
				0x08,
				...varint(crc32(ascii(name))),
				...values.flatMap((v) => field(0x12, v === 0 ? [] : [0x18, ...varint(v)])),
			]);
		// Category 2, TMO, holds 310-260.
		const mapping = Uint8Array.from([
			...field(0x0a, [...ascii("v1.0")]),
			...field(0x12, [...ascii("plmn_mapping_0x23F.common")]),
			...item("NRCAPA_CA_NV_PLMN_CATEGORY_ID", [2]),
			...item("NRCAPA_CA_NV_NUM_OF_PLMN_CATEGORY_ITEMS", [1]),
			...item("NRCAPA_CA_NV_PLMN_NAME_FOR_PLMN_CATEGORY_ID_2", [...ascii("TMO"), 0]),
			...item("NRCAPA_CA_NV_PLMN_IDS_FOR_PLMN_CATEGORY_ID_2", [0x130062]),
		]);
		const { [`${UE}/ap_plmn_mapping.binarypb`]: _, ...without } = vendor;
		const got = await extract(modem, { ...without, [`${CC}/confseqs/${seqs[0] ?? ""}`]: mapping });
		expect(await members(got.archives[0])).toContain("uecap/TMO_1.binarypb");
		expect((await (await extract(modem, without)).archives[0]?.files())?.has("uecap/TMO_1.binarypb")).toBe(
			false,
		);
	});

	it("follows images/default past other modems' directories, and reads a gzipped modem.bin", async () => {
		const got = await extract(
			tensorFs("g5300q-1", { "images/g5300q-1/modem.bin.gz": gzipSync(modemBin) }),
			vendor,
		);
		expect([got.family, got.firmware]).toEqual(["shannon", "g5300q-1"]);
		expect(JSON.parse(text((await got.archives[0]?.files())?.get("items.json")))).toMatchObject({
			[hex(NAMED)]: { name: NAMED },
		});
	});

	it("picks carrier indexes by exact PLMN, two-digit MNCs included, else by MCC with any MNC", () => {
		const plmns = new Map([
			[2, [{ mcc: "310", mnc: "260" }]],
			[3, [{ mcc: "310", mnc: "90" }]],
			[7, [{ mcc: "505", mnc: null }]],
		]);
		expect(ueCapIndexes([sim("310260"), sim("310090")], plmns)).toEqual([2, 3]);
		expect(ueCapIndexes([sim("50501")], plmns)).toEqual([7]);
		expect(ueCapIndexes([sim("23415")], plmns)).toEqual([]);
	});
});

/**
 * A gzipped modem bundle whose md1rom holds, as a900a's does, item rows then their formulas, a LID group table and
 * the SBP name tables: here the APN item 0x20ce of LID 0x88f, and the bit field 0x7130 of LID 0x3c1, SBP data 6.
 */
function modemBundle(): Uint8Array {
	const rom = new Uint8Array(0x500);
	const v = new DataView(rom.buffer);
	rom.fill(0xff, 0, 0x40);
	const row = (
		at: number,
		...fields: readonly [number, number, number, number, number, number, number]
	): void => {
		const [itemId, lid, byteOffset, bitOffset, size, isBits, isArray] = fields;
		v.setUint32(at, itemId, true);
		v.setUint32(at + 4, lid, true);
		v.setUint16(at + 8, byteOffset, true);
		v.setUint16(at + 10, bitOffset, true);
		v.setUint16(at + 12, size, true);
		rom[at + 14] = isBits;
		rom[at + 15] = isArray;
	};
	row(0x40, 0x20ce, 0x88f, 117, 0xffff, 1, 0, 1);
	row(0x50, 0x7130, 0x3c1, 206, 0, 8, 1, 0);
	// The SBP LIDs' byte arrays: 7 data bytes from offset 200 of LID 0x3c1, and 1 byte of feature bits in LID 0x3c0.
	row(0x60, 0x7200, 0x3c1, 200, 0xffff, 1, 0, 1);
	row(0x70, 0x7201, 0x3c0, 4, 0xffff, 1, 0, 1);
	for (const [i, [itemId, formula]] of (
		[
			[0x20ce, "[10](0,504)+[128](117,1)"],
			[0x7200, "[7](200,1)"],
			[0x7201, "[1](4,1)"],
		] as const
	).entries()) {
		v.setUint32(0x80 + 48 * i, itemId, true);
		rom.set(ascii(formula), 0x84 + 48 * i);
	}
	const sbpNames = [
		...["SBP_F0", "SBP_F1"].entries(),
		...Array.from({ length: 7 }, (_, i) => [i, `SBP_D${i}`] as const),
	];
	for (const [k, [index, name]] of sbpNames.entries()) {
		rom.set(ascii(name), 0x400 + 8 * k);
		[0x9000_0000 + 0x400 + 8 * k, index].forEach((w, j) => v.setUint32(0x180 + 8 * k + 4 * j, w, true));
	}
	[2, 7].forEach((count, j) => v.setUint32(0x180 + 8 * sbpNames.length + 4 * j, count, true));
	rom.set(ascii("D2\0SBP\0UMTS\0CAMERA\0"), 0x300);
	const groups: readonly (readonly [name: number, first: number, last: number])[] = [
		[0x307, 0, 0x3f],
		[0x30c, 0x40, 0x7f],
		[0x303, 0x3c0, 0x3ff],
		[0x300, 0x880, 0x8bf],
	];
	for (const [i, [name, first, last]] of groups.entries()) {
		[0x9000_0000 + name, first, last, 0, 0].forEach((w, k) => v.setUint32(0x200 + 20 * i + 4 * k, w, true));
	}
	const bundle = new Uint8Array(0x100 + rom.length);
	const b = new DataView(bundle.buffer);
	bundle.set(ascii("HBLR"), 0);
	b.setUint32(0x30, 1, true);
	bundle.set(ascii("SEGMmd1rom"), 0x40);
	[0x100, rom.length, rom.length].forEach((w, k) => b.setUint32(0x64 + 4 * k, w, true));
	bundle.set(rom, 0x100);
	return gzipSync(bundle);
}

describe("mediatek", () => {
	const LABEL = "MOLY.NR17.R1";
	const DIR = `images/${LABEL}/mcf/mtk_default`;
	const op = fixture("decode-mediatek", "op-ota.mcfopota");
	const nw = fixture("decode-mediatek", "nw-ota.mcfnwota");

	it("packs each SBP's OP-OTA with its NW-OTA, the PLMNs its conditions name and its items' shapes", async () => {
		const got = await extract(
			tensorFs(LABEL, {
				[`${DIR}/MTK_OPOTA_SBPID_108.mcfopota`]: op,
				[`${DIR}/MTK_NWOTA_SBPID_108.mcfnwota`]: nw,
				[`${DIR}/MTK_OPOTA_SBPID_9999.mcfopota`]: op,
				[`images/${LABEL}/md/modem-bundle.img.gz`]: modemBundle(),
			}),
		);
		const operator = sbpOperator(108)?.name;
		expect([got.family, got.firmware, got.archives.map((a) => a.label)]).toEqual([
			"mediatek",
			LABEL,
			[`SBP 108 (${operator})`, "SBP 9999"],
		]);
		const [twn, unknown] = got.archives;
		expect(await members(twn)).toEqual(["items.json", "nw.mcfnwota", "op.mcfopota", "sbp.json"]);
		expect(await members(unknown)).toEqual(["items.json", "op.mcfopota", "sbp.json"]);
		expect(JSON.parse(text((await twn?.files())?.get("sbp.json")))).toEqual({
			id: 108,
			operator,
			plmns: [
				{ mcc: "466", mnc: "97" },
				{ mcc: "466", mnc: "99" },
			],
		});
		expect(JSON.parse(text((await twn?.files())?.get("items.json")))).toEqual({
			build: LABEL,
			items: { [0x20ce]: [0x88f, 1, "byte", 2], [0x7130]: [0x3c1, 8, "bit", 0] },
			owners: { [0x88f]: "D2", [0x3c1]: "SBP" },
			names: { [0x7130]: "SBP_D6" },
		});
		const c = (await config(twn)).config;
		expect([c.family, c.label, c.selection]).toEqual([
			"mediatek",
			`SBP 108 (${operator})`,
			[{ mccmnc: "46697" }, { mccmnc: "46699" }],
		]);
		expect(c.items.find((i) => i.id === `lid:0x3c1/${0x7130}`)).toMatchObject({
			name: "SBP_D6",
			description: "SBP · 8-bit field",
			value: { kind: "number", value: 12 },
			certainty: "medium",
		});
	});

	it("refuses a Tensor modem image with neither MCF nor modem.bin, or whose default links out of images/", async () => {
		await expect(extract(tensorFs("../x", { "images/x/modem.bin": ascii("") }))).rejects.toThrow(
			/outside images/,
		);
		await expect(extract(tensorFs("x", { "images/x/readme": ascii("") }))).rejects.toThrow(
			/neither mcf\/ nor modem.bin/,
		);
	});
});
