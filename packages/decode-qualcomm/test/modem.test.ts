/**
 * mav25/ fixtures, with values changed (test/README.md): the mdb and EFS files from Mav25-2.10.01.Release.bbfw's
 * qdsp6sw.mbn DSDS-MN-Sariska / MSSS-MN-Sariska configs; ssgccs*.txt from bbcfg.mbn blobs 1, 34, 122, 202, 282.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

import {
	decodeModemEfs,
	nrArfcnToMHz,
	parseMcc2Arfcn,
	parsePlmnCombos,
	parsePlmnFeatures,
	plmnFromKey,
	readMdb,
	type MdbFile,
} from "../src/mdb.ts";
import { parseSsgccs, SSGCCS_ACTIONS } from "../src/ssgccs.ts";
import { defined } from "./defined.ts";
import { describePolicyAttr, describePolicyElement, POLICY_ELEMENTS } from "../src/policyman.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => new Uint8Array(readFileSync(join(here, "fixtures", "mav25", name)));
const text = (name: string) => new TextDecoder().decode(fx(name));

describe("plmnFromKey (TS 24.008 PLMN bytes)", () => {
	it("decodes 2- and 3-digit MNCs and the any-MNC form", () => {
		expect(plmnFromKey(0x44f015)).toBe("440-51");
		expect(plmnFromKey(0x44f002)).toBe("440-20");
		expect(plmnFromKey(0x130061)).toBe("310-160");
		expect(plmnFromKey(0x132188)).toBe("311-882");
		expect(plmnFromKey(0x64f0ff)).toBe("460-FF");
	});
});

describe("nrArfcnToMHz (TS 38.104 5.4.2.1)", () => {
	it("uses the 5, 15 and 60 kHz rasters", () => {
		expect(nrArfcnToMHz(630000)).toBe(3450);
		expect(nrArfcnToMHz(2016667)).toBe(24250.08);
		expect(nrArfcnToMHz(151600)).toBe(758);
		expect(nrArfcnToMHz(599999)).toBe(2999.995);
		expect(nrArfcnToMHz(600000)).toBe(3000);
	});
});

/** A layout 3 database's blob. */
function blobOf(m: MdbFile): Uint8Array {
	if (m.layout !== 3) throw new Error(`layout ${m.layout}`);
	return m.blob;
}

describe("readMdb", () => {
	it("reads a layout 3 container", () => {
		const m = readMdb(fx("arfcn.mdb"));
		expect(m.header).toEqual({
			version: 1,
			layout: 3,
			creator: "Maverick",
			built: "2014-02-12T11:20:34.000Z",
		});
		expect(blobOf(m)).toHaveLength(1660);
	});

	it("reads a layout 1 index and groups keys that share a record", () => {
		const m = readMdb(fx("features.mdb"));
		expect(m.header).toMatchObject({ layout: 1, creator: "Qualcomm" });
		expect(m.header.built).toBeUndefined();
		expect(m.layout === 1 && m.records.map((r) => [r.keys.length, r.data.length])).toEqual([
			[2, 270],
			[1, 270],
			[15, 13],
		]);
	});

	it("rejects what it cannot read", () => {
		expect(() => readMdb(new Uint8Array(8))).toThrow(/too short/);
		const b = fx("arfcn.mdb").slice();
		b[1] = 7;
		expect(() => readMdb(b)).toThrow(/layout 7/);
	});
});

describe("parseMcc2Arfcn", () => {
	const scan = parseMcc2Arfcn(blobOf(readMdb(fx("arfcn.mdb"))));

	it("lists per-country NR ranges", () => {
		expect(scan.map((e) => [e.mcc, e.key, e.ranges.length, e.band])).toEqual([
			["310", 200, 2, 77],
			["310", 201, 2, 77],
			["310", 210, 2, 258],
			["302", 200, 1, 77],
			["302", 201, 1, 77],
			[undefined, 189, 4, 28],
		]);
		expect(scan[0]?.ranges[0]).toEqual({
			lo: 630000,
			hi: 636665,
			loMHz: 3450,
			hiMHz: 3549.975,
			uplink: false,
			x: 2,
		});
		expect(scan[2]?.ranges[0]).toMatchObject({ loMHz: 24250.08, hiMHz: 24449.94 });
	});

	it("labels a band only when one band holds every range", () => {
		// 703-733.59 MHz uplink alone fits n28 and SUL n83; the downlink ranges settle it
		const n28 = scan[5];
		expect(n28?.ranges.map((r) => [r.loMHz, r.hiMHz, r.uplink])).toEqual([
			[703, 733.585, true],
			[717.41, 747.995, true],
			[758, 788.585, false],
			[772.41, 802.995, false],
		]);
		expect(n28?.band).toBe(28);
		// 3450-3550 alone is inside both n77 and n78
		const one = parseMcc2Arfcn(
			Uint8Array.from(
				[...blobOf(readMdb(fx("arfcn.mdb"))).subarray(0, 28 + 272)].map((x, i) =>
					i === 8 ? 16 : i === 9 ? 1 : i === 36 ? 1 : x,
				),
			),
		);
		expect(one[0]?.ranges).toHaveLength(1);
		expect(one[0]?.band).toBeUndefined();
	});
});

describe("parsePlmnFeatures", () => {
	it("decodes NR records into feature pairs, keeping other shapes as hex", () => {
		const f = parsePlmnFeatures(readMdb(fx("features.mdb")));
		expect(f.map((x) => x.plmns.slice(0, 2))).toEqual([
			["440-51", "440-54"],
			["440-20"],
			["310-160", "310-200"],
		]);
		expect(f[0]?.tag).toBe(0x303);
		expect(f[0]?.features).toHaveLength(35);
		expect(f[0]?.features?.slice(0, 3)).toEqual([
			[1, 3],
			[2, 2],
			[4, 2],
		]);
		// KDDI and SoftBank differ only in ids 78, 47 and 64
		const softbank = defined(f[1]?.features);
		const diff = defined(f[0]?.features)
			.filter(([id, v]) => defined(softbank.find((y) => y[0] === id))[1] !== v)
			.map((x) => x[0]);
		expect(diff).toEqual([78, 47]);
		expect(f[2]?.plmns).toHaveLength(15);
		expect(f[2]?.features).toBeUndefined();
		expect(f[2]?.hex).toBe("170000000100000002");
	});

	it("reads the LTE database", () => {
		expect(parsePlmnFeatures(readMdb(fx("features-lte.mdb")))).toEqual([
			{ plmns: ["460-FF"], tag: 0x37f, hex: "080000001000000001010101010000005a005a005a005b" },
		]);
	});
});

const le32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];

/** A Samsung CPP2 mdb: header says layout 3, body is an index and records, as layout 1's. */
function cpp2(key: number, combos: string): Uint8Array {
	const list = [...new TextEncoder().encode(combos), 0];
	const record = Uint8Array.from([...le32(0x303), ...le32(0), ...le32(list.length), ...list]);
	const index = Uint8Array.from([4, 8, 400, 8192, 8, 0, key, 0].flatMap(le32));
	const zIndex = deflateSync(index);
	const zRecord = deflateSync(record);
	const header = new Uint8Array(0x30);
	header.set([1, 3, ...new TextEncoder().encode("CPP2")]);
	return Uint8Array.from([
		...header,
		...le32(zIndex.length),
		...le32(index.length),
		...zIndex,
		record.length & 0xff,
		record.length >> 8,
		zRecord.length & 0xff,
		zRecord.length >> 8,
		...zRecord,
	]);
}

describe("parsePlmnCombos", () => {
	it("reads a CPP2 file, indexed though its header says layout 3, as each PLMN's combination strings", () => {
		const f = readMdb(cpp2(0x03f2ff, "b1AA-n3AA;b2A-b7A-n66AA;n77AA;"));
		expect([f.header.creator, f.layout]).toEqual(["CPP2", 1]);
		expect(parsePlmnCombos(f)).toEqual([
			{ plmns: ["302-FF"], tag: 0x303, reserved: 0, combos: ["b1AA-n3AA", "b2A-b7A-n66AA", "n77AA"] },
		]);
	});

	it("refuses a record whose length field disagrees", () => {
		const f = readMdb(cpp2(0x03f2ff, "b1AA"));
		if (f.layout !== 1) throw new Error("not indexed");
		const [r] = f.records;
		if (r === undefined) throw new Error("no record");
		expect(() => parsePlmnCombos({ ...f, records: [{ ...r, data: r.data.subarray(0, 14) }] })).toThrow(
			/length/,
		);
	});
});

describe("decodeModemEfs", () => {
	it("names the small EFS files", () => {
		expect(
			decodeModemEfs("/policyman/fullrat_timer", Uint8Array.from([0x2c, 1, 0, 0, 0x78, 0x5d, 2, 0]))?.value,
		).toMatch(/^300 s .*155000/);
		expect(decodeModemEfs("/nv/item_files/modem/mmode/device_mode", Uint8Array.of(1))?.value).toMatch(/DSDS/);
		expect(decodeModemEfs("/nv/item_files/modem/mmode/device_mode", Uint8Array.of(0))?.value).toBe(
			"single SIM",
		);
		expect(
			decodeModemEfs(
				"/protected/mcfg/active_int_carrier_info",
				new TextEncoder().encode("SW_DEF\0\0\0\0\0\0\0"),
			)?.value,
		).toBe("SW_DEF");
		expect(decodeModemEfs("/mcfg_ftb", new Uint8Array(8))).toMatchObject({
			value: "clear",
			confidence: "low",
		});
		expect(decodeModemEfs("/policyman/fullrat_timer", new Uint8Array(4))).toBeUndefined();
		expect(decodeModemEfs("/other", new Uint8Array(1))).toBeUndefined();
	});
});

describe("parseSsgccs", () => {
	const c = parseSsgccs(text("ssgccs.txt"), text("ssgccs-int.txt"));

	it("names the thresholds", () => {
		expect(c.allNetworks).toBe(true);
		expect(c.plmns).toEqual([]);
		expect(c.custom?.fields.map((f) => [f.name, f.value, f.confidence])).toEqual([
			["Mode", "2", "med"],
			["Countermeasure threshold", "600", "med"],
			["Alert threshold", "250", "med"],
			["Hostile threshold", "600", "med"],
			["Filter", "0", "med"],
		]);
	});

	it("reads the per-RAT line: enable, five numbers, an action word", () => {
		const g = defined(c.rats.find((l) => l.key === "GERAN"));
		expect(g).toMatchObject({
			title: "GSM settings",
			confidence: "low",
			raw: "GERAN: 1, 400, 6, 12, 40, 70, DEFAULT",
		});
		expect(g.fields.map((f) => f.name)).toEqual([
			"Enabled",
			"Parameter 1",
			"Parameter 2",
			"Parameter 3",
			"Parameter 4",
			"Parameter 5",
			"Action",
		]);
		expect(g.fields.at(-1)).toEqual({
			name: "Action",
			value: "DEFAULT",
			meaning: SSGCCS_ACTIONS.DEFAULT,
			confidence: "low",
		});
		expect(SSGCCS_ACTIONS.DEFAULT).toBeTruthy();
	});

	it("keeps unknown keys and a PLMN list", () => {
		const x = parseSsgccs("ACTIVE_PLMN_LIST: 310-260, 311-490\r\nLTE_JAMMING: 1, 2\nnot a line\0\0");
		expect(x).toMatchObject({ allNetworks: false, plmns: ["310-260", "311-490"], rats: [] });
		expect(x.custom).toBeUndefined();
		expect(x.other.map((l) => [l.key, l.confidence, l.fields.map((f) => f.name)])).toEqual([
			["LTE_JAMMING", "unknown", ["Field 1", "Field 2"]],
		]);
	});
});

describe("policy element notes", () => {
	it("every entry is well formed", () => {
		const kinds = new Set(["root", "block", "condition", "action", "value"]);
		for (const [name, d] of Object.entries(POLICY_ELEMENTS)) {
			expect(kinds.has(d.kind), name).toBe(true);
			expect(["high", "med", "low"]).toContain(d.confidence);
			expect(d.note.trim(), name).not.toBe("");
		}
	});

	it("does not answer for prototype keys or unknown names", () => {
		expect(describePolicyElement("toString")).toBeUndefined();
		expect(describePolicyElement("carrier_name")).toBeUndefined();
	});

	it("falls back to the common attribute notes", () => {
		expect(describePolicyAttr("rf_bands", "subs")).toMatch(/dds/);
		expect(describePolicyAttr("device_configuration", "num_sims")).toBeTruthy();
		expect(describePolicyAttr("policy", "constructor")).toBeUndefined();
	});
});
