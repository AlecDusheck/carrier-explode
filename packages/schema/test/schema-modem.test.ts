/** Modem configuration: each family's mapper on the decoders' fixtures, and iPhone overrides against Pixel MCFG. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync, zlibSync } from "fflate";
import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { crc32, packFiles, sha1Hex, u32Hex } from "@carrier-explode/binary";
import {
	decodedPri,
	decodeFile,
	dialectLabel,
	openIpcc,
	type OpenedBundle,
	type PriValue,
} from "@carrier-explode/decode-ios";
import { pairSelection, parseMcfg, parseSelectionDb } from "@carrier-explode/decode-qualcomm";
import { decodeCarrierDb, decodeConfseq } from "@carrier-explode/decode-shannon";

import { modemConfigSchema } from "../src/records.ts";
import {
	iosModemConfig,
	layeredRadio,
	modemConfig,
	modemFamilyName,
	type BandCombination,
	type ModemConfig,
	type ModemItem,
	type ModemValue,
	type SimMatcher,
} from "../src/index.ts";
import type { ConfigDraft, MappedConfig } from "../src/modem/archive.ts";
import { normalizeMapped } from "../src/modem/index.ts";
import { firmwareFamily } from "../src/modem-names.ts";
import { mediatekConfig } from "../src/modem/mediatek/index.ts";
import { qualcommConfig, selectionSims } from "../src/modem/qualcomm/index.ts";
import { shannonConfig } from "../src/modem/shannon/index.ts";

const fixture = (pkg: string, name: string): Uint8Array =>
	new Uint8Array(readFileSync(join(import.meta.dirname, "..", "..", pkg, "test", "fixtures", name)));
const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
/** Normalized, survives a JSON round trip and validates, as a stored norm read does: the config, and its base. */
async function stored(m: MappedConfig): Promise<boolean> {
	const n = await normalizeMapped(m);
	return [n.config, ...(n.base ? [n.base] : [])].every(valid);
}
const valid = (c: ModemConfig): boolean => v.is(modemConfigSchema, JSON.parse(JSON.stringify(c)));
const byId = (c: Pick<ModemConfig, "items">, id: string): unknown => c.items.find((i) => i.id === id);
/** Every source's combinations, in order. */
const combinations = (c: Pick<ConfigDraft, "combos">): BandCombination[] =>
	c.combos.flatMap(([, list]) => list);

/** A bundle holding `files` as given, plus an Info.plist. */
function bundle(name: string, files: Readonly<Record<string, Uint8Array>>): ReturnType<typeof openIpcc> {
	const info = new TextEncoder().encode(
		'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>1.0</string></dict></plist>',
	);
	return openIpcc(
		zipSync(
			Object.fromEntries(
				Object.entries({ "Info.plist": info, ...files }).map(([p, b]) => [`Payload/${name}.bundle/${p}`, b]),
			),
		),
	);
}

/** A bundle with one override file. */
const priBundle = (name: string, pri: Uint8Array): ReturnType<typeof openIpcc> =>
	bundle(name, { "overrides_D93_D94_D47_D48.der.pri": pri });

/** Pixel MCFG with the selection records that pair with it, as the extractor packs them. */
function pixelFiles(mbn: Uint8Array, selDb: string): Map<string, Uint8Array> {
	const image = parseMcfg(mbn);
	if (image === undefined) throw new Error("not MCFG");
	const records = pairSelection([{ image }], parseSelectionDb(selDb)).paired.flatMap((p) => p.records);
	return new Map([
		["mcfg_sw.mbn", mbn],
		["selection.json", json(records)],
	]);
}

const u16 = (n: number): number[] => [n & 0xff, n >> 8];
const u32 = (n: number): number[] => [...u16(n & 0xffff), ...u16(n >>> 16)];
const mcfgItem = (type: number, attr: number, body: number[]): number[] => [
	...u32(8 + body.length),
	type,
	attr,
	0,
	0,
	...body,
];
const nv = (attr: number, n: number, data: number[]): number[] =>
	mcfgItem(1, attr, [...u16(n), ...u16(data.length), ...data]);
const efs = (attr: number, path: string, data: number[]): number[] => {
	const p = [...new TextEncoder().encode(path), 0];
	return mcfgItem(2, attr, [...u16(1), ...u16(p.length), ...p, ...u16(2), ...u16(data.length), ...data]);
};

describe("qualcommConfig", () => {
	const files = pixelFiles(
		fixture("decode-qualcomm", "pixel5a/dcm-cut.mbn"),
		new TextDecoder().decode(fixture("decode-qualcomm", "pixel5a/mcfg_sel_db-cut.xml")),
	);
	const mapped = qualcommConfig(files, "s1");
	const c = mapped.config;

	it("names NV items and EFS files from describeNv, with its confidence, and selects by the rule's PLMNs", async () => {
		expect(await stored(mapped)).toBe(true);
		expect([c.family, c.label, c.scope, c.selection, mapped.base]).toEqual([
			"qualcomm",
			"Commercial-DCM",
			"carrier",
			[{ mccmnc: "44010" }],
			null,
		]);
		expect(c.items.map((i) => i.id)).toEqual([
			"efs:/nv/item_files/ims/IMS_enable",
			"efs:/nv/item_files/modem/data/3gpp/global_throttling",
			"nv:1896",
			"nv:909",
			"nv:3533",
		]);
		expect(c.combos).toEqual([]);
		expect(c.errors).toEqual([]);
	});

	it("types each value, with the decoders' meaning and label, and states the trailer as built-for facts", () => {
		expect(byId(c, "efs:/nv/item_files/ims/IMS_enable")).toEqual({
			id: "efs:/nv/item_files/ims/IMS_enable",
			name: "IMS enable",
			description: "Enables the IMS task (VoLTE, VoWiFi, SMS over IMS)",
			value: { kind: "number", value: 1 },
			label: "Enabled",
			certainty: "high",
		});
		expect(byId(c, "efs:/nv/item_files/modem/data/3gpp/global_throttling")).toMatchObject({
			value: { kind: "number", value: 512 },
			label: null,
		});
		expect(c.facts).toEqual(
			expect.arrayContaining([
				{ label: "Built for IINs", value: "8981100 (flag 0)" },
				{ label: "Built for PLMNs", value: "440-10 (flag 0)" },
				{ label: "Applicable MCC-MNC", value: "10, 440" },
			]),
		);
		expect(c.facts.map((f) => f.label)).toContain("Trailer field 8");
	});

	it("keeps the config when the band combos do not read, with the error", async () => {
		const badMapped = qualcommConfig(
			new Map([
				...files,
				[
					"band_combos_per_plmn.xml",
					new TextEncoder().encode("<CARRIER_LIST><PLMN-ID>440-10</PLMN-ID><DCM>b1Z[x]</DCM></CARRIER_LIST>"),
				],
			]),
			"s1",
		);
		const bad = badMapped.config;
		expect(await stored(badMapped)).toBe(true);
		expect(bad.items).toEqual(c.items);
		expect(bad.combos).toEqual([]);
		expect(bad.errors).toEqual([expect.stringMatching(/^band_combos_per_plmn\.xml: /)]);
	});

	it("reads band combos listed under the selected PLMNs, one list per carrier tag, stored apart by content", async () => {
		const xml =
			"<CARRIER_LIST><PLMN-ID>440-10</PLMN-ID><DCM>b1A[4]-n78A[2,2]A;b3C[4:30]</DCM><PLMN-ID>310-260</PLMN-ID><TMO>b2A</TMO></CARRIER_LIST>";
		const withCombos = qualcommConfig(
			new Map([...files, ["band_combos_per_plmn.xml", new TextEncoder().encode(xml)]]),
			"s1",
		);
		const list = [
			[
				{ band: "B1", dl: "A", dlLayers: 4 },
				{ band: "n78", dl: "A", ul: "A", dlLayers: 2 },
			],
			[{ band: "B3", dl: "C", dlLayers: 4 }],
		];
		expect(withCombos.config.combos).toEqual([["band_combos_per_plmn.xml: DCM", list]]);
		const n = await normalizeMapped(withCombos);
		const [set] = n.config.combos;
		expect(n.config.combos).toEqual([
			{ key: expect.stringMatching(/^[0-9a-f]{64}$/), sources: ["band_combos_per_plmn.xml: DCM"], count: 2 },
		]);
		expect(set && n.combos.get(set.key)).toEqual(list);
	});

	it("is the firmware's own when no selection record names it, or one selects it whatever the SIM", () => {
		const always = [{ carrierName: "ROW", carrierIndex: 8, rule: { kind: "always" }, options: {} }];
		expect(qualcommConfig(new Map([...files, ["selection.json", json([])]]), "s1").config.scope).toBe(
			"firmware",
		);
		expect(qualcommConfig(new Map([...files, ["selection.json", json(always)]]), "s1").config.scope).toBe(
			"firmware",
		);
	});

	it("turns rule trees into SimMatchers, leaving out what a SimMatcher cannot state", () => {
		const db = parseSelectionDb(
			new TextDecoder().decode(fixture("decode-qualcomm", "pixel5a/mcfg_sel_db-cut.xml")),
		);
		const sims = (name: string): SimMatcher[] =>
			selectionSims(db.records.filter((r) => r.carrierName === name));
		expect(sims("KDDI")).toEqual([{ mccmnc: "44051" }, { mccmnc: "44050" }]);
		// 302-720 and (GID1 D2 or custom id 20): only the GID1 way in is a SimMatcher.
		expect(sims("Chatr")).toEqual([{ mccmnc: "302720", gid1: "D2" }]);
		// Every way in needs custom id 11.
		expect(sims("USCC-Fi")).toEqual([]);
		expect(sims("ROW")).toEqual([]);
	});

	describe("a Galaxy image: GID1 branches, a 0x40 file, MDB combinations and a replaced write", () => {
		const banner = (text: string): number[] => nv(0x19, 71, [7, ...new TextEncoder().encode(text), 0]);
		const gid1 = (text: string): number[] => {
			const t = [...new TextEncoder().encode(text), 0];
			return [1, ...u16(2), ...u16(10), 2, ...u16(t.length), ...t];
		};
		const branch = (n: number, test: number[]): number[] => mcfgItem(12, 0xff, [0, 1, 0, n, ...test]);
		const combosText = [...new TextEncoder().encode("b1AA-n3AA;n77AA;"), 0];
		const cppRecord = [...u32(0x303), ...u32(0), ...u32(combosText.length), ...combosText];
		const index = [4, 8, 400, 8192, 8, 0, 0x03f2ff, 0].flatMap(u32);
		const [zIndex, zRecord] = [zlibSync(Uint8Array.from(index)), zlibSync(Uint8Array.from(cppRecord))];
		const mdb = [
			1,
			3,
			...new TextEncoder().encode("CPP2"),
			...Array.from({ length: 0x30 - 6 }, () => 0),
			...u32(zIndex.length),
			...u32(index.length),
			...zIndex,
			...u16(cppRecord.length),
			...u16(zRecord.length),
			...zRecord,
		];
		const p = [...new TextEncoder().encode("/mdb/nr/plmn2cacombos_nr_sub.mdb"), 0];
		const mdbItem = mcfgItem(23, 0x19, [
			...u16(1),
			...u16(p.length),
			...p,
			...u16(2),
			...u32(mdb.length + 1),
			7,
			...mdb,
		]);
		const trailer = mcfgItem(10, 0, [
			0xa1,
			0,
			0,
			0,
			...new TextEncoder().encode("MCFG_TRL"),
			3,
			...u16(3),
			...new TextEncoder().encode("ATT"),
			4,
			...u16(6),
			0,
			1,
			...u32(8901410),
			6,
			...u16(6),
			0,
			1,
			...u16(310),
			...u16(410),
			9,
			0,
			0,
		]);
		const items = [
			banner("Parent_config"),
			efs(0x40, "/mcfg_ftb", [0, 4, 0, 0, 0, 0, 0, 0]),
			branch(0, gid1("0 53FF")),
			banner("ATT_5G_w_NSA"),
			branch(2, []),
			banner("ATT_normal"),
			branch(3, []),
			banner("ATT_final"),
			mdbItem,
			trailer,
		];
		const mbn = Uint8Array.from([
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
		const galaxy = qualcommConfig(
			new Map([
				["mcfg_sw.mbn", mbn],
				["selection.json", json([])],
			]),
			"s4",
		);
		const g = galaxy.config;
		const text = (id: string): unknown => {
			const value = g.items.find((i) => i.id === id)?.value;
			return value?.kind === "text" ? value.value : value;
		};

		it("keeps every branch's item under the branch's test, and an earlier write a later one replaces", async () => {
			expect(await stored(galaxy)).toBe(true);
			expect(g.errors).toEqual([]);
			expect(text("nv:71?if=0 53FF")).toBe("ATT_5G_w_NSA");
			expect(text("nv:71?else")).toBe("ATT_normal");
			expect(text("nv:71")).toBe("ATT_final");
			expect(g.items.find((i) => i.id === "nv:71?item 0")).toMatchObject({
				value: { kind: "text", value: "Parent_config" },
				description: expect.stringMatching(/^Written earlier in the file/),
			});
			expect(byId(g, "mcfg:2")).toMatchObject({
				value: {
					kind: "fields",
					fields: {
						branch: { kind: "text", value: "if" },
						conditions: {
							kind: "list",
							values: [{ kind: "fields", fields: { text: { kind: "text", value: "0 53FF" } } }],
						},
					},
				},
			});
		});

		it("reads /mcfg_ftb's attribute 0x40 data as its value, the MDB's combinations and the trailer's lists", () => {
			expect(byId(g, "efs:/mcfg_ftb")).toMatchObject({
				name: "MCFG first-boot flag",
				label: "0004000000000000",
			});
			expect(g.combos).toEqual([
				[
					"/mdb/nr/plmn2cacombos_nr_sub.mdb: 302-FF",
					[
						[
							{ band: "B1", dl: "A", ul: "A" },
							{ band: "n3", dl: "A", ul: "A" },
						],
						[{ band: "n77", dl: "A", ul: "A" }],
					],
				],
			]);
			expect(g.facts).toEqual([
				{ label: "Built for IINs", value: "8901410 (flag 0)" },
				{ label: "Built for PLMNs", value: "310-410 (flag 0)" },
			]);
		});
	});

	describe("items with prefix bytes, no value or a layout", () => {
		const label = [...new TextEncoder().encode("Test")];
		const trailer = mcfgItem(10, 0, [
			0xa1,
			0,
			0,
			0,
			...new TextEncoder().encode("MCFG_TRL"),
			3,
			...u16(label.length),
			...label,
			9,
			0,
			0,
		]);
		const items = [
			nv(0x39, 10, [7, 0, 4, 0]),
			// The secondary subscriptions' mode preference, GSM only.
			nv(0x39, 10, [6, 0, 13, 0]),
			nv(0x19, 1897, [7, 0xf4, 1, 0xa0, 0xf, 0xa0, 0xf, 3, 0, 3, 0, 0, 0]),
			nv(0x39, 1206, [7, 2, ...Array.from({ length: 26 }, () => 1)]),
			// Its class leads with an EVRC NAM byte that the attributes do not mark.
			nv(0x19, 285, [7, 0, 1, 3, 0, 3, 0, 3, 0]),
			nv(0x39, 850, [7, 0, 1]),
			efs(0x58, "/sd/mru001", [7]),
			trailer,
		];
		const mbn = Uint8Array.from([
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
		const prefixedMapped = qualcommConfig(
			new Map([
				["mcfg_sw.mbn", mbn],
				["selection.json", json([])],
			]),
			"s2",
		);
		const prefixed = prefixedMapped.config;

		it("ids each item by its index and a subscription mask narrower than all, with values read past both", async () => {
			expect(await stored(prefixedMapped)).toBe(true);
			expect(prefixed.items.map((i) => i.id)).toEqual([
				"nv:10",
				"nv:10@6",
				"nv:1897",
				"nv:1206/2",
				"nv:285",
				"nv:850",
				"efs:/sd/mru001",
			]);
			expect(byId(prefixed, "nv:10")).toMatchObject({
				value: { kind: "number", value: 4 },
				label: "Automatic",
			});
			expect(byId(prefixed, "nv:10@6")).toMatchObject({
				value: { kind: "number", value: 13 },
				label: "GSM only",
			});
			expect(byId(prefixed, "efs:/sd/mru001")).toMatchObject({
				value: { kind: "bytes", hex: "" },
				label: "No value",
			});
		});

		it("reads values of a layout's size as its fields, and keeps others as stored with an error", () => {
			expect(byId(prefixed, "nv:1897")).toMatchObject({
				value: {
					kind: "fields",
					fields: {
						InitSolDelay: { kind: "number", value: 500 },
						MaxResolAttempts: { kind: "number", value: 3 },
					},
				},
			});
			expect(byId(prefixed, "nv:285")).toMatchObject({
				value: {
					kind: "fields",
					fields: {
						EvrcCapabilityEnabled: { kind: "number", value: 1 },
						RoamOrigVoiceSo: { kind: "number", value: 3 },
					},
				},
			});
			expect(byId(prefixed, "nv:850")).toMatchObject({ value: { kind: "bytes", hex: "01" }, label: null });
			expect(prefixed.errors).toEqual(["nv:850: 1 bytes where its layout has 2; shown as stored"]);
		});
	});
});

const varint = (n: number): number[] => {
	const out: number[] = [];
	for (; n > 0x7f; n = Math.floor(n / 128)) out.push((n & 0x7f) | 0x80);
	return [...out, n];
};

/** Protobuf bytes from (field, value) pairs: numbers as varints, everything else length-delimited. */
function pb(fields: readonly (readonly [number, number | string | Uint8Array])[]): Uint8Array {
	return new Uint8Array(
		fields.flatMap(([f, x]) => {
			if (typeof x === "number") return [...varint(f * 8), ...varint(x)];
			const b = typeof x === "string" ? new TextEncoder().encode(x) : x;
			return [...varint(f * 8 + 2), ...varint(b.length), ...b];
		}),
	);
}
const nameHash = (name: string): number => crc32(new TextEncoder().encode(name));
const hexBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

describe("shannonConfig", () => {
	const plain = fixture("decode-shannon", "confseq-plain.pb");
	const ca = fixture("decode-shannon", "confseq-clz4.bin");
	const entry = (scope: number, seq: Uint8Array, base: boolean): Uint8Array =>
		pb([
			...(scope === 0 ? [] : [[1, scope] as const]),
			[2, hexBytes(sha1Hex(seq))],
			...(base ? [[4, 1] as const] : []),
			[8, 4],
		]);
	// common: the CA layer; sim1: the carrier layer, then the same again as sim2.
	const manifest = pb([
		[1, "v0.1"],
		[2, "xx_test"],
		[3, 4242],
		[5, entry(0, ca, true)],
		[5, entry(1, plain, false)],
		[5, entry(2, plain, false)],
	]);
	const db = decodeCarrierDb(fixture("decode-shannon", "cfg.db"));
	const matchers = db.carriers.filter((x) => x.id >= 4242 && x.id <= 4245).flatMap((x) => x.matchers);
	const MTU = "!NRPM.MTU_DEFAULT_SIZE";
	// The carrier layer's items, and the CA base layer's.
	const [OWN, BASE] = [4, 61];
	// The registry defines the carrier layer's items only, so the base layer's show untyped.
	const mtu = u32Hex(crc32(new TextEncoder().encode(MTU)));
	const ownDefs = Object.fromEntries(
		decodeConfseq(plain).items.map((item) => {
			const hash = u32Hex(item.hash);
			return [
				hash,
				{ name: hash === mtu ? MTU : `ITEM_${hash}`, type: "s64", capacity: Math.max(1, item.values.length) },
			];
		}),
	);
	const files = new Map<string, Uint8Array>([
		["manifest.pb", manifest],
		[`confseqs/${sha1Hex(plain)}.pb`, plain],
		[`confseqs/${sha1Hex(ca)}.pb`, ca],
		["items.json", json(ownDefs)],
		["carrier.json", json(matchers)],
		["uecap/TMO_1.binarypb", fixture("decode-shannon", "uecap-combinations.pb")],
		["uecap/lte_1.binarypb", fixture("decode-shannon", "uecap-lte.pb")],
		["uecap/ap_plmn_mapping.binarypb", fixture("decode-shannon", "uecap-plmn.pb")],
	]);

	const mapped = shannonConfig(files, "s2");
	const c = mapped.config;

	it("labels by the manifest and selects by cfg.db's prefix patterns", async () => {
		expect(await stored(mapped)).toBe(true);
		expect([c.family, c.label, c.scope]).toEqual(["shannon", "xx_test", "carrier"]);
		expect(c.facts).toEqual([
			{ label: "Manifest version", value: "v0.1" },
			{ label: "Carrier id", value: "4242" },
			{ label: "cfg.db rule", value: `310120 · certificate ${"0".repeat(64)} (no SIM matcher states it)` },
		]);
		expect(c.errors).toEqual([]);
		expect(c.selection).toEqual([
			{ mccmnc: "310260" },
			{ mccmnc: "31026" },
			{ mccmnc: "310260", imsiPrefix: "31026097" },
			{ mccmnc: "310260", gid1: "4276" },
			{ mccmnc: "20404", spn: "TEST SPN", iccidPrefix: "898603" },
		]);
	});

	it("keeps what its own layers set, merging scopes, and the base layers apart as the firmware's", () => {
		expect(c.items).toHaveLength(OWN);
		// Set alike in sim1 and sim2, so one value.
		expect(c.items.find((i) => i.name === MTU)).toMatchObject({
			value: { kind: "number", value: 1400 },
			description: "s64",
			label: null,
			certainty: "medium",
		});
		expect(mapped.base).toMatchObject({ family: "shannon", scope: "firmware", selection: [], facts: [] });
		expect(
			mapped.base?.errors.every((e) =>
				e.endsWith("not in the modem's item registry; its values are shown untyped"),
			),
		).toBe(true);
		expect(mapped.base?.items).toHaveLength(BASE);
		expect(
			[...c.items, ...(mapped.base?.items ?? [])]
				.filter((i) => i.name === null)
				.every((i) => i.certainty === "opaque" && /^crc:[0-9a-f]{8}$/.test(i.id)),
		).toBe(true);
	});

	it("names the same base for every config on the same base layers, by its content", async () => {
		const other = new Map([
			...files,
			[
				"manifest.pb",
				pb([
					[1, "v0.1"],
					[2, "yy_test"],
					[3, 4243],
					[5, entry(0, ca, true)],
					[5, entry(1, plain, false)],
				]),
			],
		]);
		const [a, b] = await Promise.all([normalizeMapped(mapped), normalizeMapped(shannonConfig(other, "s9"))]);
		expect(a.config.base).toMatch(/^[0-9a-f]{64}$/);
		expect([b.config.base, b.base?.sha]).toEqual([a.config.base, a.config.base]);
	});

	it("reads each uecap file as a list of its own", () => {
		expect(c.combos.map(([source, list]) => [source, list.length])).toEqual([
			["uecap/TMO_1.binarypb", 6],
			["uecap/lte_1.binarypb", 4],
			["LTE CA items", 0],
		]);
		// Files in UTF-8 order: TMO_1's n41C+A (100 + 80 MHz), then lte_1's 1A2-3A4A.
		expect(combinations(c)[2]).toEqual([
			{
				band: "n41",
				dl: "C",
				ul: "A",
				dlLayers: 4,
				bandwidthMhz: 180,
				scsKhz: 30,
				dlFeatureSet: expect.any(Number),
				ulFeatureSet: expect.any(Number),
				dlCarriers: [
					expect.objectContaining({ scsKhz: 30, bandwidthMhz: 100, layers: 4 }),
					expect.objectContaining({ scsKhz: 30, bandwidthMhz: 80, layers: 4 }),
				],
				ulCarriers: [expect.objectContaining({ scsKhz: 30, bandwidthMhz: 100, layers: 2 })],
			},
		]);
		expect(combinations(c)[6]).toEqual([
			{ band: "B1", dl: "A", dlLayers: 2 },
			{ band: "B3", dl: "A", ul: "A", dlLayers: 4 },
		]);
	});

	it("is the firmware's own when cfg.db names no SIM for it", () => {
		expect(shannonConfig(new Map([...files, ["carrier.json", json([])]]), "s2").config.scope).toBe(
			"firmware",
		);
	});

	it("types multi-value items as lists and values that differ by scope as fields", () => {
		const all = [...c.items, ...(mapped.base?.items ?? [])];
		const kinds = new Set(all.map((i) => i.value.kind));
		expect([...kinds].every((k) => ["number", "list", "fields"].includes(k))).toBe(true);
		const list = all.find((i) => i.value.kind === "list");
		expect(list?.value).toMatchObject({
			kind: "list",
			values: expect.arrayContaining([{ kind: "number", value: expect.any(Number) }]),
		});
	});

	it("keeps the rest when a confseq or uecap file does not decode, with the errors", async () => {
		const broken = shannonConfig(
			new Map([
				...files,
				[`confseqs/${sha1Hex(plain)}.pb`, new Uint8Array([0xff])],
				["uecap/TMO_1.binarypb", new Uint8Array([0xff])],
			]),
			"s2",
		);
		expect(await stored(broken)).toBe(true);
		expect(broken.config.errors).toEqual([
			expect.stringMatching(new RegExp(`^confseqs/${sha1Hex(plain)}\\.pb: `)),
			expect.stringMatching(/^uecap\/TMO_1\.binarypb: /),
		]);
		// The base layer still reads, and lte_1's combinations.
		expect(broken.base?.items).toHaveLength(BASE);
		expect(combinations(broken.config)).toHaveLength(4);
	});

	describe("with items.json", () => {
		const hex = (name: string): string => nameHash(name).toString(16).padStart(8, "0");
		const item = (name: string, ...values: number[]): readonly [number, Uint8Array] => [
			4,
			pb([[1, nameHash(name)], ...values.map((x) => [2, pb(x === 0 ? [] : [[3, x]])] as const)]),
		];
		const seq = (name: string, ...items: (readonly [number, Uint8Array])[]): Uint8Array =>
			pb([[1, "v1.0"], [2, name], ...items]);
		const URI = "PSS.AIMS.XCAP.ROOT.URI";
		const comb = (...dl: number[]): (readonly [number, Uint8Array])[] => [
			item("UECAPA_REL10_CA_COMB_NUM", 1),
			item("UECAPA_REL10_CA_COMB_1_NUM_BAND", 2),
			item("UECAPA_REL10_CA_COMB_1_BAND", 1, 3),
			item("UECAPA_REL10_CA_COMB_1_DL_BW_CLASS_BIT_MAP", ...dl),
			item("UECAPA_REL10_CA_COMB_1_UL_BW_CLASS_BIT_MAP", 0, 0x8000),
		];
		// NOT_IN_REGISTRY has no definition in items.json, as a firmware's registry can lack an item its confseqs set.
		const common = seq(
			"default.common",
			item("PSS.AIMS.EVS.ChAwRecv", 255, 0),
			item(URI, ...[..."/mtas"].map((ch) => ch.charCodeAt(0)), 0),
			item("AP_BASED_EMC", 1, 2),
			item("NOT_IN_REGISTRY", 7),
		);
		// Two hardware variants' layers, alike but for MTU.
		const hw0 = seq("lte_ca_0x241_0.common", ...comb(0x8000, 0x8001), item(MTU, 1400));
		const hw1 = seq("lte_ca_0x242_0.common", ...comb(0x8000, 0x8001), item(MTU, 1500));
		const on = (variant: number, layer: Uint8Array): Uint8Array =>
			pb([[2, hexBytes(sha1Hex(layer))], [6, 4], [7, 14], ...(variant ? [[8, variant] as const] : [])]);
		const defs = {
			"PSS.AIMS.EVS.ChAwRecv": ["s8", 2],
			[URI]: ["u8", 100],
			[MTU]: ["u16", 1],
			AP_BASED_EMC: ["u8", 1],
			UECAPA_REL10_CA_COMB_NUM: ["u16", 1],
			UECAPA_REL10_CA_COMB_1_NUM_BAND: ["u8", 1],
			UECAPA_REL10_CA_COMB_1_BAND: ["u16", 6],
			UECAPA_REL10_CA_COMB_1_DL_BW_CLASS_BIT_MAP: ["u16", 6],
			UECAPA_REL10_CA_COMB_1_UL_BW_CLASS_BIT_MAP: ["u16", 6],
		} as const;
		const m = shannonConfig(
			new Map([
				[
					"manifest.pb",
					pb([
						[1, "v0.1"],
						[2, "xx_test"],
						[
							5,
							pb([
								[2, hexBytes(sha1Hex(common))],
								[8, 4],
							]),
						],
						[5, on(0, hw0)],
						[5, on(1, hw1)],
					]),
				],
				...[common, hw0, hw1].map((b) => [`confseqs/${sha1Hex(b)}.pb`, b] as const),
				[
					"items.json",
					json(
						Object.fromEntries(
							Object.entries(defs).map(([name, [type, capacity]]) => [hex(name), { name, type, capacity }]),
						),
					),
				],
				["carrier.json", json([])],
			]),
			"s3",
		);
		const layered = m.config;
		const byName = (name: string): unknown => layered.items.find((i) => i.name === name);

		it("reads each value at its registry type, described by it", async () => {
			expect(await stored(m)).toBe(true);
			expect(byName("PSS.AIMS.EVS.ChAwRecv")).toMatchObject({
				description: "s8[2]",
				value: {
					kind: "list",
					values: [
						{ kind: "number", value: -1 },
						{ kind: "number", value: 0 },
					],
				},
			});
			expect(byName(URI)).toMatchObject({
				description: "u8[100]",
				value: { kind: "text", value: "/mtas" },
				certainty: "medium",
			});
		});

		it("keys a value that differs by hardware by scope and condition, and keeps one that breaks its type, untyped, with an error", () => {
			expect(byName(MTU)).toMatchObject({
				value: {
					kind: "fields",
					fields: {
						"common · hw 4=14/0": { kind: "number", value: 1400 },
						"common · hw 4=14/1": { kind: "number", value: 1500 },
					},
				},
			});
			expect(byName("UECAPA_REL10_CA_COMB_NUM")).toMatchObject({ value: { kind: "number", value: 1 } });
			expect(byName("AP_BASED_EMC")).toMatchObject({
				description: "u8",
				value: {
					kind: "list",
					values: [
						{ kind: "number", value: 1 },
						{ kind: "number", value: 2 },
					],
				},
			});
			expect(layered.errors).toContain(`crc:${hex("AP_BASED_EMC")}: AP_BASED_EMC: 2 values for 1 elements`);
		});

		it("keeps an item the registry lacks, untyped, as one the modem skips rather than an error", () => {
			expect(layered.items.find((i) => i.id === `crc:${hex("NOT_IN_REGISTRY")}`)).toMatchObject({
				value: { kind: "number", value: 7 },
				description: expect.stringMatching(/so the modem skips it/),
			});
			expect(layered.errors.filter((e) => e.includes(hex("NOT_IN_REGISTRY")))).toEqual([]);
		});

		it("keeps the value a later layer replaces, under the layer that set it", () => {
			const parent = seq("parent.sim1", item(MTU, 1400));
			const own = seq("own.sim1", item(MTU, 1500));
			const sim1 = (layer: Uint8Array): Uint8Array =>
				pb([
					[1, 1],
					[2, hexBytes(sha1Hex(layer))],
					[8, 4],
				]);
			const over = shannonConfig(
				new Map([
					[
						"manifest.pb",
						pb([
							[1, "v0.1"],
							[2, "xx_mvno"],
							[5, sim1(parent)],
							[5, sim1(own)],
						]),
					],
					...[parent, own].map((b) => [`confseqs/${sha1Hex(b)}.pb`, b] as const),
					["items.json", json({ [hex(MTU)]: { name: MTU, type: "u16", capacity: 1 } })],
					["carrier.json", json([])],
				]),
				"s5",
			).config;
			expect(over.items.map((i) => [i.id, i.value, i.description])).toEqual([
				[`crc:${hex(MTU)}`, { kind: "number", value: 1500 }, "u16"],
				[
					`crc:${hex(MTU)}?parent.sim1`,
					{ kind: "number", value: 1400 },
					"u16 · set by parent.sim1, which a later layer replaces",
				],
			]);
		});

		it("reads LTE CA combinations from the items, once however many conditions give them", () => {
			expect(layered.combos).toEqual([
				[
					"LTE CA items",
					[
						[
							{ band: "B1", dl: "A", dlLayers: 2 },
							{ band: "B3", dl: "A", ul: "A", dlLayers: 4 },
						],
					],
				],
			]);
		});
	});
});

const textValue = (value: string): ModemValue => ({ kind: "text", value });
const numberValue = (value: number): ModemValue => ({ kind: "number", value });

const sumWords = (b: readonly number[]): number => {
	let sum = 0;
	for (let i = 0; i < b.length; i += 4)
		sum =
			(sum + ((b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24))) >>>
			0;
	return sum;
};
const pad4 = (b: readonly number[]): number[] => [...b, ...Array.from({ length: -b.length & 3 }, () => 0)];

/** One MCF item record: item id, flags, a `<sbp>_<mcc>_<mnc>` tag or none, values by `i$` path. */
function mcfRecord(
	item: number,
	flags: number,
	tag: string,
	values: ReadonlyArray<readonly [string, number[]]>,
): number[] {
	const t = [...new TextEncoder().encode(tag)];
	const body = [
		...pad4(t),
		...values.flatMap(([path, bytes]) =>
			pad4([...u16(path.length), ...u16(bytes.length), ...new TextEncoder().encode(path), ...bytes]),
		),
	];
	return [...u32(12 + body.length), ...u32(item), flags, t.length, ...u16(values.length), ...body];
}

/** An OP-OTA (or, empty, an NW-OTA) file of LID 0x88f's items 0x20cf and 0x20d1: one section, checksums made. */
function mcf(records: readonly number[][]): Uint8Array {
	const table = [...u32(0x88f), ...u32(2), ...u32(0x20cf), ...u32(0x20d1)];
	const build = Array.from({ length: 60 }, () => 0);
	const kind = [...new TextEncoder().encode(records.length ? "OP-OTA" : "NW-OTA"), 0, 0];
	const payload = records.flat();
	const section = [
		...u32(0x00020004),
		...u32(40 + payload.length),
		...u32(0xccaa),
		...u32(1),
		...u32(payload.length),
		...u32(0x88f),
		...u32(0x88f),
		...u32(records.length),
		...u32(0),
		...u32(0),
		...payload,
	];
	const sum = sumWords(section);
	section.splice(0x24, 4, ...u32(-sum >>> 0));
	const header = [
		...u32(0x00010004),
		...u32(0x20 + table.length + 60),
		...u32(0x1021aacc),
		...u16(11),
		...u16(1),
		...u32(table.length),
		...kind,
		...u32(sum),
	];
	return Uint8Array.from([...header, ...table, ...build, ...section]);
}

describe("mediatekConfig", () => {
	// The fixtures' items as a900a-MP_260716's md1rom item table shapes them: LID, size, unit, array depth.
	const shapes = {
		build: "a900a-MP_260716-260716-M-15880348",
		items: {
			7916: [1346, 1, "byte", 0],
			7989: [1346, 1, "byte", 0],
			8398: [2191, 1, "byte", 2],
			8399: [2191, 1, "byte", 1],
			8400: [2191, 8, "bit", 1],
			8401: [2191, 1, "byte", 1],
			8402: [2191, 4, "byte", 1],
			8403: [2191, 32, "bit", 1],
			8405: [2191, 1, "byte", 1],
			8406: [2191, 8, "bit", 1],
			8407: [2191, 1, "byte", 1],
			8408: [2191, 8, "bit", 1],
			8409: [2191, 1, "bit", 1],
			11082: [2191, 1, "byte", 1],
			11083: [2191, 8, "bit", 1],
			17960: [2191, 1, "bit", 1],
			28976: [961, 8, "bit", 0],
			29084: [960, 1, "bit", 0],
			29086: [960, 1, "bit", 0],
			29087: [960, 1, "bit", 0],
			29088: [960, 1, "bit", 0],
			29089: [960, 1, "bit", 0],
			29090: [960, 1, "bit", 0],
			35279: [960, 1, "bit", 0],
		},
		owners: { 960: "SBP", 961: "SBP", 1346: "IMS", 2191: "D2" },
		// Stand-ins for the names md1rom's SBP tables give.
		names: { 28976: "SBP_TEST_DATA", 29084: "SBP_TEST_FEATURE" },
	};
	const files = new Map([
		["op.mcfopota", fixture("decode-mediatek", "op-ota.mcfopota")],
		["nw.mcfnwota", fixture("decode-mediatek", "nw-ota.mcfnwota")],
		[
			"sbp.json",
			json({
				id: 108,
				plmns: [
					{ mcc: "466", mnc: "97" },
					{ mcc: "466", mnc: null },
				],
			}),
		],
		["items.json", json(shapes)],
	]);
	const mapped = mediatekConfig(files, "s3");
	const c = mapped.config;

	it("keys items by LID and item id, named where the item table names them, with values typed by it", async () => {
		expect(await stored(mapped)).toBe(true);
		expect([c.family, c.label, c.scope, c.selection, c.combos, c.errors]).toEqual([
			"mediatek",
			"SBP 108",
			"carrier",
			[{ mccmnc: "46697" }],
			[],
			[],
		]);
		expect(c.facts).toEqual([
			{ label: "Build", value: expect.stringMatching(/./) },
			{ label: "SBP", value: "108" },
			{ label: "Item table", value: expect.stringMatching(/^a900a-/) },
			{ label: "Loaded by", value: expect.stringMatching(/^its SBP id/) },
			{ label: "Record flags", value: "1 (38 records)" },
		]);
		expect(c.items.every((i) => /^lid:0x[0-9a-f]+\/\d+$/.test(i.id))).toBe(true);
		expect(c.items.filter((i) => i.name !== null).map((i) => [i.id, i.name, i.certainty])).toEqual([
			[`lid:0x3c1/${28976}`, "SBP_TEST_DATA", "medium"],
			[`lid:0x3c0/${29084}`, "SBP_TEST_FEATURE", "medium"],
		]);
		expect(c.items.filter((i) => i.name === null).every((i) => i.certainty === "opaque")).toBe(true);
		// Recorded once per PLMN of the SBP: keyed by condition, values by array path.
		const apn: ModemValue = {
			kind: "fields",
			fields: { "0$0$": textValue("examplea"), "1$0$": textValue("ims"), "2$0$": textValue("xyz") },
		};
		expect(byId(c, `lid:0x88f/${0x20ce}`)).toMatchObject({
			description: "D2 · 8-bit, 2-index array",
			value: { kind: "fields", fields: { "466-97": apn, "466-99": apn } },
		});
		// A scalar for any PLMN of the SBP.
		expect(c.items.find((i) => i.id.endsWith(`/${0x7130}`))?.value).toEqual({ kind: "number", value: 12 });
	});

	it("merges an array MCF splits over records, keeps a path written twice with both values, and keys records by flags where they differ", () => {
		const split = mediatekConfig(
			new Map([
				...files,
				[
					"op.mcfopota",
					mcf([
						mcfRecord(0x20cf, 1, "108_466_97", [
							["0$", [1]],
							["1$", [2]],
						]),
						mcfRecord(0x20cf, 1, "108_466_97", [
							["2$", [3]],
							["1$", [9]],
						]),
						mcfRecord(0x20d1, 1, "", [["0$", [5]]]),
						mcfRecord(0x20d1, 2, "", [["0$", [5]]]),
					]),
				],
				["nw.mcfnwota", mcf([])],
			]),
			"s6",
		).config;
		expect(byId(split, `lid:0x88f/${0x20cf}`)).toMatchObject({
			value: {
				kind: "fields",
				fields: {
					"466-97 flags 1": {
						kind: "fields",
						fields: {
							"0$": numberValue(1),
							"1$": { kind: "list", values: [numberValue(2), numberValue(9)] },
							"2$": numberValue(3),
						},
					},
				},
			},
		});
		expect(byId(split, `lid:0x88f/${0x20d1}`)).toMatchObject({
			value: {
				kind: "fields",
				fields: { "any flags 1": { kind: "fields", fields: { "0$": numberValue(5) } }, "any flags 2": {} },
			},
		});
		expect(split.errors).toEqual([`lid:0x88f/${0x20cf} 1$: written twice with different values; both kept`]);
		expect(split.facts.at(-1)).toEqual({ label: "Record flags", value: "1 (3 records), 2 (1 record)" });
	});

	it("is the firmware's own for SBP 0, no operator's", () => {
		expect(
			mediatekConfig(new Map([...files, ["sbp.json", json({ id: 0, plmns: [] })]]), "s3").config.scope,
		).toBe("firmware");
	});

	it("keeps a value the item table cannot place as bytes, and says why", async () => {
		const { 28976: _, ...rest } = shapes.items;
		const m = mediatekConfig(new Map([...files, ["items.json", json({ ...shapes, items: rest })]]), "s3");
		const unplaced = m.config;
		expect(await stored(m)).toBe(true);
		expect(unplaced.errors).toEqual([
			`lid:0x3c1/${0x7130}: item not in the modem's item table; kept as bytes`,
		]);
		expect(byId(unplaced, `lid:0x3c1/${0x7130}`)).toMatchObject({
			description: null,
			value: { kind: "bytes", hex: "0c" },
		});
	});

	it("keeps the OP-OTA's items when an NW-OTA does not decode, with the error", async () => {
		const m = mediatekConfig(new Map([...files, ["nw.mcfnwota", new Uint8Array(16)]]), "s3");
		const broken = m.config;
		expect(await stored(m)).toBe(true);
		expect(broken.errors).toEqual([expect.stringMatching(/^nw\.mcfnwota: /)]);
		expect(broken.items.length).toBeGreaterThan(0);
	});
});

/** Ids both configs carry, in the Pixel config's order. */
const sharedIds = (a: Pick<ModemConfig, "items">, b: Pick<ModemConfig, "items">): string[] => {
	const ids = new Set(b.items.map((i) => i.id));
	return a.items.map((i) => i.id).filter((id) => ids.has(id));
};

/** Every `.der.pri` in the bundle with Qualcomm items, as the site maps them one by one. */
const iosModemConfigs = (opened: OpenedBundle, sha: string): ModemConfig[] =>
	opened.info.files
		.filter((f) => f.path.endsWith(".der.pri"))
		.flatMap((f) => iosModemConfig(opened, f.path, sha) ?? []);

describe("iosModemConfig", () => {
	const pixel = qualcommConfig(
		pixelFiles(
			fixture("decode-qualcomm", "pixel5a/dcm-cut.mbn"),
			new TextDecoder().decode(fixture("decode-qualcomm", "pixel5a/mcfg_sel_db-cut.xml")),
		),
		"s1",
	).config;

	it("gives one config per .der.pri, labelled by file, with Pixel's item ids and values", () => {
		const configs = iosModemConfigs(
			priBundle("DoCoMo_jp", fixture("decode-ios", "pri/docomo.der.pri")),
			"b1",
		);
		expect(configs.map((c) => [c.family, c.label, c.sha, c.selection])).toEqual([
			["qualcomm", "overrides_D93_D94_D47_D48.der.pri", "b1", []],
		]);
		const [ios] = configs;
		if (ios === undefined) throw new Error("no config");
		expect(valid(ios)).toBe(true);
		expect(sharedIds(pixel, ios)).toEqual(["efs:/nv/item_files/ims/IMS_enable", "nv:909"]);
		expect(byId(ios, "nv:909")).toEqual(byId(pixel, "nv:909"));
	});

	it("reads every .der.pri in a bundle with Qualcomm items; Intel-modem phones' have none", () => {
		const configs = iosModemConfigs(openIpcc(fixture("decode-ios", "carrier-att.ipcc")), "b2");
		// D321/D331/N841 (iPhone XS, XR) and D421/D431/N104/D79 (iPhone 11, SE 2) have Intel modems.
		expect(configs.map((c) => c.label)).toEqual([
			"overrides_D49.der.pri",
			"overrides_D52g_D53g_D53p_D54p.der.pri",
			"overrides_D63_D64_D16_D17.der.pri",
			"overrides_D73_D74_D27_D28.der.pri",
			"overrides_D83_D84_D37_D38.der.pri",
		]);
		expect(
			configs.every((c) => c.errors.length === 0 && c.items.every((i) => /^(nv:\d+|efs:\/|pri:)/.test(i.id))),
		).toBe(true);
	});

	it("gives a file that does not decode a config of its own, holding the error", () => {
		const pri = fixture("decode-ios", "pri/docomo.der.pri");
		const broken = new Uint8Array([0x31, 0x84, 0xff, 0xff, 0xff, 0xff]);
		const configs = iosModemConfigs(
			bundle("Test_jp", {
				"overrides_A.der.pri": pri,
				"overrides_B.der.pri": new Uint8Array([...pri, ...broken]),
				"overrides_C.der.pri": broken,
			}),
			"b3",
		);
		expect(configs.map((c) => [c.label, c.errors])).toEqual([
			["overrides_A.der.pri", []],
			["overrides_B.der.pri", [expect.stringMatching(new RegExp(`^DER stops at byte ${pri.length}: `))]],
			["overrides_C.der.pri", [expect.stringMatching(/^DER stops at byte 0: /)]],
		]);
		const [whole, cut, none] = configs;
		// What precedes the bad element still reads.
		expect(cut?.items).toEqual(whole?.items);
		expect(none?.items).toEqual([]);
		expect(configs.every(valid)).toBe(true);
	});
});

describe("iosModemConfig: .der.tri", () => {
	const b = bundle("Test_fr", {
		"overrides_V64.der.tri": fixture("decode-ios", "formats/synthetic.der.tri"),
		"overrides_V63_V64s_V68.der.tri": fixture("decode-ios", "intel/kddi.der.pri"),
	});

	it("maps the Qualcomm-phone form's records to items, its version to a fact, unknown records raw", () => {
		const c = iosModemConfig(b, "overrides_V64.der.tri", "t1");
		if (c === null) throw new Error("no config");
		expect(valid(c)).toBe(true);
		expect([c.family, c.label, c.facts, c.errors]).toEqual([
			"qualcomm",
			"overrides_V64.der.tri",
			[{ label: "File version", value: "1.2.300" }],
			[],
		]);
		expect(c.items.map((i) => [i.id, i.certainty])).toEqual([
			["tri:2", "opaque"],
			["tri:3/1", "low"],
			["tri:3/2", "opaque"],
			["tri:3/3", "medium"],
			["tri:3/4", "medium"],
			["tri:3/5", "low"],
			["tri:3/9", "opaque"],
		]);
		expect(byId(c, "tri:3/9")).toMatchObject({ value: { kind: "bytes", hex: "abcd" } });
		const list = c.items.find((i) => i.id === "tri:3/3")?.value;
		expect(list?.kind === "list" && list.values.at(-1)).toEqual({
			kind: "fields",
			fields: {
				plmn: { kind: "text", value: "001-01" },
				access: { kind: "text", value: "E-UTRAN" },
				unknownBits: { kind: "number", value: 0x0100 },
			},
		});
	});

	it("has no Qualcomm items in the Apple-modem form, a PRI in the Intel dialect", () => {
		expect(iosModemConfig(b, "overrides_V63_V64s_V68.der.tri", "t1")).toBeNull();
	});
});

/** A PriValue as the ModemValue it must become: the decoder's own reading of the same bytes. */
function asModemValue(value: PriValue): ModemValue {
	switch (value.kind) {
		case "int":
			return value.exact === undefined
				? { kind: "number", value: value.int }
				: { kind: "bytes", hex: value.hex };
		case "string":
			return { kind: "text", value: value.text };
		case "xml":
			return { kind: "xml", value: value.text };
		case "bytes":
		case "empty":
			return { kind: "bytes", hex: value.hex };
	}
}

describe("iosModemConfig: everything the decoded PRI holds", () => {
	const b = openIpcc(fixture("decode-ios", "carrier-att.ipcc"));
	const file = "overrides_D83_D84_D37_D38.der.pri";

	it(`maps every part of ${file}`, () => {
		const pri = decodedPri(decodeFile(b, file));
		if (pri === undefined) throw new Error("not a DER PRI");
		const c = iosModemConfig(b, file, "b");
		if (c === null) throw new Error("no config");
		const item = (id: string): ModemItem | undefined => c.items.find((i) => i.id === id);

		expect(c.errors).toEqual(pri.errors);
		expect(c.facts).toEqual([
			{ label: "Dialect", value: dialectLabel(pri.dialect) },
			...Object.entries(pri.header)
				.filter(([, value]) => value !== "")
				.map(([label, value]) => ({ label, value })),
		]);
		// Each path once: one row per path loses no override.
		expect(new Set(pri.efs.map((e) => e.path)).size).toBe(pri.efs.length);
		for (const e of pri.efs) {
			expect(item(`efs:${e.path}`)).toEqual({
				id: `efs:${e.path}`,
				name: e.name ?? null,
				description: e.meaning === e.name ? null : (e.meaning ?? null),
				value: asModemValue(e.value),
				label: e.label ?? null,
				certainty: e.confidence === undefined ? "opaque" : expect.any(String),
			});
		}
		for (const n of pri.nv) {
			expect(item(`nv:${n.item}`)).toMatchObject({
				name: n.name ?? null,
				description: n.meaning ?? null,
				value: asModemValue(n.value),
				label: n.label ?? null,
			});
		}
		for (const g of pri.featureGroups) {
			expect(item(`nv:${g.nv}`)).toMatchObject({
				name: g.name,
				description: `${g.bits.length} of ${g.total} flags set${g.boolean ? "" : ", some not 0/1"}`,
				value: { kind: "flags", values: g.flags.map((f) => f.value) },
			});
			const notes = g.flags.filter((f) => f.note).map((f) => `${f.index}: ${f.note}`);
			expect(item(`nv:${g.nv}`)?.label).toBe(notes.length ? notes.join("\n") : null);
		}
		for (const n of pri.named)
			expect(item(`pri:setting/${n.name}`)).toMatchObject({ name: n.name, value: asModemValue(n.value) });
		if (pri.nvListed.length) {
			expect(item("pri:nv-list")?.value).toEqual({
				kind: "list",
				values: pri.nvListed.map((n) => ({
					kind: "fields",
					fields: {
						nv: { kind: "number", value: n.item },
						...(n.name && { name: { kind: "text", value: n.name } }),
					},
				})),
			});
			expect(item("pri:nv-list")?.description).toContain(
				`with a value here: ${pri.nvListed
					.filter((n) => n.set)
					.map((n) => n.item)
					.join(", ")}.`,
			);
		}
		if (pri.schema.count) {
			expect(item("pri:schema")).toMatchObject({
				value: { kind: "list", values: pri.schema.paths.map((p) => ({ kind: "text", value: p })) },
			});
			expect(item("pri:schema")?.description).toContain(
				`${pri.schema.count} NV paths the PRI format knows (${pri.schema.source})`,
			);
		}
		for (const u of pri.unknown) {
			expect(item(`pri:${u.tag}`)?.description).toContain(
				`${u.count} ${u.count === 1 ? "time" : "times"}, ${u.len} bytes${u.note ? `: ${u.note}` : ""}`,
			);
		}
		const listed = (pri.nvListed.length ? 1 : 0) + (pri.schema.count ? 1 : 0);
		expect(c.items).toHaveLength(
			pri.efs.length +
				new Set([...pri.nv.map((n) => n.item), ...pri.featureGroups.map((g) => g.nv)]).size +
				pri.named.length +
				listed +
				pri.unknown.length,
		);
	});
});

describe("modemConfig", () => {
	const dcm = pixelFiles(
		fixture("decode-qualcomm", "pixel5a/dcm-cut.mbn"),
		new TextDecoder().decode(fixture("decode-qualcomm", "pixel5a/mcfg_sel_db-cut.xml")),
	);

	it("maps an archive by the family its members name", async () => {
		expect(await modemConfig(packFiles(dcm), "s1")).toEqual(await normalizeMapped(qualcommConfig(dcm, "s1")));
	});

	it("refuses an archive that is no one family's", async () => {
		await expect(modemConfig(packFiles(new Map([["selection.json", json([])]])), "s0")).rejects.toThrow(
			/not one family's archive/,
		);
		await expect(
			modemConfig(packFiles(new Map([...dcm, ["manifest.pb", new Uint8Array()]])), "s0"),
		).rejects.toThrow(/not one family's archive/);
	});
});

describe("layeredRadio", () => {
	it("counts the 5G items of a config's base layers as its own", () => {
		expect(layeredRadio("lte", "nr")).toBe("nr");
		expect(layeredRadio("lte", null)).toBe("lte");
		expect(layeredRadio("unread", "lte")).toBe("unread");
	});
});

describe("modemFamilyName", () => {
	it("names an iOS generation with its vendor and code, and an Android vendor by its label alone", () => {
		expect(modemFamilyName("ios", "Mav25", "Qualcomm X80")).toBe("Qualcomm X80 · Mav25");
		expect(modemFamilyName("ios", "c4020", "Apple C2")).toBe("Apple C2 · c4020");
		expect(modemFamilyName("ios", "c4000", null)).toBe("Apple · c4000");
		expect(modemFamilyName("android", "shannon", "Samsung Shannon")).toBe("Samsung Shannon");
		expect(modemFamilyName("samsung", "qualcomm", null)).toBe("qualcomm");
	});
});

describe("firmwareFamily", () => {
	it("names a Qualcomm MPSS firmware by the chipset its build id gives, anything else by its vendor", () => {
		expect([
			firmwareFamily("qualcomm", "MPSS.DE.9.0-01972.5-KAANAPALI_GEN_PACK-1.129782.405"),
			firmwareFamily("shannon", "g5400i-260604-260807-B-16035863"),
		]).toEqual(["KAANAPALI", "shannon"]);
	});
});
