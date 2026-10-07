/**
 * Altered Pixel 9 (tokay) and 10 (frankel) files: cfg.db with made-up rows, us_tmo's manifest cut to one entry per kind,
 * confseqs from real item names; modem-registry.bin is made up, its first 15 entries copied from a Pixel 8 (shiba) registry.
 */

import { crc32 } from "@carrier-explode/binary";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	byName,
	confseqCaCombinations,
	confseqPlmnCategories,
	decodeCarrierDb,
	decodeConfseq,
	decodeManifest,
	itemTable,
	itemValue,
	ShannonFormatError,
} from "../src/index.ts";

const fixture = (name: string): Uint8Array => readFileSync(join(import.meta.dirname, "fixtures", name));
const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);
const hash = (name: string): number => crc32(ascii(name));
const varint = (n: bigint): number[] => {
	const out: number[] = [];
	for (let v = BigInt.asUintN(64, n); ; v >>= 7n) {
		if (v < 0x80n) return [...out, Number(v)];
		out.push(Number(v & 0x7fn) | 0x80);
	}
};
const message = (...fields: ReadonlyArray<readonly [number, readonly number[]]>): number[] =>
	fields.flatMap(([key, bytes]) => [key, bytes.length].concat(bytes));

describe("decodeConfseq", () => {
	it("reads items keyed by the CRC-32 of their names, values as int64", () => {
		expect(decodeConfseq(fixture("confseq-plain.pb"))).toEqual({
			version: "v1.0",
			name: "test_carrier.sim1",
			items: [
				{ hash: hash("!NRPM.MTU_DEFAULT_SIZE"), values: [1400n] },
				{ hash: hash("!NRRRC.SUBBAND_RESTRICTION_1_MCC_LIST"), values: [310n, 311n, 0n, 316n] },
				{ hash: hash("AP_BASED_EMC"), values: [0n] },
				{ hash: hash("!SAEL3.PDN_RETRY_RAT_MODE_4"), values: [-1n] },
			],
		});
	});

	it("unwraps CLZ4: sizes, the LZ4 block and its zero padding", () => {
		const clz4 = fixture("confseq-clz4.bin");
		const s = decodeConfseq(clz4);
		expect(s).toEqual(decodeConfseq(fixture("confseq-clz4.expected.pb")));
		expect([s.version, s.name, s.items.length]).toEqual(["v1.1", "test_ca.common", 61]);
		expect(s.items.at(-1)).toEqual({
			hash: hash("!NRCAPA.Band.MaxNumMimoLayersCbPusch"),
			values: Array(40).fill(255n),
		});
		expect(() => decodeConfseq(new Uint8Array([...clz4, 0, 0, 0, 0]))).toThrow(ShannonFormatError);
	});

	it("refuses fields outside the layout", () => {
		expect(() => decodeConfseq(new Uint8Array([0x0a, 1, 0x76, 0x12, 1, 0x61, 0x18, 1]))).toThrow(
			/confseq: unexpected field 3:varint/,
		);
	});

	it("keeps int64 values exact past 2^53, negatives included", () => {
		const values = [-7998348862439096319n, 72102081855160321n];
		const item = [0x08, 7, ...values.flatMap((v) => message([0x12, [0x18, ...varint(v)]]))];
		const s = decodeConfseq(
			new Uint8Array(message([0x0a, [...ascii("v")]], [0x12, [...ascii("a")]], [0x22, item])),
		);
		expect(s.items).toEqual([{ hash: 7, values }]);
	});
});

/** An image as a stream of `size`-byte chunks, opened afresh on each call. */
const chunks = (bytes: Uint8Array, size: number): (() => AsyncGenerator<Uint8Array>) =>
	async function* stream(): AsyncGenerator<Uint8Array> {
		for (let at = 0; at < bytes.length; at += size) yield bytes.slice(at, at + size);
	};

describe("itemTable", () => {
	const image = fixture("modem-registry.bin");

	it("reads each registry entry's name, type and per-copy element count, by the CRC-32 of the name", async () => {
		const table = await itemTable(chunks(image, image.length));
		expect(table.size).toBe(1000);
		expect(table.get(hash("!NRPM.MTU_DEFAULT_SIZE"))).toEqual({
			name: "!NRPM.MTU_DEFAULT_SIZE",
			type: "u16",
			capacity: 1,
		});
		expect(table.get(hash("!LTE.Rel10.Carrier Aggregation Enable/Disable"))).toEqual({
			name: "!LTE.Rel10.Carrier Aggregation Enable/Disable",
			type: "u8",
			capacity: 1,
		});
		expect(table.get(hash("UECAPA_PDCP_ROHC_PROFILES"))).toEqual({
			name: "UECAPA_PDCP_ROHC_PROFILES",
			type: "u8",
			capacity: 9,
		});
		expect(table.get(hash("UL3.Cap.Phych.supp_of_fdpch"))).toMatchObject({ type: "bool", capacity: 1 });
	});

	it("reads the same table however the stream is chunked", async () => {
		const whole = await itemTable(chunks(image, image.length));
		for (const size of [1, 3, 16, 17, 4096]) expect(await itemTable(chunks(image, size))).toEqual(whole);
	});

	it("refuses an image without a registry", async () => {
		const cut = image.slice();
		cut.fill(0, cut.length - 16 * 500);
		await expect(itemTable(chunks(cut, 4096))).rejects.toThrow(/no item registry/);
		await expect(itemTable(chunks(new Uint8Array(64), 64))).rejects.toThrow(/no MAIN segment/);
	});
});

type Def = Parameters<typeof itemValue>[0];
const def = (type: Def["type"], capacity: number): Def => ({ name: "X", type, capacity });

describe("itemValue", () => {
	it("reads each element at its width and sign", () => {
		expect(itemValue(def("s8", 2), [255n, 3n])).toEqual({ kind: "numbers", values: [-1n, 3n] });
		expect(itemValue(def("u8", 1), [-1n])).toEqual({ kind: "numbers", values: [255n] });
		expect(itemValue(def("u64", 2), [-7998390179247095807n, 197657n])).toEqual({
			kind: "numbers",
			values: [10448353894462455809n, 197657n],
		});
		expect(() => itemValue(def("u8", 1), [256n])).toThrow(ShannonFormatError);
		expect(() => itemValue(def("u16", 1), [1n, 2n])).toThrow(/2 values for 1 elements/);
	});

	it("reads a byte array of printable ASCII and one NUL as text", () => {
		const uri = [..."/mtasxdms"].map((c) => BigInt(c.charCodeAt(0)));
		expect(itemValue(def("u8", 100), [...uri, 0n])).toEqual({ kind: "text", text: "/mtasxdms" });
		expect(itemValue(def("u8", 100), [0n])).toEqual({ kind: "numbers", values: [0n] });
		expect(itemValue(def("u8", 100), uri)).toMatchObject({ kind: "numbers" });
		expect(itemValue(def("u16", 100), [...uri, 0n])).toMatchObject({ kind: "numbers" });
	});
});

const ascii0 = (s: string): bigint[] => [...s].map((c) => BigInt(c.charCodeAt(0))).concat(0n);
const comb = (n: number, bands: number[], dl: number[], ul: number[]): Record<string, bigint[]> => ({
	[`UECAPA_REL10_CA_COMB_${n}_NUM_BAND`]: [BigInt(bands.length)],
	[`UECAPA_REL10_CA_COMB_${n}_BAND`]: bands.map(BigInt),
	[`UECAPA_REL10_CA_COMB_${n}_DL_BW_CLASS_BIT_MAP`]: dl.map(BigInt),
	[`UECAPA_REL10_CA_COMB_${n}_UL_BW_CLASS_BIT_MAP`]: ul.map(BigInt),
});

describe("confseq tables", () => {
	const items = (entries: Readonly<Record<string, readonly bigint[]>>): ReturnType<typeof byName> =>
		byName(new Map(Object.entries(entries).map(([n, v]) => [hash(n), v])));

	it("reads LTE CA combinations from UECAPA_REL10_CA_COMB items, leaving out those with UL 0xFFFF", () => {
		// Combinations 1, 2 and 500 of a Pixel 8 lte_ca_0x241_0 confseq.
		const ca = confseqCaCombinations(
			items({
				UECAPA_REL10_CA_COMB_NUM: [3n],
				...comb(1, [1, 1], [0x8000, 0x8000], [0, 0x8000]),
				...comb(2, [1, 5], [0x8000, 0x8000], [0xffff, 0xffff]),
				...comb(3, [5, 5, 66], [0x8000, 0x8000, 0x4001], [0, 0x8000, 0]),
			}),
		);
		expect(ca.unknownUplink).toBe(1);
		expect(ca.combinations).toEqual([
			[
				{ band: 1, dlClass: "A", dlMimoLayers: 2, ulClass: null },
				{ band: 1, dlClass: "A", dlMimoLayers: 2, ulClass: "A" },
			],
			[
				{ band: 5, dlClass: "A", dlMimoLayers: 2, ulClass: null },
				{ band: 5, dlClass: "A", dlMimoLayers: 2, ulClass: "A" },
				{ band: 66, dlClass: "B", dlMimoLayers: 4, ulClass: null },
			],
		]);
		expect(confseqCaCombinations(items({}))).toEqual({ combinations: [], unknownUplink: 0 });
		expect(() => confseqCaCombinations(items({ UECAPA_REL10_CA_COMB_NUM: [1n] }))).toThrow(/has no NUM_BAND/);
	});

	it("reads carrier categories from a plmn_mapping confseq", () => {
		const cats = confseqPlmnCategories(
			items({
				NRCAPA_CA_NV_PLMN_CATEGORY_ID: [1n, 31n],
				NRCAPA_CA_NV_NUM_OF_PLMN_CATEGORY_ITEMS: [2n, 0n],
				NRCAPA_CA_NV_PLMN_NAME_FOR_PLMN_CATEGORY_ID_1: ascii0("VZW"),
				NRCAPA_CA_NV_PLMN_NAME_FOR_PLMN_CATEGORY_ID_31: ascii0("KPN"),
				NRCAPA_CA_NV_PLMN_IDS_FOR_PLMN_CATEGORY_ID_1: [0x134000n, 0x130061n],
			}),
		);
		expect(cats).toEqual([
			{
				index: 1,
				name: "VZW",
				plmns: [
					{ mcc: "310", mnc: "004" },
					{ mcc: "310", mnc: "160" },
				],
			},
			{ index: 31, name: "KPN", plmns: [] },
		]);
		expect(() =>
			confseqPlmnCategories(
				items({ NRCAPA_CA_NV_PLMN_CATEGORY_ID: [1n], NRCAPA_CA_NV_NUM_OF_PLMN_CATEGORY_ITEMS: [1n] }),
			),
		).toThrow(/0 PLMNs, 1 counted/);
	});
});

const entry = (...fields: ReadonlyArray<readonly [number, number]>): number[] => [
	0x12,
	20,
	...Array<number>(20).fill(0xab),
	...fields.flatMap(([k, v]) => [k << 3, v]),
];

describe("decodeManifest", () => {
	it("reads the name, carrier id and each entry's scope, base flag, hardware condition or file path", () => {
		const m = decodeManifest(fixture("manifest.pb"));
		expect([m.version, m.name, m.carrierId]).toEqual(["v0.1", "xx_test", 4242]);
		expect(m.entries.map((e) => [e.scope, e.base])).toEqual([
			["common", true],
			["common", false],
			["sim1", true],
			["sim1", false],
			["sim2", true],
			["sim2", false],
			["multislot", true],
			["multislot", false],
			["common", true],
			["common", false],
			["multislot", false],
			["file", false],
		]);
		expect(m.entries[0]?.confseq).toBe("5bfd663fb32e17faa448d1e456567c4bb46bd166");
		expect(m.entries.flatMap((e) => (e.scope !== "file" && e.condition ? [e.condition] : []))).toEqual([
			{ key: 5, value: 21, variant: 4 },
			{ key: 5, value: 25, variant: 4 },
			{ key: 5, value: 25, variant: 4 },
		]);
		expect(m.entries.at(-1)).toMatchObject({
			scope: "file",
			path: "/carriers/rootcerts/entrust_root_certification_authority",
		});
	});

	it("reads a condition's variant, 0 when left out, and refuses a variant other than 4 without a condition", () => {
		const manifest = (...entries: number[][]): Uint8Array =>
			new Uint8Array(
				message(
					[0x0a, [...ascii("v0.1")]],
					[0x12, [...ascii("us_x")]],
					...entries.map((e) => [0x2a, e] as const),
				),
			);
		const m = decodeManifest(manifest(entry([6, 4], [7, 14]), entry([6, 4], [7, 14], [8, 2]), entry([8, 4])));
		expect(m.entries.map((e) => (e.scope === "file" ? e.path : e.condition))).toEqual([
			{ key: 4, value: 14, variant: 0 },
			{ key: 4, value: 14, variant: 2 },
			null,
		]);
		expect(() => decodeManifest(manifest(entry([8, 1])))).toThrow(/unconditional entry/);
		expect(() => decodeManifest(manifest(entry([6, 4])))).toThrow(/unconditional entry/);
	});
});

describe("decodeCarrierDb", () => {
	const db = decodeCarrierDb(fixture("cfg.db"));
	const carrier = (id: number): unknown => db.carriers.find((c) => c.id === id);

	it("joins each carrier's matchers and manifest", () => {
		expect(db.carriers.map((c) => c.id)).toEqual([4242, 4243, 4244, 4245]);
		expect(carrier(4242)).toMatchObject({
			config: { manifest: "73ca8883b120089c1907413bd97799ab071b89cb" },
			matchers: [{ mccMnc: "310260", imsiPrefix: null, gid1: null }, { mccMnc: "31026" }],
		});
		expect(carrier(4243)).toMatchObject({
			config: { manifest: "73ca8883b120089c1907413bd97799ab071b89cb" },
			matchers: [{ imsiPrefix: "31026097%" }, { gid1: "4276", gid2: null }],
		});
		expect(carrier(4244)).toMatchObject({ matchers: [{ accessRule: "0".repeat(64) }] });
		expect(carrier(4245)).toMatchObject({
			matchers: [{ mccMnc: "20404", spn: "Test SPN", iccidPrefix: "898603" }],
		});
	});
});
