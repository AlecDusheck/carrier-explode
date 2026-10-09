/**
 * Fixtures are cut from Mav25-2.10.01.Release.bbfw and altered, sizes, offsets and containers kept: bbcfg-cut.mbn
 * holds blobs 0, 4, 20, 122 (PROT_NV, PROT_SKU, RFC_MMW, PROT_PRI); pt-cut.mbn blob 17 (NV 64628).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { zlibSync } from "fflate";

import { BBCFG_FILE_TYPES, decodeBbcfgBlob, inflateMavz, readBbcfg, readBlobRecords } from "../src/bbcfg.ts";
import {
	basebandSummary,
	contentFormat,
	isTextFile,
	variantKey,
	type BandComboSet,
	type BasebandFile,
	type BasebandTextFile,
} from "../src/baseband-summary.ts";
import {
	basebandComparable,
	carriedBy,
	comboTagPlmns,
	mergeComboSets,
	priReplacements,
} from "../src/baseband-views.ts";
import type { PriDecoded } from "../src/pri.ts";

import {
	describePolicyElement,
	mcfgItemData,
	comboStats,
	parseAmprNs,
	parseBandCombos,
	parsePolicyXml,
	summarizeTrailer,
	walkPolicy,
	xmlRefs,
} from "@carrier-explode/decode-qualcomm";
import { bytesToHex } from "@carrier-explode/binary";
import { defined } from "./defined.ts";

function textFile(f: BasebandFile | undefined): BasebandTextFile {
	const file = defined(f);
	if (!isTextFile(file)) throw new Error(`${file.path} is not text`);
	return file;
}

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => new Uint8Array(readFileSync(join(here, "fixtures", "bbfw", name)));
const qc = (name: string) =>
	new Uint8Array(readFileSync(join(here, "../../decode-qualcomm/test/fixtures/mav25", name)));
const bbcfg = fx("bbcfg-cut.mbn");
const pt = fx("pt-cut.mbn");
const modem = qc("modem-configs.bin");
const combosXml = new TextDecoder().decode(qc("band-combos.xml"));
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const xmlValue = (text: string) => ({ kind: "xml" as const, text, hex: "", len: text.length });

describe("readBbcfg: container header, meta, index", () => {
	const c = readBbcfg(bbcfg);

	it("reads the header", () => {
		expect(c.magic).toBe("CFG");
		expect(c.headerVersion).toBe(3);
		expect(c.sizes).toEqual([bbcfg.length - 0x28, bbcfg.length - 0x28]);
	});

	it("names metadata tags 80..87 and derives the version", () => {
		expect(c.meta).toEqual({
			project: "Mav25_Official",
			versionHex: "020A0100",
			buildHost: "Default_Local_Host",
			buildUser: "default_local_user",
			field84: "0.0.0.0",
			field85: "aabbccddeeff",
			buildTime: "2021_02_11_08_13_52_PST",
			sourceRevision: "heads/default_local_revision",
			version: "2.10.01",
		});
	});

	it("reads index records and the blob table", () => {
		expect(c.index.map((r) => [r.platform, r.sku, r.hwRev, r.fileType, r.blob])).toEqual([
			[1, 0, 0, 15, 0],
			[1, 1, 7, 13, 1],
			[1, 2, 7, 13, 1],
			[1, 4, 7, 13, 1],
			[1, 1, 8, 10, 2],
			[5, 0, 0, 17, 3],
		]);
		expect(c.index[5]?.fileTypeName).toBe("PROT_PRI");
		expect(c.blobs.map((b) => [b.format, b.length])).toEqual([
			["der", 7457],
			["mavz", 1064],
			["mavz", 2927],
			["der", 67410],
		]);
		expect(c.blobs[0]?.digest).toBe("3baa098ad0b4494e0422d77031215d85500e4302");
	});

	it("rejects anything else", () => {
		expect(() => readBbcfg(modem)).toThrow(/BBCFGMBN/);
	});

	it("reads pt.mbn the same way", () => {
		const p = readBbcfg(pt);
		expect(p.magic).toBe("POW");
		expect(p.index.map((r) => [r.platform, r.sku, r.hwRev, r.fileType])).toEqual([
			[5, 1, 6, 24],
			[5, 2, 6, 24],
			[5, 3, 6, 24],
		]);
	});
});

describe("blob payloads", () => {
	const c = readBbcfg(bbcfg);

	it("MAVZ: 'MAVZ' + u32le length + zlib", () => {
		const body = new TextEncoder().encode("hello hello hello");
		const p = new Uint8Array([0x4d, 0x41, 0x56, 0x5a, body.length, 0, 0, 0, ...zlibSync(body)]);
		expect(new TextDecoder().decode(inflateMavz(p))).toBe("hello hello hello");
		p[4] = 99;
		expect(() => inflateMavz(p)).toThrow(/header says 99/);
		const b = decodeBbcfgBlob(bbcfg, defined(c.blobs[1]));
		expect(b.image?.length).toBe(66730);
		expect(b.mcfg).toBeUndefined();
	});

	it("NV records (bf8458) and EFS records (bf8459)", () => {
		const b = decodeBbcfgBlob(bbcfg, defined(c.blobs[0]));
		expect(b.nv.map((r) => [r.id, bytesToHex(r.value), r.f11, r.f14])).toEqual([
			[6876, "0000000005", 0, 18],
			[6876, "0000000005", 0, 20],
			[6876, "0000000005", 0, 24],
			[1920, "29040000", 2, 94],
			[7, "3100", 0, 94],
			[8, "69", 0, 94],
		]);
		expect(b.files).toHaveLength(16);
		expect(b.files[0]).toMatchObject({ path: "/mav/bbcfg_file_hash_protocol_static_nv", f77: 0, f78: 30 });
		// the modem copies the blob digest into this file
		expect(bytesToHex(defined(b.files[0]?.data))).toBe(c.blobs[0]?.digest);
	});

	it("finds the policy XMLs and text files in PROT_PRI", () => {
		const blob = defined(c.blobs[3]);
		const { nv, files } = readBlobRecords(bbcfg.subarray(blob.offset, blob.offset + blob.length));
		expect(nv.map((r) => r.id)).toEqual([1920]);
		expect(files).toHaveLength(40);
		const byPath = new Map(files.map((f) => [f.path, f.data]));
		expect(byPath.get("/policyman/band_combos_per_plmn.xml")?.length).toBe(49509);
		expect(new TextDecoder().decode(byPath.get("/SSGCCS/ssgccs_config.txt"))).toBe(
			"CUSTOM: 2, 600, 250, 600, 0\nACTIVE_PLMN_LIST: ALL",
		);
	});

	it("classifies content like the reference extractor", () => {
		expect(contentFormat(utf8("  <?xml version='1.0'?><a/>"))).toBe("xml");
		expect(contentFormat(utf8("<policy/>"))).toBe("xml");
		expect(contentFormat(utf8("CUSTOM: 2"))).toBe("text");
		expect(contentFormat(utf8("ab"), "/x.txt")).toBe("text");
		expect(contentFormat(new Uint8Array([1, 2]), "/mdb/nr/x.mdb")).toBe("mdb");
		expect(contentFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe("bin");
	});
});

describe("MCFG images and MCFG_TRL", () => {
	const c = readBbcfg(bbcfg);

	it("parses an RF card image inside an ELF", () => {
		const b = decodeBbcfgBlob(bbcfg, defined(c.blobs[2]));
		const m = defined(b.mcfg);
		expect(m).toMatchObject({
			segmentOffset: 8192,
			format: 4,
			cfgType: 0,
			cfgTypeName: "HW",
			numItems: 4,
			versionId: 0x1383,
			version: "00000000",
		});
		expect(
			m.items.map((item) => [item.type, item.kind, item.kind === "file" ? item.path : undefined]),
		).toEqual([
			[2, "file", "/mcfg_ftb"],
			[27, "file", "/rfc/2900_0_res.dat"],
			[27, "file", "/rfc/2900_0_cmn.dat"],
			[10, "trailer", undefined],
		]);
		expect(mcfgItemData(defined(b.image), defined(m.items[0]))).toHaveLength(8);
		// type 27 has a u32 data length: 470 bytes, the first the 0x07 prefix
		expect(mcfgItemData(defined(b.image), defined(m.items[1]))).toHaveLength(469);
		expect(summarizeTrailer(defined(m.trailer))).toMatchObject({
			trailerVersion: "0001",
			version: "0000000a",
			label: "generic_config_label",
			baseVersion: "0000000a",
		});
	});
});

describe("policy XML tree", () => {
	it("parses every policy XML shipped in PROT_PRI", () => {
		const s = basebandSummary({ "bbcfg.mbn": bbcfg });
		const xmls = s.files.filter(isTextFile).filter((f) => f.format === "xml");
		expect(xmls).toHaveLength(11);
		for (const f of xmls) expect(parsePolicyXml(f.text).filter((n) => n.kind !== "comment")).toHaveLength(1);
		const cp = textFile(s.files.find((f) => f.path === "/policyman/carrier_policy.xml"));
		const root = defined(parsePolicyXml(cp.text).find((n) => n.tag === "policy"));
		expect(root.children.map((n) => n.tag)).toEqual([
			"initial",
			"if",
			"#comment",
			"svc_mode",
			"rat_capability",
		]);
		expect(xmlRefs(defined(cp.text))).toEqual({ policy: "ROW" });
	});
});

const comboSet = (cs: Array<{ tag: string; plmns: string[] }>): BandComboSet => ({
	sha1: "x",
	variants: [],
	carriers: cs.map(({ tag, plmns }) => ({ tag, plmns, ...comboStats([]) })),
});

describe("band_combos_per_plmn.xml", () => {
	const carriers = parseBandCombos(combosXml);

	it("lists each tag's PLMNs across combo sets", () => {
		const tags = comboTagPlmns([
			comboSet(carriers),
			comboSet([{ tag: "ATT", plmns: ["310-410", "312-670"] }]),
		]);
		expect(tags.get("ATT")).toEqual(["310-150", "310-280", "310-380", "310-410", "313-100", "312-670"]);
		expect(tags.size).toBe(new Set(carriers.map((c) => c.tag)).size);
	});
});

describe("policy element notes", () => {
	it("covers every element the package's policy XML uses", () => {
		const s = basebandSummary({ "bbcfg.mbn": bbcfg, "qdsp6sw.mbn": modem });
		const xml = s.files
			.filter(isTextFile)
			.filter((f) => f.path.startsWith("/policyman/") && !f.path.endsWith("band_combos_per_plmn.xml"));
		expect(xml.length).toBeGreaterThan(10);
		const tags = new Set(
			xml.flatMap((f) =>
				[...walkPolicy(parsePolicyXml(f.text))].filter((n) => n.kind !== "comment").map((n) => n.tag),
			),
		);
		expect(tags.size).toBeGreaterThan(40);
		expect([...tags].filter((t) => !describePolicyElement(t))).toEqual([]);
	});
});

describe("basebandSummary", () => {
	const s = basebandSummary(
		{ "bbcfg.mbn": bbcfg, "pt.mbn": pt, "qdsp6sw.mbn": modem },
		{ name: "Mav25-2.10.01.Release.bbfw" },
	);

	it("is JSON-safe", () => {
		expect(JSON.parse(JSON.stringify(s))).toEqual(s);
	});

	it("lists the containers", () => {
		expect(s.containers.map((c) => [c.member, c.magic, c.records, c.blobs, c.errors])).toEqual([
			["bbcfg.mbn", "CFG", 6, 4, undefined],
			["pt.mbn", "POW", 3, 1, undefined],
		]);
		expect(
			s.containers[0]?.fileTypes.map(({ type, name, confidence, blobs, records }) => ({
				type,
				name,
				confidence,
				blobs,
				records,
			})),
		).toEqual([
			{ type: 10, name: "RFC_MMW", confidence: "high", blobs: 1, records: 1 },
			{ type: 13, name: "PROT_SKU?", confidence: "low", blobs: 1, records: 3 },
			{ type: 15, name: "PROT_NV", confidence: "high", blobs: 1, records: 1 },
			{ type: 17, name: "PROT_PRI", confidence: "high", blobs: 1, records: 1 },
		]);
		expect(s.containers[0]?.fileTypes[0]?.note).toBe(BBCFG_FILE_TYPES[10]?.note);
	});

	it("dedups files by content and records who carries them", () => {
		const bb = s.files.filter((f) => f.member === "bbcfg.mbn");
		expect(bb).toHaveLength(13);
		const combos = textFile(bb.find((f) => f.path === "/policyman/band_combos_per_plmn.xml"));
		expect(combos).toMatchObject({
			sha1: "af035cfbe9b0afdf814feccc55ee16c4f4302429",
			blobs: [3],
			variants: [{ platform: 5, sku: 0, hwRev: 0 }],
		});
		expect(combos.refs?.carriers).toHaveLength(11);
		const ftb = s.files.filter((f) => f.path === "/mcfg_ftb");
		expect(ftb).toHaveLength(1);
		expect(ftb[0]).toMatchObject({
			format: "bin",
			configs: ["CUST_SW_DEFAULT", "CUST_HW_DEFAULT", "DSDS-MN-Sariska", "MSSS-MN-Sariska"],
		});
		expect(s.files.filter((f) => f.member === "qdsp6sw.mbn")).toHaveLength(18);
		// the zlib images carried by the plain SW image are listed as configs, not files
		expect(s.files.some((f) => f.path.startsWith("/multi_mbn/"))).toBe(false);
	});

	it("keeps NV/EFS settings of protocol blobs, with known names", () => {
		expect(s.nv.map((n) => [n.blob, n.fileTypeName, n.records.length])).toEqual([
			[0, "PROT_NV", 22],
			[3, "PROT_PRI", 28],
		]);
		expect(s.nv[1]?.records[0]).toMatchObject({
			efs: "/mav/product_pri_setting_revision",
			hex: "01000d00",
			f77: 0,
			f78: 22,
		});
		// Records carry the NV tables' name and confidence, the same annotation a .der.pri gets.
		expect(s.nv[1]?.records[0]).toHaveProperty("name");
		expect(s.nv[1]?.records[0]).toHaveProperty("confidence");
		expect(s.nv[0]?.records.find((r) => r.nv === 1920)).toMatchObject({ hex: "29040000", f11: 2, f14: 94 });
	});

	it("lists MCFG images in the container", () => {
		expect(s.images).toEqual([
			{
				member: "bbcfg.mbn",
				blob: 2,
				fileType: 10,
				fileTypeName: "RFC_MMW",
				variants: [{ platform: 1, sku: 1, hwRev: 8 }],
				cfgType: "HW",
				version: "00000000",
				trailer: {
					trailerVersion: "0001",
					version: "0000000a",
					label: "generic_config_label",
					baseVersion: "0000000a",
					field8: expect.stringMatching(/^([0-9a-f]{2})+$/),
				},
				files: ["/mcfg_ftb", "/rfc/2900_0_res.dat", "/rfc/2900_0_cmn.dat"],
			},
		]);
	});

	it("parses band combos and the pt.mbn A-MPR table", () => {
		expect(s.bandCombos).toHaveLength(1);
		expect(s.bandCombos[0]?.carriers.map((c) => [c.tag, c.combos])).toContainEqual(["TMO", 646]);
		expect(s.amprNs).toHaveLength(1);
		expect(s.amprNs[0]?.groups[0]?.bands).toEqual([
			{ band: 41, nsNoCa: 4, nsWithCa: 4 },
			{ band: 48, nsNoCa: 28, nsWithCa: 11 },
		]);
		expect(s.amprNs[0]?.groups.map((g) => g.mccs.length)).toEqual([57, 1, 1, 2]);
	});

	it("parses A-MPR XML with missing values", () => {
		expect(
			parseAmprNs(
				'<ampr_configured_ns version="1"><mcc id="1 2 1"><band id="42"><ns_with_ca>8</ns_with_ca></band></mcc></ampr_configured_ns>',
			),
		).toEqual([{ mccs: ["1", "2"], bands: [{ band: 42, nsWithCa: 8 }] }]);
	});

	it("decodes the modem databases and small EFS settings", () => {
		expect(
			s.mdb?.databases.map((d) => [d.path, d.header?.creator, d.scan?.length, d.features?.length, d.error]),
		).toEqual([
			["/mdb/nr/mcc2arfcn.mdb", "Maverick", 6, undefined, undefined],
			["/mdb/nr/plmn2features.mdb", "Qualcomm", undefined, 3, undefined],
			["/mdb/lte/plmn2features_lte.mdb", "Maverick", undefined, 1, undefined],
		]);
		expect(s.mdb?.databases[0]?.configs).toEqual(["DSDS-MN-Sariska", "MSSS-MN-Sariska"]);
		expect(s.mdb?.settings.map((x) => [x.path, x.configs, x.value])).toEqual([
			["/mcfg_ftb", ["CUST_SW_DEFAULT", "CUST_HW_DEFAULT", "DSDS-MN-Sariska", "MSSS-MN-Sariska"], "clear"],
			["/policyman/fullrat_timer", ["DSDS-MN-Sariska", "MSSS-MN-Sariska"], expect.stringMatching(/^300 s/)],
			["/nv/item_files/modem/mmode/device_mode", ["DSDS-MN-Sariska"], expect.stringMatching(/DSDS/)],
			["/nv/item_files/modem/mmode/device_mode", ["MSSS-MN-Sariska"], "single SIM"],
		]);
	});

	it("pairs the SSGCCS files that serve the same platforms", () => {
		expect(s.ssgccs).toHaveLength(1);
		expect(defined(s.ssgccs)[0]?.files.map((f) => f.path)).toEqual([
			"/SSGCCS/ssgccs_config.txt",
			"/SSGCCS/ssgccs_int_config.txt",
		]);
		expect(defined(s.ssgccs)[0]?.variants).toEqual([{ platform: 5, sku: 0, hwRev: 0 }]);
		expect(defined(s.ssgccs)[0]?.config.allNetworks).toBe(true);
		expect(defined(s.ssgccs)[0]?.config.custom?.key).toBe("CUSTOM");
		expect(defined(s.ssgccs)[0]?.config.rats.map((l) => l.key)).toEqual(["GERAN"]);
	});

	it("summarises the modem configs", () => {
		expect(s.modemConfigs?.map((m) => [m.label, m.container, m.cfgType, m.trailer?.capability])).toEqual([
			["CUST_SW_DEFAULT", "plain", "SW", undefined],
			["CUST_HW_DEFAULT", "plain", "HW", undefined],
			[undefined, "plain", "SW", undefined],
			["DSDS-MN-Sariska", "zlib", "HW", "41400020"],
			["MSSS-MN-Sariska", "zlib", "HW", "40400020"],
		]);
	});
});

describe("summary views", () => {
	const s = basebandSummary({ "bbcfg.mbn": bbcfg, "pt.mbn": pt }, { name: "Mav25-2.10.01.Release.bbfw" });

	it("labels where an entry applies", () => {
		expect(variantKey({ platform: 5, sku: 1, hwRev: 6 })).toBe("5/1/6");
		expect(
			carriedBy({
				variants: [
					{ platform: 5, sku: 0, hwRev: 0 },
					{ platform: 5, sku: 1, hwRev: 0 },
				],
			}),
		).toBe("5/0/0 5/1/0");
		expect(carriedBy({ variants: [{ platform: 5, sku: 0, hwRev: 0 }], configs: ["SW_DEF"] })).toBe("SW_DEF");
	});

	it("merges platforms whose combo stats match", () => {
		const set = defined(s.bandCombos[0]);
		const tag = defined(set.carriers?.[0]).tag;
		const twin: BandComboSet = { ...set, sha1: "other", variants: [{ platform: 9, sku: 0, hwRev: 0 }] };
		const rows = mergeComboSets([set, twin, set], tag);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.sha1).toBe(set.sha1);
		expect(rows[0]?.variants.map(variantKey)).toEqual([...set.variants.map(variantKey), "9/0/0"]);
		expect(mergeComboSets([set], "NO-SUCH-TAG")).toEqual([]);
	});

	it("keys a package by section for a keyed diff", () => {
		const c = basebandComparable(s);
		expect(Object.keys(c)).toEqual([
			"Package",
			"Band combos",
			"Files",
			"Power",
			"Network databases",
			"Modem configs",
			"Containers",
		]);
		expect(Object.keys(defined(c.Files))).toContain(`bbcfg.mbn /policyman/band_combos_per_plmn.xml [5/0/0]`);
	});

	it("finds the package files a .der.pri overwrites", () => {
		const f = textFile(s.files.find((x) => x.path === "/policyman/band_combos_per_plmn.xml"));
		const pri: Pick<PriDecoded, "efs"> = {
			efs: [
				{ path: f.path, tag: "9fa70c", value: xmlValue(f.text) },
				{ path: "/policyman/elsewhere.xml", tag: "9fa70c", value: xmlValue('<?xml version="1.0"?><x/>') },
			],
		};
		const r = priReplacements(pri, s);
		expect(r.otherXml).toBe(1);
		expect(r.replaced).toEqual([
			{
				efs: f.path,
				length: f.text.length,
				baseline: [
					{
						i: s.files.indexOf(f),
						member: "bbcfg.mbn",
						variants: f.variants,
						configs: undefined,
						same: true,
					},
				],
			},
		]);
	});
});
