/**
 * mav25/modem-configs.bin: qdsp6sw.mbn bytes 57236896..57256400 of Mav25-2.10.01.Release.bbfw (two plain MCFG images,
 * a plain SW image and its two zlib images); pixel5a/dcm-cut.mbn: a cut of a Pixel 5a carrier config (test/README.md).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
	mcfgItemData,
	mcfgSetting,
	parseMcfg,
	parseMcfgTrailer,
	scanModemConfigs,
	summarizeTrailer,
	trailerField,
} from "../src/mcfg.ts";
import { annotateNv } from "../src/nv.ts";
import { defined } from "./defined.ts";

const here = dirname(fileURLToPath(import.meta.url));
const modem = new Uint8Array(readFileSync(join(here, "fixtures", "mav25", "modem-configs.bin")));

describe("MCFG images and MCFG_TRL", () => {
	it("reads trailer TLVs (u8 type, u16le length) and stops at type 9", () => {
		const body = new Uint8Array([
			0xa1,
			0,
			0,
			0,
			...new TextEncoder().encode("MCFG_TRL"),
			0,
			2,
			0,
			0,
			1,
			3,
			3,
			0,
			0x41,
			0x42,
			0x43,
			7,
			4,
			0,
			0x20,
			0,
			0x40,
			0x41,
			9,
			0,
			0,
			3,
			1,
			0,
			0x5a,
		]);
		const t = defined(parseMcfgTrailer(body));
		expect(summarizeTrailer(t)).toEqual({ trailerVersion: "0001", label: "ABC", capability: "20004041" });
		expect(t.fields.map((f) => [f.type, f.hex])).toEqual([
			[0, "0001"],
			[3, "414243"],
			[7, "20004041"],
			[9, ""],
		]);
		expect(parseMcfgTrailer(new Uint8Array(16))).toBeUndefined();
		expect(parseMcfg(new Uint8Array(64))).toBeUndefined();
	});

	it("finds the modem's built-in configs, plain and zlib", () => {
		const cfgs = scanModemConfigs(modem);
		expect(cfgs.map((m) => [m.offset, m.container, m.label, m.image.cfgTypeName, m.length])).toEqual([
			[0, "plain", "CUST_SW_DEFAULT", "SW", 169],
			[8368, "plain", "CUST_HW_DEFAULT", "HW", 157],
			[8532, "plain", undefined, "SW", 10873],
			[8596, "zlib", "DSDS-MN-Sariska", "HW", 25764],
			[14254, "zlib", "MSSS-MN-Sariska", "HW", 20788],
		]);
		expect(cfgs[2]?.files.map((f) => f.path)).toEqual(["/multi_mbn/HW-DSDS.mbn", "/multi_mbn/HW-MSSS.mbn"]);
		expect(summarizeTrailer(defined(cfgs[3]?.image.trailer))).toMatchObject({
			version: "0089000a",
			baseVersion: "0089000a",
			capability: "41400020",
		});
		expect(trailerField(cfgs[4]?.image.trailer, "capability")?.hex).toBe("40400020");
		expect(cfgs[3]?.files).toHaveLength(14);
		expect(cfgs[3]?.files.find((f) => f.path === "/policyman/policies.xml")?.data.length).toBe(3958);
	});
});

const tlv = (t: number, v: number[]) => [t, v.length, 0, ...v];

describe("Pixel mcfg_sw.mbn", () => {
	const img = new Uint8Array(readFileSync(join(here, "fixtures", "pixel5a", "dcm-cut.mbn")));
	const m = defined(parseMcfg(img));

	it("reads the carrier config's header and items", () => {
		expect(m).toMatchObject({
			segmentOffset: 512,
			cfgTypeName: "SW",
			numItems: 6,
			muxdCarrierIndex: 13,
			version: "0a010d0d",
		});
		expect(
			m.items.map((entry) =>
				entry.kind === "nv" ? entry.nv : entry.kind === "file" ? entry.path : entry.kind,
			),
		).toEqual([
			"/nv/item_files/ims/IMS_enable",
			"/nv/item_files/modem/data/3gpp/global_throttling",
			1896,
			909,
			3533,
			"trailer",
		]);
		expect([...mcfgItemData(img, defined(m.items[1]))]).toEqual([0, 2, 0, 0]);
		expect(
			annotateNv("/nv/item_files/ims/IMS_enable", defined(mcfgItemData(img, defined(m.items[0]))[0]))?.label,
		).toBe("Enabled");
	});

	it("decodes the trailer's IIN and PLMN lists", () => {
		expect(m.trailer?.fields.map((f) => f.kind)).toEqual([
			"trailerVersion",
			"version",
			"applicableMccMnc",
			"label",
			"iins",
			"baseVersion",
			"plmns",
			"capability",
			"field8",
			"end",
		]);
		expect(trailerField(m.trailer, "label")?.text).toBe("Commercial-DCM");
		expect(trailerField(m.trailer, "iins")).toMatchObject({ type: 4, flag: 0, iins: [8981100] });
		expect(trailerField(m.trailer, "plmns")).toMatchObject({
			type: 6,
			flag: 0,
			plmns: [{ mcc: 440, mnc: 10 }],
		});
		// DCM states MNC 10 before MCC 440.
		expect(trailerField(m.trailer, "applicableMccMnc")).toEqual({
			type: 2,
			hex: "0a00b801",
			kind: "applicableMccMnc",
			values: [10, 440],
		});
	});

	it("keeps a list TLV whose count disagrees with its length as raw hex", () => {
		const body = new Uint8Array([
			0,
			0,
			0,
			0,
			...new TextEncoder().encode("MCFG_TRL"),
			...tlv(4, [1, 1, 0x20, 0x8e, 0x88, 0]),
			...tlv(6, [0, 2, 0xb8, 1, 10, 0]),
			...tlv(9, []),
		]);
		expect(defined(parseMcfgTrailer(body)).fields).toEqual([
			{ type: 4, hex: "0101208e8800", kind: "iins", flag: 1, iins: [8949280] },
			{ type: 6, hex: "0002b8010a00", kind: "other" },
			{ type: 9, hex: "", kind: "end" },
		]);
	});
});

const u16 = (n: number): number[] => [n & 0xff, n >> 8];
const u32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
const item = (type: number, attr: number, body: number[]): number[] => [
	...u32(8 + body.length),
	type,
	attr,
	0,
	0,
	...body,
];
const nvItem = (attr: number, nv: number, data: number[]): number[] =>
	item(1, attr, [...u16(nv), ...u16(data.length), ...data]);
function fileItem(type: number, attr: number, path: string, data: number[], width: 2 | 4 = 2): number[] {
	const p = [...new TextEncoder().encode(path), 0];
	return item(type, attr, [
		...u16(1),
		...u16(p.length),
		...p,
		...u16(2),
		...(width === 4 ? u32(data.length) : u16(data.length)),
		...data,
	]);
}
/** A bare SW MCFG segment of `items`, without a trailer. */
const segment = (items: number[][]): Uint8Array =>
	Uint8Array.from([
		...new TextEncoder().encode("MCFG"),
		...u16(2),
		...u16(1),
		...u32(items.length),
		...u16(0),
		...u16(0),
		...u16(0x1383),
		...u16(0),
		...items.flat(),
	]);

describe("MCFG items", () => {
	it("frames file items of types 8, 23 and 27 with a u32 data length, and any item its fields do not fill as other", () => {
		const xml = [...new TextEncoder().encode("<a/>")];
		const img = segment([
			fileItem(8, 0x19, "/x.xml", [7, ...xml], 4),
			fileItem(27, 0x19, "/rfc/a.dat", [7, 1, 2], 4),
			fileItem(23, 0x19, "/mdb/nr/a.mdb", [7, 1, 3], 4),
			[...nvItem(0x19, 10, [7, 4]).slice(0, 10), ...u16(9), 7, 4],
			fileItem(8, 0x19, "/y.xml", [7, ...xml]),
		]);
		const m = defined(parseMcfg(img));
		expect(m.items.map((entry) => [entry.type, entry.kind])).toEqual([
			[8, "file"],
			[27, "file"],
			[23, "file"],
			[1, "other"],
			[8, "other"],
		]);
		expect(new TextDecoder().decode(mcfgItemData(img, defined(m.items[0])))).toBe("<a/>");
	});

	it("reads a type 12 group: a branch per GID1 test, an else and its end", () => {
		const test = (text: string): number[] => {
			const t = [...new TextEncoder().encode(text), 0];
			return [1, ...u16(2), ...u16(10), 2, ...u16(t.length), ...t];
		};
		const img = segment([
			item(12, 0xff, [0, 1, 0, 0, ...test("0 53FF")]),
			nvItem(0x19, 71, [7, 0x41]),
			item(12, 0xff, [0, 1, 0, 2]),
			nvItem(0x19, 71, [7, 0x42]),
			item(12, 0xff, [0, 1, 0, 3]),
			item(12, 0xff, [0, 1, 0, 9]),
		]);
		const branches = defined(parseMcfg(img)).items.map((x) =>
			x.kind === "branch" ? [x.branch, x.lead, x.conditions] : x.kind,
		);
		expect(branches).toEqual([
			["if", "000100", [{ type: 2, word: 10, form: 2, text: "0 53FF" }]],
			"nv",
			["else", "000100", []],
			"nv",
			["end", "000100", []],
			// A fourth byte no group uses: kept as an unread item.
			"other",
		]);
	});

	it("reads the subscription mask and index bytes the attributes declare, and value-less items", () => {
		const img = segment([
			nvItem(0x39, 10, [7, 0, 4, 0]),
			nvItem(0x39, 10, [6, 0, 13, 0]),
			nvItem(0x29, 1206, [2, 0xb8, 0x0b]),
			nvItem(0x19, 909, [2, 1]),
			nvItem(0x78, 441, [7, 0]),
			fileItem(2, 0x58, "/sd/mru001", [7]),
			fileItem(2, 0x40, "/policyman/early_mcc_scan", []),
			fileItem(2, 0x40, "/mcfg_ftb", [0, 0]),
			nvItem(0x39, 909, [7]),
		]);
		const settings = defined(parseMcfg(img)).items.map((entry) => {
			const s = entry.kind === "nv" || entry.kind === "file" ? mcfgSetting(img, entry) : undefined;
			return s && [s.subsMask, s.index, s.value && [...s.value]];
		});
		expect(settings).toEqual([
			[7, 0, [4, 0]],
			[6, 0, [13, 0]],
			[null, 2, [0xb8, 0x0b]],
			[2, null, [1]],
			[7, 0, null],
			[7, null, null],
			[null, null, null],
			// Galaxy's /mcfg_ftb: attribute 0x40 with data, which is its value.
			[null, null, [0, 0]],
			undefined,
		]);
	});
});
