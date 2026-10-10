import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unzipSync, zipSync, unzlibSync } from "fflate";

import {
	publishedOn,
	buildIndex,
	buildMccMnc,
	carrierRefs,
	manifestTables,
	parseManifest,
} from "../src/manifest.ts";
import { compareVersions } from "../src/versions.ts";
import {
	openIpcc,
	decodeFile,
	contentTypeOf,
	decodedPlist,
	decodedPri,
	MemberError,
	type OpenedBundle,
} from "../src/bundle.ts";
import { bytesToBase64 } from "@carrier-explode/binary";
import { normalizeApplePng, isPng, isCgBI, pngDimensions } from "../src/png.ts";
import { defined, record } from "./defined.ts";
import { hexOf, textOf } from "./raw.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", n)));

const enc = new TextEncoder();

/** A fixture with `extra` added to its bundle. */
function fixtureWith(name: string, extra: Readonly<Record<string, Uint8Array>>): OpenedBundle {
	const zip = unzipSync(fixture(name));
	const root = defined(
		Object.keys(zip)
			.map((n) => /^.*?\.bundle\//.exec(n)?.[0])
			.find((r) => r !== undefined),
	);
	return openIpcc(
		zipSync({ ...zip, ...Object.fromEntries(Object.entries(extra).map(([path, b]) => [root + path, b])) }),
	);
}

const dec = new TextDecoder();
const xmlPlist = (body: string) =>
	enc.encode(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0">${body}</plist>`);

/** Every .ipcc fixture in the repository. */
const FIXTURES = [
	"carrier-att.ipcc",
	"watch-redpocket.ipcc",
	"watch-country-australia.ipcc",
	"carrier-airtel-in.ipcc",
	"carrier-cw-pa.ipcc",
	"carrier-cw-wi.ipcc",
	"country-germany.ipcc",
	"country-us.ipcc",
	"carrier-verizon.ipcc",
	"carrier-att-2009.ipcc",
];

const manifestXml = parseManifest(fixture("manifest.xml"));
const manifestBin = parseManifest(fixture("manifest.bplist"));
const index = buildIndex(manifestXml);

describe("manifest version helpers", () => {
	it("sorts a non-numeric version below every real release", () => {
		expect(compareVersions("legacy", "3.1")).toBeLessThan(0);
		expect(compareVersions("legacy", "0")).toBeLessThan(0);
	});

	it("orders numerically, not lexically", () => {
		expect(["9.3", "10.0", "26.5", "18.5", "6.1"].toSorted(compareVersions)).toEqual([
			"6.1",
			"9.3",
			"10.0",
			"18.5",
			"26.5",
		]);
		// 26.9 < 26.10 numerically; lexically it would be the other way round.
		expect(compareVersions("26.9", "26.10")).toBeLessThan(0);
		expect(compareVersions("9.3", "10.0")).toBeLessThan(0);
	});

	it("treats a missing trailing segment as zero", () => {
		expect(compareVersions("26", "26.4")).toBeLessThan(0);
		expect(compareVersions("26.4", "26")).toBeGreaterThan(0);
		expect(compareVersions("26", "26.0")).toBe(0);
		expect(compareVersions("26.0.0", "26")).toBe(0);
	});

	it("is reflexive, antisymmetric and stable under repeated sorting", () => {
		const input = ["9.3", "10.0", "26.5", "2.0", "legacy", "26.10", "26.9"];
		for (const a of input) expect(compareVersions(a, a)).toBe(0);
		for (const a of input) {
			for (const b of input) {
				expect(Math.sign(compareVersions(a, b)) + Math.sign(compareVersions(b, a))).toBe(0);
			}
		}
		const once = [...input].toSorted(compareVersions);
		expect(once).toEqual(["legacy", "2.0", "9.3", "10.0", "26.5", "26.9", "26.10"]);
		expect([...once].toSorted(compareVersions)).toEqual(once);
	});
});

describe("parseManifest", () => {
	it("rejects a plist whose root is not a dictionary", () => {
		expect(() => parseManifest(xmlPlist("<array/>"))).toThrow(/not a dictionary/);
		expect(() => parseManifest(xmlPlist("<string>x</string>"))).toThrow(/not a dictionary/);
		expect(() => parseManifest(xmlPlist("<integer>1</integer>"))).toThrow(/not a dictionary/);
		expect(() => parseManifest(xmlPlist("<array><dict/></array>"))).toThrow(/not a dictionary/);
	});

	it("rejects bytes that are neither XML nor a binary plist", () => {
		expect(() => parseManifest(new Uint8Array(0))).toThrow(/not a dictionary/);
		expect(() => parseManifest(enc.encode("definitely not a plist"))).toThrow(/not a dictionary/);
	});
});

describe("buildIndex", () => {
	it("lists exactly the carriers present in the trimmed manifest", () => {
		expect(index.carriers).toEqual([
			"1and1_de",
			"8ta_za",
			"ATT_US",
			"BhartiAirtel_in",
			"CW_wi",
			"TMobile_US",
			"True_th",
			"Verizon_LTE_US",
		]);
	});

	it("leaves out the bare `signature` key, whose value is raw bytes rather than a dict", () => {
		const byVer = record(manifestXml.MobileDeviceCarrierBundlesByProductVersion);
		expect(byVer.signature).toBeInstanceOf(Uint8Array);
		expect(index.carriers).not.toContain("signature");
	});

	it("collapses CarrierBundles.Watch.Bundles by BundleID", () => {
		expect(index.watchCarriers).toEqual(["1and1_de", "BhartiAirtel_in", "TMobile_US", "Verizon_LTE_US"]);
	});

	it("counts the root tables", () => {
		expect(index.counts).toEqual({
			// 7 carrier dicts plus the bogus `signature` key
			MobileDeviceCarrierBundlesByProductVersion: 8,
			MobileDeviceCarrierBundles: 3,
			MobileDeviceCarriersByMccMnc: 6,
			MobileDeviceCarriers: 12,
			MobileDeviceCarriersByCarrierID: 32,
		});
	});

	it("resolves country bundles of both families, with OS.Min from the mapping slot", () => {
		expect(index.countries.map((c) => `${c.family}/${c.id}@${c.version} ${c.minOS}`)).toEqual([
			"Watch/Australia@39.1 26.4",
			"iPhone/Australia@69.1 26.4",
			"iPhone/Germany@50.1 15.6",
			"iPhone/Germany@64.1 18.5",
			"iPhone/Netherlands@58.1 17.4",
			"iPhone/Netherlands@64.1 18.5",
			"iPhone/UnitedStates@58.1 17.4",
		]);
		expect(index.countries.find((c) => c.family === "Watch")?.url).toContain("Australia_Watch.ipcc");
	});
});

describe("carrierRefs", () => {
	const att = carrierRefs(manifestXml, "ATT_US");

	it("returns every published ref across ByProductVersion, ByProductType and legacy", () => {
		// 23 ByProductVersion + 4 iPad + 12 iPhone7,1 + 12 iPhone7,2 + 1 legacy
		expect(att).toHaveLength(52);
	});

	it("tags ByProductType refs with their product type and leaves plain refs untagged", () => {
		const iPad = att.filter((r) => r.productType === "iPad");
		expect(iPad).toHaveLength(4);
		expect(iPad.map((r) => r.os).toSorted(compareVersions)).toEqual(["6.1", "11.1", "13.3", "13.4"]);
		for (const r of iPad) expect(r.url).toContain("ATT_US_iPad.ipcc");
		expect(att.filter((r) => r.productType === "iPhone7,1")).toHaveLength(12);
		expect(att.filter((r) => r.productType === "iPhone7,2")).toHaveLength(12);
		// The FallbackToByProductVersion marker contributes no refs.
		expect(att.filter((r) => r.productType === "iPhone")).toHaveLength(0);
		expect(defined(att.find((r) => r.os === "17.5")).productType).toBeUndefined();
	});

	it("includes the legacy MobileDeviceCarrierBundles entry as os === legacy", () => {
		const legacy = att.filter((r) => r.os === "legacy");
		expect(legacy).toHaveLength(1);
		expect(legacy[0]?.build).toBe("3.1");
		expect(legacy[0]?.url).toContain("061-4732.20090203.gj3ef");
		expect(legacy[0]?.digest).toBeUndefined();
	});

	it("exposes both digest widths where the manifest publishes them", () => {
		const newest = defined(att.find((r) => r.os === "17.5" && r.productType === undefined));
		expect(newest.build).toBe("58.1");
		expect(newest.digest).toMatch(/^[0-9a-f]{40}$/);
		expect(newest.digest3).toMatch(/^[0-9a-f]{96}$/);
		// Older entries publish only the 20-byte Digest.
		const old = defined(att.find((r) => r.os === "15.0"));
		expect(old.digest).toMatch(/^[0-9a-f]{40}$/);
		expect(old.digest3).toBeUndefined();
	});

	it("includes CarrierBundles.Watch entries, labelled `Watch <slot>`", () => {
		const refs = carrierRefs(manifestXml, "1and1_de");
		expect(refs).toHaveLength(7);
		const watch = refs.filter((r) => r.family === "Watch");
		expect(watch.map((r) => [r.os, r.build])).toEqual(
			expect.arrayContaining([
				["Watch 2", "37.1"],
				["Watch 1", "25.1"],
			]),
		);
		expect(watch).toHaveLength(2);
		for (const r of watch) expect(r.url).toContain("1and1_de_Watch.ipcc");
		expect(
			refs
				.filter((r) => r.family === undefined && r.productType === undefined)
				.map((r) => r.os)
				.toSorted(compareVersions),
		).toEqual(["17.0", "18.5", "26.2", "26.5"]);
	});
});

describe("buildMccMnc", () => {
	const { entries, carrierIds, iccids } = buildMccMnc(manifestXml);
	const byPlmn = Object.fromEntries(entries.map((e) => [e.plmn, e]));

	it("builds one row per MobileDeviceCarriersByMccMnc key, sorted", () => {
		expect(entries).toHaveLength(6);
		expect(new Set(entries.map((e) => e.plmn)).size).toBe(6);
		expect(entries.map((e) => e.plmn)).toEqual(entries.map((e) => e.plmn).toSorted());
	});

	it("splits MCC/MNC for 2-digit and 3-digit MNCs", () => {
		expect([byPlmn["20404"]?.mcc, byPlmn["20404"]?.mnc]).toEqual(["204", "04"]);
		expect([byPlmn["20408"]?.mcc, byPlmn["20408"]?.mnc]).toEqual(["204", "08"]);
		expect([byPlmn["204043"]?.mcc, byPlmn["204043"]?.mnc]).toEqual(["204", "043"]);
		expect([byPlmn["310410"]?.mcc, byPlmn["310410"]?.mnc]).toEqual(["310", "410"]);
		expect([byPlmn["311480"]?.mcc, byPlmn["311480"]?.mnc]).toEqual(["311", "480"]);
	});

	it("keeps the BundleName where the entry has one", () => {
		expect(byPlmn["20404"]?.bundle).toBe("Vodafone_nl");
		expect(byPlmn["20408"]?.bundle).toBe("KPN_nl");
	});

	it("handles entries that carry MVNOs but no BundleName", () => {
		for (const plmn of ["20433", "204043", "310410", "311480"]) {
			expect(byPlmn[plmn]?.bundle).toBeUndefined();
			expect(byPlmn[plmn]?.mvnos.length).toBeGreaterThan(0);
		}
		expect(byPlmn["20433"]?.mvnos.map((m) => m.bundle)).toEqual(["Truphone_US", "Bootstrap_Truphone_US"]);
	});

	it("discriminates MVNO sub-entries by ICCID, GID1 and GID2", () => {
		const vodafone = byPlmn["20404"]?.mvnos;
		expect(vodafone).toHaveLength(27);

		const iccidOnly = defined(vodafone?.find((m) => m.bundle === "Bell_ca"));
		expect(iccidOnly).toEqual({
			bundle: "Bell_ca",
			iccid: "89302610",
			gid1: undefined,
			gid2: undefined,
		});

		const gid1Only = defined(vodafone?.find((m) => m.bundle === "GigSky_US"));
		expect(gid1Only).toEqual({ bundle: "GigSky_US", iccid: undefined, gid1: "6F", gid2: undefined });

		// Verizon's resellers are told apart by GID2 *and* a shared ICCID prefix.
		const comcast = defined(vodafone?.find((m) => m.bundle === "Verizon_Comcast_LTE_US"));
		expect(comcast).toEqual({
			bundle: "Verizon_Comcast_LTE_US",
			iccid: "891480",
			gid1: undefined,
			gid2: "A3",
		});
		const charter = defined(vodafone?.find((m) => m.bundle === "Verizon_Charter_LTE_US"));
		expect(charter.gid2).toBe("A7");
		expect(charter.iccid).toBe("891480");

		// ICCID + GID1 together.
		const both = defined(vodafone?.find((m) => m.bundle === "TMobile_Vodafone_US"));
		expect(both).toEqual({
			bundle: "TMobile_Vodafone_US",
			iccid: "89012608611",
			gid1: "28",
			gid2: undefined,
		});
	});

	it("keeps GID2-only MVNOs and repeated bundle names under one PLMN", () => {
		const vz = byPlmn["311480"]?.mvnos;
		expect(vz).toHaveLength(28);
		expect(vz?.every((m) => m.gid2 !== undefined && m.iccid === undefined)).toBe(true);
		// Verizon_MVNO_US appears many times, once per GID2 value.
		const mvno = vz?.filter((m) => m.bundle === "Verizon_MVNO_US");
		expect(mvno?.length).toBeGreaterThan(10);
		expect(new Set(mvno?.map((m) => m.gid2)).size).toBe(mvno?.length);
		expect(vz?.find((m) => m.gid2 === "B100000000000000")?.bundle).toBe("Verizon_Cox_LTE_US");
	});

	it("uses GID1 to split AT&T's own MVNOs", () => {
		const att = byPlmn["310410"]?.mvnos;
		expect(att).toHaveLength(12);
		expect(att?.every((m) => m.gid1 !== undefined)).toBe(true);
		expect(att?.find((m) => m.gid1 === "FFFF")?.bundle).toBe("ATT_US");
		expect(att?.filter((m) => m.bundle === "ATT_Dish_MVNO_US").map((m) => m.gid1)).toEqual([
			"3432",
			"3436",
			"3434",
		]);
	});

	it("keeps MobileDeviceCarriers out of the PLMN table, because it is keyed by ICCID", () => {
		// MobileDeviceCarriers is keyed by ICCID prefix (890.../891.../892...), not
		// by PLMN, so an mcc/mnc split of those keys would be meaningless.
		for (const iccid of ["890100", "89010700", "8901980"]) {
			expect(byPlmn[iccid]).toBeUndefined();
		}
		expect(entries.every((e) => e.plmn.length <= 6)).toBe(true);
	});

	it("returns the ICCID prefix map as its own sorted lookup", () => {
		expect(iccids).toHaveLength(12);
		expect(iccids.find(([prefix]) => prefix === "890100")).toEqual(["890100", "GTA_gu"]);
		expect(iccids.filter(([, bundle]) => bundle === "ATT_US").map(([prefix]) => prefix)).toEqual([
			"8901150",
			"8901180",
			"8901410",
			"8901980",
		]);
		expect(iccids.map(([p]) => p)).toEqual(iccids.map(([p]) => p).toSorted());
	});

	it("returns MobileDeviceCarriersByCarrierID pairs sorted by carrier id", () => {
		expect(carrierIds).toHaveLength(32);
		expect(carrierIds[0]).toEqual(["310ALK", "AlaskaWireless_US"]);
		expect(carrierIds[carrierIds.length - 1]).toEqual(["330OPM", "OpenMobile_pr"]);
		expect(carrierIds.map(([id]) => id)).toEqual(carrierIds.map(([id]) => id).toSorted());
		expect(carrierIds.find(([id]) => id === "310VZW")).toEqual(["310VZW", "Zeppelin_US"]);
		for (const [id, bundle] of carrierIds) {
			expect(id).toMatch(/^\d{3}[A-Z]{3}$/);
			expect(typeof bundle).toBe("string");
		}
	});

	it("returns empty results for an empty root", () => {
		expect(buildMccMnc({})).toEqual({ entries: [], carrierIds: [], iccids: [] });
	});
});

describe("manifest XML and binary parity", () => {
	it("reads the same tables, digests included, from both encodings", () => {
		expect(manifestTables(manifestBin)).toEqual(manifestTables(manifestXml));
	});
});

describe("openIpcc", () => {
	it("pulls the bundle name out of the Payload/<Name>.bundle/ prefix", () => {
		expect(openIpcc(fixture("carrier-att.ipcc")).info.bundleName).toBe("ATT_US");
		expect(openIpcc(fixture("carrier-verizon.ipcc")).info.bundleName).toBe("Verizon_LTE_US");
		expect(openIpcc(fixture("country-us.ipcc")).info.bundleName).toBe("UnitedStates");
		expect(openIpcc(fixture("country-germany.ipcc")).info.bundleName).toBe("Germany");
		expect(openIpcc(fixture("carrier-cw-wi.ipcc")).info.bundleName).toBe("CW_wi");
		expect(openIpcc(fixture("carrier-cw-pa.ipcc")).info.bundleName).toBe("CW_pa");
		expect(openIpcc(fixture("carrier-airtel-in.ipcc")).info.bundleName).toBe("BhartiAirtel_in");
		// The Watch country bundle ships under the plain country name.
		expect(openIpcc(fixture("watch-country-australia.ipcc")).info.bundleName).toBe("Australia");
		// The 2009 bundle is named after the carrier, like the modern ones.
		expect(openIpcc(fixture("carrier-att-2009.ipcc")).info.bundleName).toBe("ATT_US");
	});

	it("strips the zip prefix off every listed path and reads each file at its listed size", () => {
		const b = openIpcc(fixture("carrier-att.ipcc"));
		for (const f of b.info.files) {
			expect(f.path.startsWith("Payload/")).toBe(false);
			expect(b.read(f.path)).toHaveLength(f.size);
		}
	});

	it("reads a member only by its bundle-relative path", () => {
		expect(() => openIpcc(fixture("carrier-att.ipcc")).read("Payload/ATT_US.bundle/carrier.plist")).toThrow(
			MemberError,
		);
	});

	it("excludes directory entries from the file list", () => {
		const b = openIpcc(fixture("carrier-att.ipcc"));
		expect(Object.keys(unzipSync(fixture("carrier-att.ipcc"))).some((k) => k.endsWith("/"))).toBe(true);
		expect(b.info.files.filter((f) => f.path.endsWith("/"))).toEqual([]);
	});

	it("excludes __MACOSX and .DS_Store members", () => {
		const zip = zipSync(
			{
				"Payload/Test_xx.bundle/carrier.plist": xmlPlist("<dict><key>k</key><string>v</string></dict>"),
				"Payload/Test_xx.bundle/.DS_Store": enc.encode("junk"),
				"Payload/Test_xx.bundle/sub/.DS_Store": enc.encode("junk"),
				"Payload/Test_xx.bundle/__MACOSX/._carrier.plist": enc.encode("junk"),
				"__MACOSX/Payload/Test_xx.bundle/._carrier.plist": enc.encode("junk"),
			},
			{ level: 0 },
		);
		const b = openIpcc(zip);
		expect(b.info.bundleName).toBe("Test_xx");
		expect(b.info.files.map((f) => f.path)).toEqual(["carrier.plist"]);
		expect(b.info.totalSize).toBe(b.read("carrier.plist").length);
	});

	it("classifies by the lower-cased extension, the same way it picks the content type", () => {
		const zip = zipSync(
			{
				"Payload/Test_xx.bundle/Carrier.PLIST": xmlPlist("<dict><key>k</key><string>v</string></dict>"),
				"Payload/Test_xx.bundle/overrides_N1.DER.PRI": new Uint8Array([0x31, 0x00]),
			},
			{ level: 0 },
		);
		const b = openIpcc(zip);
		expect(b.info.files.map((f) => [f.path, f.kind, contentTypeOf(f.path)])).toEqual([
			["Carrier.PLIST", "plist", "application/x-plist"],
			["overrides_N1.DER.PRI", "pri-der", "application/octet-stream"],
		]);
	});

	it("decodes packager metadata as base64 of UTF-8 JSON", () => {
		const json = JSON.stringify({ name: "Orange España" });
		const zip = zipSync(
			{
				"Payload/Test_xx.bundle/a.metadata": enc.encode(
					bytesToBase64(enc.encode(json)).replace(/(.{8})/g, "$1\n"),
				),
			},
			{ level: 0 },
		);
		expect(decodedPlist(decodeFile(openIpcc(zip), "a.metadata"))).toEqual({ name: "Orange España" });
	});

	it("falls back to an empty prefix when there is no .bundle folder", () => {
		const zip = zipSync(
			{
				"carrier.plist": xmlPlist("<dict><key>k</key><string>v</string></dict>"),
				"nested/a.txt": enc.encode("hi"),
			},
			{ level: 0 },
		);
		const b = openIpcc(zip);
		expect(b.info.bundleName).toBe("bundle");
		expect(b.info.files.map((f) => f.path)).toEqual(["carrier.plist", "nested/a.txt"]);
		expect(decodedPlist(decodeFile(b, "carrier.plist"))).toEqual({ k: "v" });
	});

	it("treats .der.gri global settings as pri-der and a plaintext .pri as pri-plain", () => {
		const cw = openIpcc(fixture("carrier-cw-wi.ipcc"));
		const gri = cw.info.files.filter((f) => f.path.endsWith(".der.gri"));
		expect(gri).toHaveLength(9);
		expect(gri.map((f) => f.path)).toContain("global_setting_B.der.gri");
		for (const f of gri) expect(f.kind).toBe("pri-der");

		const bh = openIpcc(fixture("carrier-airtel-in.ipcc"));
		expect(bh.info.files.find((f) => f.path === "overrides_N69.pri")?.kind).toBe("pri-plain");
	});

	it("extracts locales from .lproj folders, including region-qualified ones", () => {
		const att = openIpcc(fixture("carrier-att.ipcc"));
		expect(att.info.locales).toEqual([...att.info.locales].toSorted());
		expect(att.info.locales).toContain("en");
		expect(att.info.locales).toContain("en_GB");
		expect(att.info.locales).toContain("es_419");
		expect(att.info.locales).toContain("zh_TW");
		expect(att.info.files.find((f) => f.path === "en_GB.lproj/carrier.strings")?.locale).toBe("en_GB");
		expect(defined(att.info.files.find((f) => f.path === "carrier.plist")).locale).toBeUndefined();
	});

	it("handles the 2009 bundle's English-word locale folders", () => {
		const lg = openIpcc(fixture("carrier-att-2009.ipcc"));
		expect(lg.info.locales).toEqual([
			"Dutch",
			"English",
			"French",
			"German",
			"Italian",
			"Japanese",
			"Spanish",
			"da",
			"fi",
			"ko",
			"no",
			"pl",
			"pt",
			"pt_PT",
			"ru",
			"sv",
			"zh_CN",
			"zh_TW",
		]);
		expect(lg.info.files.find((f) => f.path === "English.lproj/carrier.strings")?.locale).toBe("English");
		expect(lg.info.deviceStems).toEqual([]);
	});

	it("parses device stems from overrides_* filenames and lists their boards", () => {
		const att = openIpcc(fixture("carrier-att.ipcc"));
		expect(att.info.deviceStems).toEqual([
			"D321_D331_N841",
			"D421_D431_N104_D79",
			"D49",
			"D52g_D53g_D53p_D54p",
			"D63_D64_D16_D17",
			"D73_D74_D27_D28",
			"D83_D84_D37_D38",
		]);
		const f = defined(att.info.files.find((x) => x.path === "overrides_D63_D64_D16_D17.der.pri"));
		expect(f.boards).toEqual(["D63", "D64", "D16", "D17"]);
		expect(defined(att.info.files.find((x) => x.path === "carrier.plist")).boards).toBeUndefined();
	});

	it("recognises a device stem on a plaintext .pri as well as on .der.pri and .plist", () => {
		const bh = openIpcc(fixture("carrier-airtel-in.ipcc"));
		expect(bh.info.deviceStems).toContain("N69");
		expect(bh.info.files.find((f) => f.path === "overrides_N69.pri")?.boards).toEqual(["N69"]);
		expect(bh.info.files.find((f) => f.path === "overrides_N69.plist")?.boards).toEqual(["N69"]);
	});

	it("does not treat global_setting_*.der.gri as a device override", () => {
		const cw = openIpcc(fixture("carrier-cw-wi.ipcc"));
		expect(defined(cw.info.files.find((f) => f.path === "global_setting_B.der.gri")).boards).toBeUndefined();
		expect(cw.info.deviceStems).not.toContain("global");
	});

	it("totals uncompressed bytes over the listed files only", () => {
		const b = openIpcc(fixture("carrier-cw-wi.ipcc"));
		expect(b.info.totalSize).toBe(b.info.files.reduce((s, f) => s + f.size, 0));
	});

	it("sorts the file list by path", () => {
		const b = openIpcc(fixture("carrier-verizon.ipcc"));
		expect(b.info.files.map((f) => f.path)).toEqual(
			b.info.files.map((f) => f.path).toSorted((a, c) => a.localeCompare(c)),
		);
	});
});

describe("decodeFile", () => {
	it("decodes a country bundle's binary carrier.plist", () => {
		const b = openIpcc(fixture("country-us.ipcc"));
		const d = decodeFile(b, "carrier.plist");
		expect(d.kind).toBe("plist");
		expect(d.size).toBe(2299);
		expect(d.note).toBeNull();
		expect(record(decodedPlist(d)).CountryName).toBe("United States of America");
	});

	it("decodes .strings files that are really binary plists", () => {
		const b = openIpcc(fixture("carrier-att.ipcc"));
		const d = decodeFile(b, "de.lproj/carrier.strings");
		expect(d.kind).toBe("strings");
		expect(decodedPlist(d)).toBeTruthy();
		expect(textOf(d)).toBeUndefined();
		expect(Object.keys(record(decodedPlist(d))).length).toBeGreaterThan(0);
		// The 2009 bundle's .strings are binary plists too.
		const ls = decodeFile(openIpcc(fixture("carrier-att-2009.ipcc")), "English.lproj/carrier.strings");
		expect(ls.kind).toBe("strings");
		expect(record(decodedPlist(ls))["Pay My Bill_SERVICE_NAME"]).toBe("Pay My Bill");
	});

	it("falls back to text for an old-style text .strings file", () => {
		const b = fixtureWith("carrier-att.ipcc", { "en.lproj/plain.strings": enc.encode('"a" = "b";\n') });
		const d = decodeFile(b, "en.lproj/plain.strings");
		expect(d.kind).toBe("strings");
		expect(decodedPlist(d)).toBeUndefined();
		expect(textOf(d)).toBe('"a" = "b";\n');
		expect(d.note).toBeNull();
	});

	it("decodes profile.mobileconfig as a plist", () => {
		for (const name of ["carrier-att.ipcc", "carrier-verizon.ipcc"]) {
			const d = decodeFile(openIpcc(fixture(name)), "profile.mobileconfig");
			expect(d.kind).toBe("mobileconfig");
			expect(d.note).toBeNull();
			expect(Object.keys(record(decodedPlist(d)))).toContain("PayloadType");
			expect(Object.keys(record(decodedPlist(d)))).toContain("PayloadContent");
		}
	});

	it("decodes carrier.ims as XML text", () => {
		const d = decodeFile(openIpcc(fixture("carrier-verizon.ipcc")), "carrier.ims");
		expect(d.kind).toBe("xml");
		expect(textOf(d)?.startsWith("<?xml")).toBe(true);
		expect(textOf(d)).toContain("<QIMF>");
		expect(decodedPlist(d)).toBeUndefined();
		expect(hexOf(d)).toBeUndefined();
		expect(d.note).toBeNull();
	});

	it("decodes a .der.pri override into a PRI structure", () => {
		const b = openIpcc(fixture("carrier-verizon.ipcc"));
		const d = decodeFile(b, "overrides_D63_D64_D16_D17.der.pri");
		expect(d.kind).toBe("pri-der");
		expect(decodedPri(d)).toBeTruthy();
		expect(decodedPri(d)?.leafCount).toBeGreaterThan(0);
		expect(d.boards).toEqual(["D63", "D64", "D16", "D17"]);
		expect(d.note).toBeNull();
	});

	it("decodes a .der.gri global settings blob into a PRI structure", () => {
		const d = decodeFile(openIpcc(fixture("carrier-cw-wi.ipcc")), "global_setting_C.der.gri");
		expect(d.kind).toBe("pri-der");
		expect(decodedPri(d)).toBeTruthy();
		expect(decodedPri(d)?.leafCount).toBeGreaterThan(0);
		expect(d.boards).toBeUndefined();
	});

	it("decodes a plaintext .pri that is actually an XML document", () => {
		const d = decodeFile(openIpcc(fixture("carrier-airtel-in.ipcc")), "overrides_N69.pri");
		expect(d.kind).toBe("pri-plain");
		// The file starts with <?xml, so the plist parser claims it.
		expect(decodedPlist(d)).toBeTruthy();
		expect(decodedPri(d)).toBeUndefined();
		expect(d.note).toBeNull();
	});

	it("decodes carrier.dmu as a DMU public key and keeps the hex", () => {
		const d = decodeFile(openIpcc(fixture("carrier-verizon.ipcc")), "carrier.dmu");
		expect(d.kind).toBe("dmu");
		expect(d.size).toBe(260);
		expect(hexOf(d)).toHaveLength(520);
		expect(hexOf(d)?.startsWith("0a02ff10")).toBe(true);
		expect(textOf(d)).toBeUndefined();
		if (d.view.type !== "dmu") throw new Error(d.kind);
		expect(d.view.dmu).toMatchObject({
			pkoid: 0x0a,
			algorithm: "RSA-1024",
			exponent: "17",
			modulusBits: 1024,
			pkoi: 2,
			pkoidName: "Verizon Wireless",
		});
		expect(d.note).toBeNull();
	});

	it("truncates a large opaque blob to 8 KiB and says so", () => {
		const b = fixtureWith("carrier-att.ipcc", { "blob.bin": new Uint8Array(20000).fill(7) });
		const d = decodeFile(b, "blob.bin");
		expect(d.kind).toBe("binary");
		expect(hexOf(d)).toHaveLength(8192 * 2);
		expect(d.size).toBe(20000);
	});

	it("promotes a small printable binary member to text", () => {
		const b = fixtureWith("carrier-att.ipcc", { "small.bin": enc.encode("hello world") });
		const d = decodeFile(b, "small.bin");
		expect(d.kind).toBe("binary");
		expect(textOf(d)).toBe("hello world");
		expect(hexOf(d)).toBeUndefined();
	});

	it("reports the 2009 bundle's PNG status-bar logos without inlining them", () => {
		const lg = openIpcc(fixture("carrier-att-2009.ipcc"));
		const d = decodeFile(lg, "Default_CARRIER_ATT.png");
		expect(d.view).toEqual({ type: "image", width: 31, height: 20, cgbi: true });
		expect(hexOf(d)).toBeUndefined();
		expect(textOf(d)).toBeUndefined();
		expect(lg.info.files.filter((f) => f.kind === "image").map((f) => f.path)).toEqual([
			"Default_CARRIER_ATT M-Cell.png",
			"Default_CARRIER_ATT.png",
			"Default_CARRIER_CINGULAR.png",
			"FSO_CARRIER_ATT M-Cell.png",
			"FSO_CARRIER_ATT.png",
			"FSO_CARRIER_CINGULAR.png",
		]);
	});

	it("decodes the 2009 bundle's carrier.plist, Info.plist and locversion.plist", () => {
		const lg = openIpcc(fixture("carrier-att-2009.ipcc"));
		const carrier = record(decodedPlist(decodeFile(lg, "carrier.plist")));
		expect(carrier.CarrierName).toBe("AT&T");
		expect(Array.isArray(carrier.StatusBarImages)).toBe(true);
		const info = record(decodedPlist(decodeFile(lg, "Info.plist")));
		expect(info.CFBundleIdentifier).toBe("com.apple.ATT_US");
		expect(info.CFBundleVersion).toBe("3.1");
		const loc = record(decodedPlist(decodeFile(lg, "English.lproj/locversion.plist")));
		expect(loc.LprojLocale).toBe("en");
	});

	it("decodes Verizon's CDMA-era ERI.plist and supported_devices.plist", () => {
		const b = openIpcc(fixture("carrier-verizon.ipcc"));
		expect(Object.keys(record(decodedPlist(decodeFile(b, "ERI.plist"))))).toEqual([
			"name",
			"version",
			"roaming_indicator_table",
		]);
		expect(Object.keys(record(decodedPlist(decodeFile(b, "supported_devices.plist"))))).toEqual([
			"SupportedDevicesExactMatch",
			"SupportedSIMOverrides",
		]);
	});

	it("decodes every member of every fixture into the payload its kind promises", () => {
		for (const name of FIXTURES) {
			const b = openIpcc(fixture(name));
			for (const f of b.info.files) {
				const d = decodeFile(b, f.path);
				expect(d.path).toBe(f.path);
				expect(d.kind).toBe(f.kind);
				expect(d.size).toBe(f.size);
				// Images carry no payload here: their bytes are served by /api/raw.
				const populated =
					decodedPlist(d) !== undefined ||
					decodedPri(d) !== undefined ||
					textOf(d) !== undefined ||
					hexOf(d) !== undefined ||
					d.kind === "image";
				expect(populated, `${name}:${f.path}`).toBe(true);
			}
		}
	});

	// Verizon's CarrierCA.crt is PEM, not DER, so it is shown as text.
	it("shows a PEM certificate as text rather than as mislabelled hex", () => {
		const d = decodeFile(openIpcc(fixture("carrier-verizon.ipcc")), "CarrierCA.crt");
		expect(textOf(d)).toBeDefined();
		expect(textOf(d)?.startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
		expect(d.note).not.toBe("DER-encoded X.509 certificate");
	});

	it("still hex-dumps a certificate that really is DER", () => {
		const b = fixtureWith("carrier-verizon.ipcc", {
			"der.crt": new Uint8Array([0x30, 0x82, 0x01, 0x0a, 0x02, 0x01]),
		});
		const d = decodeFile(b, "der.crt");
		expect(d.kind).toBe("certificate");
		expect(d.view).toEqual({ type: "raw" });
		expect(d.error).toMatchObject({ reason: "failed", message: expect.any(String) });
		expect(hexOf(d)).toBe("3082010a0201");
		// The bytes are PEM.
		expect(dec.decode(b.read("CarrierCA.crt")).startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
	});
});

describe("decodeFile error handling", () => {
	it("throws for a path that is not in the bundle", () => {
		const b = openIpcc(fixture("carrier-verizon.ipcc"));
		expect(() => decodeFile(b, "nope.plist")).toThrow("no such file in bundle: nope.plist");
		expect(() => decodeFile(b, "signatures/nope.plist")).toThrow(/no such file in bundle/);
		expect(() => decodeFile(b, "carrier.plist/")).toThrow(MemberError);
	});

	it("rejects a directory entry and an empty path", () => {
		const b = openIpcc(fixture("carrier-verizon.ipcc"));
		expect(() => decodeFile(b, "signatures/")).toThrow(MemberError);
		expect(() => decodeFile(b, "")).toThrow(MemberError);
	});

	it("degrades a corrupt binary plist to a note plus a hex dump", () => {
		const b = fixtureWith("carrier-att.ipcc", { "broken.plist": enc.encode("bplist00garbage") });
		const d = decodeFile(b, "broken.plist");
		expect(d.kind).toBe("plist");
		expect(decodedPlist(d)).toBeUndefined();
		expect(d.error).toMatchObject({ reason: "failed", message: expect.any(String) });
		expect(hexOf(d)).toHaveLength(30);
		expect(hexOf(d)?.startsWith("62706c6973743030")).toBe(true);
	});

	it("degrades a corrupt .strings member the same way", () => {
		const b = fixtureWith("carrier-att.ipcc", { "en.lproj/broken.strings": enc.encode("bplist00truncated") });
		const d = decodeFile(b, "en.lproj/broken.strings");
		expect(d.kind).toBe("strings");
		expect(d.error?.reason).toBe("failed");
		expect(hexOf(d)).toBeDefined();
	});

	it("does not throw on a .der.pri holding junk", () => {
		const b = fixtureWith("carrier-att.ipcc", { "junk.der.pri": new Uint8Array([1, 2, 3, 4, 5]) });
		expect(() => decodeFile(b, "junk.der.pri")).not.toThrow();
		expect(decodedPri(decodeFile(b, "junk.der.pri"))).toBeTruthy();
	});

	// BUG: a .plist / .mobileconfig member whose bytes are neither "bplist" nor
	// XML skips the parser entirely and is handed to TextDecoder, so binary junk
	// becomes U+FFFD mojibake with no note and no hex to fall back on.
	// Repro: decodeFile on a ".plist" entry holding [0,1,2,3,250,251] returns
	//        text " ��" and note undefined.
	it("flags a .plist member whose content is not a plist at all", () => {
		const b = fixtureWith("carrier-att.ipcc", { "notaplist.plist": new Uint8Array([0, 1, 2, 3, 250, 251]) });
		const d = decodeFile(b, "notaplist.plist");
		expect(d.error).toEqual({ reason: "unrecognised" });
		expect(hexOf(d)).toBeDefined();
	});

	it("still returns plain text for a .strings member in the legacy text format", () => {
		const b = fixtureWith("carrier-att.ipcc", {
			"en.lproj/legacy.strings": enc.encode('"KEY" = "value";\n'),
		});
		const d = decodeFile(b, "en.lproj/legacy.strings");
		expect(textOf(d)).toBe('"KEY" = "value";\n');
		expect(d.note).toBeNull();
	});
});

describe("openIpcc hostile input", () => {
	it("throws cleanly on bytes that are not a ZIP", () => {
		expect(() => openIpcc(enc.encode("not a zip at all, really not"))).toThrow();
		expect(() => openIpcc(new Uint8Array(0))).toThrow();
		expect(() => openIpcc(new Uint8Array(4096).fill(0xab))).toThrow();
	});

	it("throws cleanly on a truncated ZIP", () => {
		const raw = fixture("country-us.ipcc");
		expect(() => openIpcc(raw.subarray(0, 200))).toThrow();
		expect(() => openIpcc(raw.subarray(0, raw.length - 10))).toThrow();
		expect(() => openIpcc(raw.subarray(0, Math.floor(raw.length / 2)))).toThrow();
	});

	it("throws on a ZIP header with no payload", () => {
		expect(() => openIpcc(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toThrow();
	});
});

describe("ipcc: assets and packaging leftovers", () => {
	it("classifies images by extension, case-insensitively", () => {
		const names = ["a.PNG", "b.jpeg", "c.jpg", "d.gif", "e.tif", "f.tiff", "g.svg"];
		const b = fixtureWith(
			"carrier-att-2009.ipcc",
			Object.fromEntries(names.map((name) => [name, new Uint8Array([1, 2, 3])])),
		);
		for (const name of names) expect(decodeFile(b, name).kind, name).toBe("image");
	});

	it("decodes bundle.metadata, which is base64-encoded JSON", () => {
		const b = openIpcc(fixture("watch-redpocket.ipcc"));
		const f = defined(b.info.files.find((x) => x.path === "bundle.metadata"));
		expect(f.kind).toBe("metadata");
		const d = decodeFile(b, "bundle.metadata");
		const meta = record(decodedPlist(d));
		expect(meta.bundleType).toBe("Carriers");
		expect(meta.device).toBe("Watch");
		expect(Array.isArray(meta.filesModified)).toBe(true);
	});

	it("falls back to text when a .metadata member is not base64 JSON", () => {
		const b = fixtureWith("watch-redpocket.ipcc", {
			"broken.metadata": enc.encode("plainly not base64 json"),
		});
		const d = decodeFile(b, "broken.metadata");
		expect(decodedPlist(d)).toBeUndefined();
		expect(textOf(d)).toBe("plainly not base64 json");
		expect(d.error).toEqual({ reason: "unrecognised", message: "expected base64-encoded JSON" });
	});

	it("annotates the opaque binary members it knows about", () => {
		const vz = openIpcc(fixture("carrier-verizon.ipcc"));
		expect(decodeFile(vz, "carrier.dmu").kind).toBe("dmu");
		const b = fixtureWith("carrier-verizon.ipcc", {
			"carrier.prl": new Uint8Array([0, 0x57, 0, 3, 3, 0x80]),
			"overrides_N1.mcfopota": new Uint8Array([4, 0, 1, 0, 0x38]),
		});
		const prl = decodeFile(b, "carrier.prl");
		expect(prl.note).toMatch(/Preferred Roaming List/);
		expect(prl.error?.message).toMatch(/PRL too short/);
		expect(decodeFile(b, "overrides_N1.mcfopota").note).toMatch(/OP-OTA/);
	});

	it("maps members to a servable content type", () => {
		expect(contentTypeOf("a/b/logo.png")).toBe("image/png");
		expect(contentTypeOf("shot.JPG")).toBe("image/jpeg");
		expect(contentTypeOf("tree.xml")).toBe("application/xml");
		expect(contentTypeOf("carrier.ims")).toBe("application/xml");
		expect(contentTypeOf("CarrierCA.crt")).toBe("application/x-x509-ca-cert");
		expect(contentTypeOf("carrier.plist")).toBe("application/x-plist");
		expect(contentTypeOf("carrier.prl")).toBe("application/octet-stream");
	});
});

describe("Apple CgBI PNG normalisation", () => {
	const logos = () => {
		const b = openIpcc(fixture("carrier-att-2009.ipcc"));
		return b.info.files
			.filter((f) => f.kind === "image")
			.map((f) => ({ path: f.path, bytes: b.read(f.path) }));
	};

	it("recognises the carrier logos as CgBI PNGs", () => {
		const all = logos();
		expect(all).toHaveLength(6);
		for (const { path, bytes } of all) {
			expect(isPng(defined(bytes)), path).toBe(true);
			expect(isCgBI(defined(bytes)), path).toBe(true);
		}
	});

	it("reads dimensions past the CgBI chunk", () => {
		const byPath = Object.fromEntries(logos().map((l) => [l.path, l.bytes]));
		expect(pngDimensions(defined(byPath["Default_CARRIER_ATT.png"]))).toEqual({ width: 31, height: 20 });
		expect(pngDimensions(defined(byPath["Default_CARRIER_ATT M-Cell.png"]))).toEqual({
			width: 72,
			height: 20,
		});
		expect(pngDimensions(defined(byPath["Default_CARRIER_CINGULAR.png"]))).toEqual({ width: 51, height: 20 });
	});

	it("rewrites every logo into a standard PNG with the same dimensions", () => {
		for (const { path, bytes } of logos()) {
			const out = defined(normalizeApplePng(defined(bytes)));
			expect(out, path).toBeTruthy();
			expect(isPng(out)).toBe(true);
			expect(isCgBI(out)).toBe(false);
			expect(pngDimensions(out)).toEqual(pngDimensions(defined(bytes)));
			// A standard PNG puts IHDR immediately after the signature.
			expect(dec.decode(out.subarray(12, 16))).toBe("IHDR");
			// IDAT carries a zlib wrapper (0x78 ...).
			const idatAt = out.indexOf(0x49, 30);
			expect(out.length).toBeGreaterThan(50);
			expect(idatAt).toBeGreaterThan(0);
		}
	});

	it("produces an IDAT that inflates back to the expected raw size", () => {
		const { bytes } = defined(logos()[0]);
		const out = defined(normalizeApplePng(bytes));
		const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
		// signature(8) + IHDR chunk(12 + 13) = 33
		const idatLen = dv.getUint32(33);
		expect(dec.decode(out.subarray(37, 41))).toBe("IDAT");
		const idat = out.subarray(41, 41 + idatLen);
		const raw = unzlibSync(idat);
		const { width, height } = defined(pngDimensions(out));
		expect(raw.length).toBe((width * 4 + 1) * height);
		// Filter byte of every scanline is None.
		for (let y = 0; y < height; y++) expect(raw[y * (width * 4 + 1)]).toBe(0);
	});

	it("leaves a standard PNG alone", () => {
		const { bytes } = defined(logos()[0]);
		const standard = defined(normalizeApplePng(bytes));
		expect(normalizeApplePng(standard)).toBeNull();
	});

	it("returns null rather than throwing for input it cannot handle", () => {
		expect(normalizeApplePng(new Uint8Array())).toBeNull();
		expect(normalizeApplePng(enc.encode("not a png at all"))).toBeNull();
		expect(isPng(enc.encode("nope"))).toBe(false);
		expect(pngDimensions(enc.encode("nope"))).toBeNull();
		// Correct signature, truncated body.
		const { bytes } = defined(logos()[0]);
		for (const cut of [9, 20, 30, 48, 100, bytes.length - 1]) {
			expect(() => normalizeApplePng(bytes.subarray(0, cut)), `cut ${cut}`).not.toThrow();
		}
		// Correct signature and CgBI, but a bit depth the converter does not accept.
		const broken = new Uint8Array(bytes);
		broken[24 + 8 + 8] = 4; // IHDR bit depth
		expect(normalizeApplePng(broken)).toBeNull();
	});
});

describe("publishedOn", () => {
	it("reads the date out of every URL scheme Apple has used", () => {
		expect(
			publishedOn(
				"https://updates.cdn-apple.com/20261001/carrierbundles/142-29613/9763C9C0-86F5-4D14-8B50-2C02ACE04457/ATT_US_iPhone.ipcc",
			),
		).toBe("2026-10-01");
		expect(
			publishedOn(
				"http://updates-http.cdn-apple.com/2018/ios/carrierbundles/091-80246-20180504-CC3E1C52-4D8B-11E8-BA4C-38D21A00AB6B/AIS_th_iPhone.ipcc",
			),
		).toBe("2018-05-04");
		expect(
			publishedOn(
				"http://appldnld.apple.com/iOS7/CarrierBundles/031-2099.20131204.rVQEN/2degrees_nz_iPhone.ipcc",
			),
		).toBe("2013-12-04");
		expect(
			publishedOn(
				"http://appldnld.apple.com.edgesuite.net/content.info.apple.com/iPhone/CarrierBundles/061-4732.20090203.gj3ef/ATT_US.ipcc",
			),
		).toBe("2009-02-03");
	});

	it("falls back to the year where the path has nothing more", () => {
		expect(
			publishedOn(
				"https://updates.cdn-apple.com/2020/carrierbundles/001-80023/80B77606-453A-4462-A609-98577E6EE499/Bell_ca_Watch.ipcc",
			),
		).toBe("2020");
		expect(
			publishedOn(
				"https://updates.cdn-apple.com/2019/carrierbundles/041-56849-2019503-D84FB36A-6C44-11E9-B635-4CC8AFCA7786/2degrees_nz_iPad.ipcc",
			),
		).toBe("2019");
		expect(
			publishedOn(
				"https://updates.cdn-apple.com/202206043/carrierbundles/071-96019/1C8525EF-8FB9-472B-BF6C-17EFB79E7ED3/Cyta_cy_Watch.ipcc",
			),
		).toBe("2022");
		expect(publishedOn("https://example.com/carrier.ipcc")).toBeUndefined();
	});
});
