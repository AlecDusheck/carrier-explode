/**
 * Tests for `src/lib/decode/bbfw.ts` (baseband package decoder; mdb.ts and ssgccs.ts in modem.test.ts) and
 * `src/lib/decode/policy.ts` (policyman XML, band combos, A-MPR NS).
 *
 * Fixtures in test/fixtures/bbfw/ come from Mav25-2.10.01.Release.bbfw
 * (iOS 27.0 24A437, iPhone18,1); every expected value was read back out of them:
 *   bbcfg_trimmed.mbn  the real header and meta (tags 80..87), blobs 0, 4, 20, 122
 *                      (PROT_NV, PROT_SKU MAVZ, RFC_MMW MAVZ, PROT_PRI) and at most
 *                      three of each blob's index records, renumbered 0..3, re-wrapped
 *                      in a8/a9 with the header size fields patched
 *   pt_trimmed.mbn     the same cut of pt.mbn, blob 17 (carries NV 64628)
 *   qdsp6sw_57236896.bin  qdsp6sw.mbn bytes 57236896..57256400: two plain MCFG
 *                      images, a plain SW image and the two zlib images inside it
 *   band_combos_per_plmn.xml  bbcfg.mbn blob 1, unmodified
 * The last block runs on the whole package when it is on disk, and checks the
 * output against the reference Python extractor's manifest.json.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unzipSync, zlibSync } from "fflate";

import {
  BBCFG_FILE_TYPES,
  basebandComparable,
  basebandSummary,
  carriedBy,
  contentFormat,
  decodeBbcfgBlob,
  inflateMavz,
  mapComboCarriers,
  mcfgItemData,
  mergeComboSets,
  parseMcfg,
  priReplacements,
  parseMcfgTrailer,
  readBbcfg,
  readBlobRecords,
  scanModemConfigs,
  variantKey,
  type BandComboSet,
} from "../src/lib/decode/bbfw.ts";
import type { PriDecoded } from "../src/lib/decode/pri.ts";
import { bandList, comboStats, parseAmprNs, parseBandCombos, parseCombo, parsePolicyXml, walkPolicy, xmlRefs } from "../src/lib/decode/policy.ts";
import { bytesToHex, sha1Hex } from "../src/lib/decode/bytes.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => new Uint8Array(readFileSync(join(here, "fixtures", "bbfw", name)));
const bbcfg = fx("bbcfg_trimmed.mbn");
const pt = fx("pt_trimmed.mbn");
const modem = fx("qdsp6sw_57236896.bin");
const combosXml = new TextDecoder().decode(fx("band_combos_per_plmn.xml"));

describe("sha1Hex", () => {
  it("matches FIPS 180-4 test vectors", () => {
    expect(sha1Hex(new Uint8Array(0))).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(sha1Hex(new TextEncoder().encode("abc"))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1Hex(new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
  });
});

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
      buildTime: "2021_02_09_17_46_14_PST",
      sourceRevision: "heads/default_local_revision",
      version: "2.10.01",
    });
  });

  it("reads index records and the blob table", () => {
    expect(c.index.map((r) => [r.platform, r.sku, r.hwRev, r.fileType, r.blob])).toEqual([
      [1, 0, 0, 15, 0], [1, 1, 7, 13, 1], [1, 2, 7, 13, 1], [1, 4, 7, 13, 1], [1, 1, 8, 10, 2], [5, 0, 0, 17, 3],
    ]);
    expect(c.index[5].fileTypeName).toBe("PROT_PRI");
    expect(c.blobs.map((b) => [b.format, b.length])).toEqual([["der", 7457], ["mavz", 1064], ["mavz", 2927], ["der", 67410]]);
    expect(c.blobs[0].digest).toBe("e3bbefa1042b5e3d77027977792cc8a0f6e32309");
  });

  it("rejects anything else", () => {
    expect(() => readBbcfg(modem)).toThrow(/BBCFGMBN/);
  });

  it("reads pt.mbn the same way", () => {
    const p = readBbcfg(pt);
    expect(p.magic).toBe("POW");
    expect(p.index.map((r) => [r.platform, r.sku, r.hwRev, r.fileType])).toEqual([[5, 1, 6, 24], [5, 2, 6, 24], [5, 3, 6, 24]]);
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
    const b = decodeBbcfgBlob(bbcfg, c.blobs[1]);
    expect(b.image?.length).toBe(66730);
    expect(b.mcfg).toBeUndefined();
  });

  it("NV records (bf8458) and EFS records (bf8459)", () => {
    const b = decodeBbcfgBlob(bbcfg, c.blobs[0]);
    expect(b.nv.map((r) => [r.id, bytesToHex(r.value), r.f11, r.f14])).toEqual([
      [6876, "0000000005", 0, 18], [6876, "0000000005", 0, 20], [6876, "0000000005", 0, 24],
      [1920, "29040000", 2, 94], [7, "3000", 0, 94], [8, "69", 0, 94],
    ]);
    expect(b.files).toHaveLength(16);
    expect(b.files[0]).toMatchObject({ path: "/mav/bbcfg_file_hash_protocol_static_nv", f77: 0, f78: 30 });
    // the modem copies the blob digest into this file
    expect(bytesToHex(b.files[0].data)).toBe(c.blobs[0].digest);
  });

  it("finds the policy XMLs and text files in PROT_PRI", () => {
    const { nv, files } = readBlobRecords(bbcfg.subarray(c.blobs[3].offset, c.blobs[3].offset + c.blobs[3].length));
    expect(nv.map((r) => r.id)).toEqual([1920]);
    expect(files).toHaveLength(40);
    const byPath = new Map(files.map((f) => [f.path, f.data]));
    expect(byPath.get("/policyman/band_combos_per_plmn.xml")?.length).toBe(49509);
    expect(new TextDecoder().decode(byPath.get("/SSGCCS/ssgccs_config.txt"))).toBe("CUSTOM: 2, 500, 200, 500, 0\nACTIVE_PLMN_LIST: ALL");
  });

  it("classifies content like the reference extractor", () => {
    const t = (s: string) => new TextEncoder().encode(s);
    expect(contentFormat(t("  <?xml version='1.0'?><a/>"))).toBe("xml");
    expect(contentFormat(t("<policy/>"))).toBe("xml");
    expect(contentFormat(t("CUSTOM: 2"))).toBe("text");
    expect(contentFormat(t("ab"), "/x.txt")).toBe("text");
    expect(contentFormat(new Uint8Array([1, 2]), "/mdb/nr/x.mdb")).toBe("mdb");
    expect(contentFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe("bin");
  });
});

describe("MCFG images and MCFG_TRL", () => {
  const c = readBbcfg(bbcfg);

  it("parses an RF card image inside an ELF", () => {
    const b = decodeBbcfgBlob(bbcfg, c.blobs[2]);
    const m = b.mcfg!;
    expect(m).toMatchObject({ segmentOffset: 8192, format: 4, cfgType: 0, cfgTypeName: "HW", numItems: 4, versionId: 0x1383, version: "00000000" });
    expect(m.items.map((it) => [it.type, it.path])).toEqual([[2, "/mcfg_ftb"], [27, "/rfc/2900_0_res.dat"], [27, "/rfc/2900_0_cmn.dat"], [10, undefined]]);
    expect(mcfgItemData(b.image!, m.items[0])).toHaveLength(8);
    // attr 0x19 but no 0x07 prefix byte: kept whole
    expect(mcfgItemData(b.image!, m.items[1])).toHaveLength(470);
    expect(m.trailer).toMatchObject({ trailerVersion: "0001", version: "0000000a", label: "generic_config_label", baseVersion: "0000000a" });
  });

  it("reads trailer TLVs (u8 type, u16le length) and stops at type 9", () => {
    const body = new Uint8Array([
      0xa1, 0, 0, 0, ...new TextEncoder().encode("MCFG_TRL"),
      0, 2, 0, 0, 1, 3, 3, 0, 0x41, 0x42, 0x43, 7, 4, 0, 0x20, 0, 0x40, 0x41, 9, 0, 0, 3, 1, 0, 0x5a,
    ]);
    expect(parseMcfgTrailer(body)).toEqual({ trailerVersion: "0001", label: "ABC", capability: "20004041", tlvs: { 0: "0001", 3: "414243", 7: "20004041", 9: "" } });
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
    expect(cfgs[2].files.map((f) => f.path)).toEqual(["/multi_mbn/HW-DSDS.mbn", "/multi_mbn/HW-MSSS.mbn"]);
    expect(cfgs[3].image.trailer).toMatchObject({ version: "0089000a", baseVersion: "0089000a", capability: "41400020" });
    expect(cfgs[4].image.trailer?.capability).toBe("40400020");
    expect(cfgs[3].files).toHaveLength(14);
    expect(cfgs[3].files.find((f) => f.path === "/policyman/policies.xml")?.data.length).toBe(3958);
  });
});

describe("policy XML tree", () => {
  const xml = `<?xml version="1.0"?>
<!-- Carrier policy -->
<policy name = "ROW" policy_ver="128.1.1">
  <initial>
    <mcc_list name="home_mccs" include="hplmn ehplmn" />
    <define_fullrat_config><rat_capability base="hardware" /></define_fullrat_config>
  </initial>
  <if>
    <any_of>
      <not> <phone_operating_mode> ONLINE </phone_operating_mode> </not>
      <location_mcc_in list='us_mccs'/>
    </any_of>
    <then><stop /></then>
    <else><rf_bands list="rf_bands_home"/></else>
  </if>
  <svc_mode> FULL &amp; more </svc_mode>
</policy>\0\0`;

  it("builds the tree with each node's role", () => {
    const [comment, policy] = parsePolicyXml(xml);
    expect(comment).toMatchObject({ kind: "comment", text: "Carrier policy" });
    expect(policy).toMatchObject({ tag: "policy", kind: "policy", attrs: { name: "ROW", policy_ver: "128.1.1" } });
    const roles = Object.fromEntries([...walkPolicy([policy])].map((n) => [n.tag, n.kind]));
    expect(roles).toEqual({
      policy: "policy", initial: "branch", mcc_list: "define", define_fullrat_config: "define", rat_capability: "define",
      if: "branch", any_of: "logic", not: "logic", phone_operating_mode: "condition", location_mcc_in: "condition",
      then: "branch", stop: "action", else: "branch", rf_bands: "action", svc_mode: "action",
    });
    const any = [...walkPolicy([policy])].find((n) => n.tag === "any_of")!;
    expect(any.children[0].children[0].text).toBe("ONLINE");
    expect(any.children[1].attrs).toEqual({ list: "us_mccs" });
    expect(policy.children.at(-1)!.text).toBe("FULL & more");
  });

  it("survives stray and missing end tags", () => {
    const [a] = parsePolicyXml("<a><b></c><d>x</a>");
    expect(a.children.map((n) => n.tag)).toEqual(["b"]);
    expect(a.children[0].children[0]).toMatchObject({ tag: "d", text: "x" });
  });

  it("parses every policy XML shipped in PROT_PRI", () => {
    const s = basebandSummary({ "bbcfg.mbn": bbcfg });
    const xmls = s.files.filter((f) => f.format === "xml");
    expect(xmls).toHaveLength(11);
    for (const f of xmls) expect(parsePolicyXml(f.text!).filter((n) => n.kind !== "comment")).toHaveLength(1);
    const cp = s.files.find((f) => f.path === "/policyman/carrier_policy.xml")!;
    const root = parsePolicyXml(cp.text!).find((n) => n.tag === "policy")!;
    expect(root.children.map((n) => n.tag)).toEqual(["initial", "if", "#comment", "svc_mode", "rat_capability"]);
    expect(xmlRefs(cp.text!)).toEqual({ policy: "ROW" });
  });
});

describe("band_combos_per_plmn.xml", () => {
  const carriers = parseBandCombos(combosXml);

  it("pairs each PLMN list with its carrier tag", () => {
    expect(carriers.map((c) => [c.tag, c.plmns.length, c.combos.length])).toEqual([
      ["ATT", 5, 459], ["TMO", 15, 693], ["VZW", 12, 652], ["KDDI-LEGACY", 1, 25], ["KDDI", 1, 60], ["US_CELLULAR", 3, 173],
      ["SOFTBANK", 1, 146], ["UNICOM_CN", 2, 63], ["CMCC", 4, 57], ["CHINATELECOM_CN", 1, 61], ["CBN_CN", 1, 57],
    ]);
    expect(carriers[0].plmns).toEqual(["310-150", "310-280", "310-380", "310-410", "313-100"]);
  });

  it("parses component tokens", () => {
    expect(parseCombo("b1A[4]-b3A[4]A[1]-b41A[4]-n41A[4:30]A[1:30]").components).toEqual([
      { rat: "lte", band: 1, dl: "A[4]" },
      { rat: "lte", band: 3, dl: "A[4]", ul: "A[1]" },
      { rat: "lte", band: 41, dl: "A[4]" },
      { rat: "nr", band: 41, dl: "A[4:30]", ul: "A[1:30]" },
    ]);
    expect(parseCombo("n66AA-n258HH-n258G-dc")).toMatchObject({ nrdc: true, swul: false });
    expect(parseCombo("n2AA-n5A-n66A-n77AA-n77A-swul")).toMatchObject({ type: "nr", nrdc: false, swul: true });
    expect([parseCombo("b66A-n77A").type, parseCombo("b2A").type, parseCombo("junk").type]).toEqual(["endc", "lte", undefined]);
    expect(bandList([2, 66], "lte")).toBe("B2 B66");
    expect(bandList([77], "nr")).toBe("n77");
  });

  it("summarises each carrier", () => {
    expect(comboStats(carriers[0].combos)).toEqual({
      combos: 459, endc: 206, nr: 253, lte: 0, nrdc: 26, swul: 43, maxComponents: 5,
      nrBands: [2, 5, 66, 77, 258, 260],
      singleBands: [1, 3, 7, 8, 12, 14, 20, 25, 26, 28, 29, 30, 38, 40, 41, 48, 53, 70, 71, 78, 79],
      fr1Bands: [2, 5, 66, 77], fr2Bands: [258, 260], lteAnchors: [2, 5, 12, 14, 29, 30, 66], sulBands: [],
    });
    const kddi = comboStats(carriers[3].combos);
    expect([kddi.endc, kddi.nr, kddi.lteAnchors]).toEqual([25, 0, [1, 3, 11, 18, 41, 42]]);
  });

  it("counts only bands a carrier combines, not the single-band list every tag ends with", () => {
    const cu = comboStats(carriers.find((c) => c.tag === "UNICOM_CN")!.combos);
    expect(cu.nrBands).toEqual([1, 8, 78]);
    expect(cu.singleBands).toContain(66);
    // Intra-band CA on one band (class C and up) is a combination.
    expect(comboStats(["n78CA", "n1AA"]).nrBands).toEqual([78]);
    expect(comboStats(["n78CA", "n1AA"]).singleBands).toEqual([1]);
  });

  it("maps tags to bundles through MobileDeviceCarriersByMccMnc", () => {
    const mccMnc = {
      "310150": { BundleName: "ATT_aio_US", MVNOs: [{ BundleName: "ATT_aio_NR_US", GID1: "53FF" }] },
      "310410": { BundleName: "ATT_US", MVNOs: [{ BundleName: "ATT_FirstNet_US", GID1: "FFFF" }, { BundleName: "ATT_RedPocket_US", ICCID: "8901" }] },
      "44020": { BundleName: "Softbank_jp", MVNOs: [{ BundleName: "Softbank_YMobile_jp", GID1: "01FFFF" }] },
    };
    const m = mapComboCarriers(carriers, mccMnc);
    expect(m.ATT).toEqual({
      plmns: ["310-150", "310-280", "310-380", "310-410", "313-100"],
      bundles: ["ATT_FirstNet_US", "ATT_US", "ATT_aio_US"],
      mvnoBundles: ["ATT_RedPocket_US", "ATT_aio_NR_US"],
    });
    expect(m.SOFTBANK.bundles).toEqual(["Softbank_jp"]);
    expect(m.VZW.bundles).toEqual([]);
  });
});

describe("basebandSummary", () => {
  const s = basebandSummary({ "bbcfg.mbn": bbcfg, "pt.mbn": pt, "qdsp6sw.mbn": modem }, { name: "Mav25-2.10.01.Release.bbfw" });

  it("is JSON-safe", () => {
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("lists the containers", () => {
    expect(s.containers.map((c) => [c.member, c.magic, c.records, c.blobs, c.errors])).toEqual([
      ["bbcfg.mbn", "CFG", 6, 4, undefined], ["pt.mbn", "POW", 3, 1, undefined],
    ]);
    expect(s.containers[0].fileTypes.map(({ type, name, confidence, blobs, records }) => ({ type, name, confidence, blobs, records }))).toEqual([
      { type: 10, name: "RFC_MMW", confidence: "high", blobs: 1, records: 1 }, { type: 13, name: "PROT_SKU?", confidence: "low", blobs: 1, records: 3 },
      { type: 15, name: "PROT_NV", confidence: "high", blobs: 1, records: 1 }, { type: 17, name: "PROT_PRI", confidence: "high", blobs: 1, records: 1 },
    ]);
    expect(s.containers[0].fileTypes[0].note).toBe(BBCFG_FILE_TYPES[10].note);
  });

  it("dedups files by content and records who carries them", () => {
    const bb = s.files.filter((f) => f.member === "bbcfg.mbn");
    expect(bb).toHaveLength(13);
    const combos = bb.find((f) => f.path === "/policyman/band_combos_per_plmn.xml")!;
    expect(combos).toMatchObject({ sha1: "ecfbf1cc953111bc188968c021f72716d27773ca", blobs: [3], variants: [{ platform: 5, sku: 0, hwRev: 0 }] });
    expect(combos.refs?.carriers).toHaveLength(11);
    const ftb = s.files.filter((f) => f.path === "/mcfg_ftb");
    expect(ftb).toHaveLength(1);
    expect(ftb[0]).toMatchObject({ format: "bin", configs: ["CUST_SW_DEFAULT", "CUST_HW_DEFAULT", "DSDS-MN-Sariska", "MSSS-MN-Sariska"] });
    expect(s.files.filter((f) => f.member === "qdsp6sw.mbn")).toHaveLength(18);
    // the zlib images carried by the plain SW image are listed as configs, not files
    expect(s.files.some((f) => f.path.startsWith("/multi_mbn/"))).toBe(false);
  });

  it("keeps NV/EFS settings of protocol blobs, with known names", () => {
    expect(s.nv.map((n) => [n.blob, n.fileTypeName, n.records.length])).toEqual([[0, "PROT_NV", 22], [3, "PROT_PRI", 28]]);
    expect(s.nv[1].records[0]).toMatchObject({ efs: "/mav/product_pri_setting_revision", hex: "01000d00", f77: 0, f78: 22 });
    // Records carry the NV tables' name and confidence, the same annotation a .der.pri gets.
    expect(s.nv[1].records[0]).toHaveProperty("name");
    expect(s.nv[1].records[0]).toHaveProperty("confidence");
    expect(s.nv[0].records.find((r) => r.nv === 1920)).toMatchObject({ hex: "29040000", f11: 2, f14: 94 });
  });

  it("lists MCFG images in the container", () => {
    expect(s.images).toEqual([{
      member: "bbcfg.mbn", blob: 2, fileType: 10, fileTypeName: "RFC_MMW", variants: [{ platform: 1, sku: 1, hwRev: 8 }],
      cfgType: "HW", version: "00000000",
      trailer: { trailerVersion: "0001", version: "0000000a", label: "generic_config_label", baseVersion: "0000000a", digest: expect.any(String) },
      files: ["/mcfg_ftb", "/rfc/2900_0_res.dat", "/rfc/2900_0_cmn.dat"],
    }]);
  });

  it("parses band combos and the pt.mbn A-MPR table", () => {
    expect(s.bandCombos).toHaveLength(1);
    expect(s.bandCombos[0].carriers.map((c) => [c.tag, c.combos])).toContainEqual(["TMO", 646]);
    expect(s.amprNs).toHaveLength(1);
    expect(s.amprNs[0].groups[0].bands).toEqual([{ band: 41, nsNoCa: 4, nsWithCa: 4 }, { band: 48, nsNoCa: 27, nsWithCa: 10 }]);
    expect(s.amprNs[0].groups.map((g) => g.mccs.length)).toEqual([57, 1, 1, 2]);
    expect(s.carrierMap).toBeUndefined();
  });

  it("parses A-MPR XML with missing values", () => {
    expect(parseAmprNs('<ampr_configured_ns version="1"><mcc id="1 2 1"><band id="42"><ns_with_ca>8</ns_with_ca></band></mcc></ampr_configured_ns>'))
      .toEqual([{ mccs: ["1", "2"], bands: [{ band: 42, nsWithCa: 8 }] }]);
  });

  it("decodes the modem databases and small EFS settings", () => {
    expect(s.mdb?.databases.map((d) => [d.path, d.header?.creator, d.scan?.length, d.features?.length, d.error])).toEqual([
      ["/mdb/nr/mcc2arfcn.mdb", "Maverick", 6, undefined, undefined],
      ["/mdb/nr/plmn2features.mdb", "Qualcomm", undefined, 3, undefined],
      ["/mdb/lte/plmn2features_lte.mdb", "Maverick", undefined, 1, undefined],
    ]);
    expect(s.mdb?.databases[0].configs).toEqual(["DSDS-MN-Sariska", "MSSS-MN-Sariska"]);
    expect(s.mdb?.settings.map((x) => [x.path, x.configs, x.value])).toEqual([
      ["/mcfg_ftb", ["CUST_SW_DEFAULT", "CUST_HW_DEFAULT", "DSDS-MN-Sariska", "MSSS-MN-Sariska"], "clear"],
      ["/policyman/fullrat_timer", ["DSDS-MN-Sariska", "MSSS-MN-Sariska"], expect.stringMatching(/^300 s/)],
      ["/nv/item_files/modem/mmode/device_mode", ["DSDS-MN-Sariska"], expect.stringMatching(/DSDS/)],
      ["/nv/item_files/modem/mmode/device_mode", ["MSSS-MN-Sariska"], "single SIM"],
    ]);
    // no manifest given, so no bundles
    expect(s.mdb?.plmnBundles).toBeUndefined();
  });

  it("maps plmn2features networks to bundles when given the manifest routing", () => {
    const t = basebandSummary({ "qdsp6sw.mbn": modem }, { mccMnc: { "44020": { BundleName: "Softbank_jp" }, "310260": { BundleName: "TMobile_US" } } });
    expect(t.mdb?.plmnBundles).toEqual({ "440-20": ["Softbank_jp"], "310-260": ["TMobile_US"] });
  });

  it("pairs the SSGCCS files that serve the same platforms", () => {
    expect(s.ssgccs).toHaveLength(1);
    expect(s.ssgccs![0].files.map((f) => f.path)).toEqual(["/SSGCCS/ssgccs_config.txt", "/SSGCCS/ssgccs_int_config.txt"]);
    expect(s.ssgccs![0].variants).toEqual([{ platform: 5, sku: 0, hwRev: 0 }]);
    expect(s.ssgccs![0].config.allNetworks).toBe(true);
    expect(s.ssgccs![0].config.custom?.key).toBe("CUSTOM");
    expect(s.ssgccs![0].config.rats.map((l) => l.key)).toEqual(["GERAN"]);
  });

  it("summarises the modem configs", () => {
    expect(s.modemConfigs?.map((m) => [m.label, m.container, m.cfgType, m.trailer?.capability])).toEqual([
      ["CUST_SW_DEFAULT", "plain", "SW", undefined], ["CUST_HW_DEFAULT", "plain", "HW", undefined], [undefined, "plain", "SW", undefined],
      ["DSDS-MN-Sariska", "zlib", "HW", "41400020"], ["MSSS-MN-Sariska", "zlib", "HW", "40400020"],
    ]);
  });
});

/* ------------------------------------------------------ whole package */

// CORPUS=<dir>, see test/README.md; skipped when unset.
const C = process.env.CORPUS ?? "";
const BBFW = C && join(C, "image/Firmware/Mav25-2.10.01.Release.bbfw");
const PY = C && join(C, "bbcfg-manifest.json");

describe.skipIf(!BBFW || !existsSync(BBFW))("whole Mav25-2.10.01 package", () => {
  it("matches the reference extractor", { timeout: 120_000 }, () => {
    const want = new Set(["bbcfg.mbn", "pt.mbn", "qdsp6sw.mbn", "Info.plist"]);
    const zip = unzipSync(new Uint8Array(readFileSync(BBFW)), { filter: (f) => want.has(f.name) });
    const s = basebandSummary(zip, { name: "Mav25-2.10.01.Release.bbfw" });
    expect(s.package).toMatchObject({ version: "2.10.01", chipId: "0x001F30E1" });
    expect(s.files).toHaveLength(46);
    expect(s.containers.map((c) => [c.member, c.records, c.blobs])).toEqual([["bbcfg.mbn", 932, 344], ["pt.mbn", 218, 40]]);
    expect(s.nv).toHaveLength(11);
    expect(s.mdb?.databases.map((d) => d.path)).toEqual(["/mdb/nr/mcc2arfcn.mdb", "/mdb/nr/plmn2features.mdb", "/mdb/lte/plmn2features_lte.mdb"]);
    expect(s.mdb?.settings.filter((x) => x.path === "/protected/mcfg/active_int_carrier_info").map((x) => x.value)).toEqual(["SW_DEF", "HW_DEF"]);
    expect(s.ssgccs?.map((g) => g.config.allNetworks)).toEqual([true]);
    expect(s.bandCombos).toHaveLength(4);
    for (const set of s.bandCombos) expect(set.carriers).toHaveLength(11);
    expect(s.modemConfigs?.map((m) => m.label)).toEqual([
      "CUST_SW_DEFAULT", "CUST_HW_DEFAULT", undefined, "DSDS-MN-Sariska", "MSSS-MN-Sariska",
      "/protected/mcfg/active_int_carrier_info", "/protected/mcfg/active_int_carrier_info",
    ]);
    if (!existsSync(PY)) return;
    const py: Array<{ member: string; name: string; sha1: string; format: string }> = JSON.parse(readFileSync(PY, "utf8"));
    expect(new Set(s.files.map((f) => `${f.member} ${f.path} ${f.sha1} ${f.format}`))).toEqual(new Set(py.map((e) => `${e.member} ${e.name} ${e.sha1} ${e.format}`)));
    // combo counts straight from each XML variant, independently of parseBandCombos
    for (const set of s.bandCombos) {
      const text = s.files.find((f) => f.sha1 === set.sha1)!.text!;
      const counts = Object.fromEntries([...text.matchAll(/<([\w-]+)>([^<]*)<\/\1>/g)].filter((m) => m[1] !== "PLMN-ID")
        .map((m) => [m[1], m[2].split(";").filter((c) => c.trim()).length]));
      expect(Object.fromEntries(set.carriers.map((c) => [c.tag, c.combos]))).toEqual(counts);
    }
  });
});

describe("summary views", () => {
  const s = basebandSummary({ "bbcfg.mbn": bbcfg, "pt.mbn": pt }, { name: "Mav25-2.10.01.Release.bbfw" });

  it("labels where an entry applies", () => {
    expect(variantKey({ platform: 5, sku: 1, hwRev: 6 })).toBe("5/1/6");
    expect(carriedBy({ variants: [{ platform: 5, sku: 0, hwRev: 0 }, { platform: 5, sku: 1, hwRev: 0 }] })).toBe("5/0/0 5/1/0");
    expect(carriedBy({ variants: [{ platform: 5, sku: 0, hwRev: 0 }], configs: ["SW_DEF"] })).toBe("SW_DEF");
  });

  it("merges platforms whose combo stats match", () => {
    const [set] = s.bandCombos;
    const tag = set.carriers[0].tag;
    const twin: BandComboSet = { ...set, sha1: "other", variants: [{ platform: 9, sku: 0, hwRev: 0 }] };
    const rows = mergeComboSets([set, twin, set], tag);
    expect(rows).toHaveLength(1);
    expect(rows[0].sha1).toBe(set.sha1);
    expect(rows[0].variants.map(variantKey)).toEqual([...set.variants.map(variantKey), "9/0/0"]);
    expect(mergeComboSets([set], "NO-SUCH-TAG")).toEqual([]);
  });

  it("keys a package by section for a keyed diff", () => {
    const c = basebandComparable(s);
    expect(Object.keys(c)).toEqual(["Package", "Band combos", "Carriers", "Files", "Power", "Network databases", "Modem configs", "Containers"]);
    expect(Object.keys(c.Files)).toContain(`bbcfg.mbn /policyman/band_combos_per_plmn.xml [5/0/0]`);
  });

  it("finds the package files a .der.pri overwrites", () => {
    const f = s.files.find((x) => x.path === "/policyman/band_combos_per_plmn.xml")!;
    const value = (text: string) => ({ kind: "xml" as const, text, xml: text, hex: "", len: text.length });
    const pri = { efs: [
      { path: f.path, tag: "9fa70c", value: value(f.text!) },
      { path: "/policyman/elsewhere.xml", tag: "9fa70c", value: value("<?xml version=\"1.0\"?><x/>") },
    ] } as PriDecoded;
    const r = priReplacements(pri, s);
    expect(r.otherXml).toBe(1);
    expect(r.replaced).toEqual([{ efs: f.path, length: f.text!.length, baseline: [{ i: s.files.indexOf(f), member: "bbcfg.mbn", variants: f.variants, configs: undefined, same: true }] }]);
  });
});
