/**
 * Modem configuration: each family's mapper on the decoders' fixtures, iPhone overrides against Pixel MCFG,
 * and buildIndexes attaching configs to carriers. CORPUS=<dir> also compares the real T-Mobile pair under <dir>/modem.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { crc32, packFiles, sha1Hex } from "@carrier-explode/binary";
import { decodedPri, decodeFile, dialectLabel, openIpcc, type OpenedBundle, type PriValue } from "@carrier-explode/decode-ios";
import { pairSelection, parseMcfg, parseSelectionDb } from "@carrier-explode/decode-qualcomm";
import { decodeCarrierDb } from "@carrier-explode/decode-shannon";

import { modemConfigSchema } from "../src/records.ts";
import {
  buildIndexes, indexModemConfig, indexProfile, iosModemConfig, linkedConfigShas, modemConfig, PROFILE_SCHEMA,
  type BandCombination, type CarrierModem, type ModemConfig, type ModemItem, type ModemValue, type ModemVendor, type Profile, type Release, type SimMatcher, type SourceRef,
} from "../src/index.ts";
import type { ConfigDraft, MappedConfig } from "../src/modem/archive.ts";
import { normalizeMapped } from "../src/modem/index.ts";
import { deviceModems, modemRadios, type IndexModemConfig } from "../src/modem-links.ts";
import { mediatekConfig } from "../src/modem/mediatek/index.ts";
import { qualcommConfig, selectionSims } from "../src/modem/qualcomm/index.ts";
import { shannonConfig } from "../src/modem/shannon/index.ts";

const fixture = (pkg: string, name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "..", "..", pkg, "test", "fixtures", name)));
const json = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));
/** Normalized, survives a JSON round trip and validates, as a stored norm read does: the config, and its base. */
async function stored(m: MappedConfig): Promise<boolean> {
  const n = await normalizeMapped(m);
  return [n.config, ...(n.base ? [n.base] : [])].every(valid);
}
const valid = (c: ModemConfig): boolean => v.is(modemConfigSchema, JSON.parse(JSON.stringify(c)));
const byId = (c: Pick<ModemConfig, "items">, id: string): unknown => c.items.find((i) => i.id === id);
/** Every source's combinations, in order. */
const combinations = (c: Pick<ConfigDraft, "combos">): BandCombination[] => c.combos.flatMap(([, list]) => list);

/** A bundle holding `files` as given, plus an Info.plist. */
function bundle(name: string, files: Readonly<Record<string, Uint8Array>>): ReturnType<typeof openIpcc> {
  const info = new TextEncoder().encode('<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>1.0</string></dict></plist>');
  return openIpcc(zipSync(Object.fromEntries(Object.entries({ "Info.plist": info, ...files }).map(([p, b]) => [`Payload/${name}.bundle/${p}`, b]))));
}

/** A bundle with one override file. */
const priBundle = (name: string, pri: Uint8Array): ReturnType<typeof openIpcc> => bundle(name, { "overrides_D93_D94_D47_D48.der.pri": pri });

/** Pixel MCFG with the selection records that pair with it, as the extractor packs them. */
function pixelFiles(mbn: Uint8Array, selDb: string): Map<string, Uint8Array> {
  const image = parseMcfg(mbn);
  if (image === undefined) throw new Error("not MCFG");
  const records = pairSelection([{ image }], parseSelectionDb(selDb)).paired.flatMap((p) => p.records);
  return new Map([["mcfg_sw.mbn", mbn], ["selection.json", json(records)]]);
}

describe("qualcommConfig", () => {
  const files = pixelFiles(fixture("decode-qualcomm", "pixel5a/dcm-cut.mbn"), new TextDecoder().decode(fixture("decode-qualcomm", "pixel5a/mcfg_sel_db-cut.xml")));
  const mapped = qualcommConfig(files, "s1");
  const c = mapped.config;

  it("names NV items and EFS files from describeNv, with its confidence, and selects by the rule's PLMNs", async () => {
    expect(await stored(mapped)).toBe(true);
    expect([c.family, c.label, c.scope, c.selection, mapped.base]).toEqual(["qualcomm", "Commercial-DCM", "carrier", [{ mccmnc: "44010" }], null]);
    expect(c.items.map((i) => i.id)).toEqual(["efs:/nv/item_files/ims/IMS_enable", "efs:/nv/item_files/modem/data/3gpp/global_throttling", "nv:1896", "nv:909", "nv:3533"]);
    expect(c.combos).toEqual([]);
    expect(c.errors).toEqual([]);
  });

  it("types each value, with the decoders' meaning and label, and states the MCFG version and trailer", () => {
    expect(byId(c, "efs:/nv/item_files/ims/IMS_enable")).toEqual({
      id: "efs:/nv/item_files/ims/IMS_enable", name: "IMS enable", description: "Enables the IMS task (VoLTE, VoWiFi, SMS over IMS)",
      value: { kind: "number", value: 1 }, label: "Enabled", certainty: "high",
    });
    expect(byId(c, "efs:/nv/item_files/modem/data/3gpp/global_throttling")).toMatchObject({ value: { kind: "number", value: 512 }, label: null });
    expect(c.facts).toEqual([
      { label: "MCFG version", value: "0a010d0d" }, { label: "Label", value: "Commercial-DCM" }, { label: "Version", value: "0d0d010a" },
      { label: "Base version", value: "0d0d010a" }, { label: "Capability", value: "04000000" },
      { label: "Digest", value: "00000000000000000000000000000000" }, { label: "Trailer version", value: "0001" },
    ]);
  });

  it("keeps the config when the band combos do not read, with the error", async () => {
    const badMapped = qualcommConfig(new Map([...files, ["band_combos_per_plmn.xml", new TextEncoder().encode("<CARRIER_LIST><PLMN-ID>440-10</PLMN-ID><DCM>b1Z[x]</DCM></CARRIER_LIST>")]]), "s1");
    const bad = badMapped.config;
    expect(await stored(badMapped)).toBe(true);
    expect(bad.items).toEqual(c.items);
    expect(bad.combos).toEqual([]);
    expect(bad.errors).toEqual([expect.stringMatching(/^band_combos_per_plmn\.xml: /)]);
  });

  it("reads band combos listed under the selected PLMNs, one list per carrier tag, stored apart by content", async () => {
    const xml = "<CARRIER_LIST><PLMN-ID>440-10</PLMN-ID><DCM>b1A[4]-n78A[2,2]A;b3C[4:30]</DCM><PLMN-ID>310-260</PLMN-ID><TMO>b2A</TMO></CARRIER_LIST>";
    const withCombos = qualcommConfig(new Map([...files, ["band_combos_per_plmn.xml", new TextEncoder().encode(xml)]]), "s1");
    const list = [
      [{ band: "B1", dl: "A", dlLayers: 4 }, { band: "n78", dl: "A", ul: "A", dlLayers: 2 }],
      [{ band: "B3", dl: "C", dlLayers: 4 }],
    ];
    expect(withCombos.config.combos).toEqual([["band_combos_per_plmn.xml: DCM", list]]);
    const n = await normalizeMapped(withCombos);
    const [set] = n.config.combos;
    expect(n.config.combos).toEqual([{ key: expect.stringMatching(/^[0-9a-f]{64}$/), sources: ["band_combos_per_plmn.xml: DCM"], count: 2 }]);
    expect(set && n.combos.get(set.key)).toEqual(list);
  });

  it("is the firmware's own when no selection record names it, or one selects it whatever the SIM", () => {
    const always = [{ carrierName: "ROW", carrierIndex: 8, rule: { kind: "always" }, options: {} }];
    expect(qualcommConfig(new Map([...files, ["selection.json", json([])]]), "s1").config.scope).toBe("firmware");
    expect(qualcommConfig(new Map([...files, ["selection.json", json(always)]]), "s1").config.scope).toBe("firmware");
  });

  it("turns rule trees into SimMatchers, leaving out what a SimMatcher cannot state", () => {
    const db = parseSelectionDb(new TextDecoder().decode(fixture("decode-qualcomm", "pixel5a/mcfg_sel_db-cut.xml")));
    const sims = (name: string): SimMatcher[] => selectionSims(db.records.filter((r) => r.carrierName === name));
    expect(sims("KDDI")).toEqual([{ mccmnc: "44051" }, { mccmnc: "44050" }]);
    // 302-720 and (GID1 D2 or custom id 20): only the GID1 way in is a SimMatcher.
    expect(sims("Chatr")).toEqual([{ mccmnc: "302720", gid1: "D2" }]);
    // Every way in needs custom id 11.
    expect(sims("USCC-Fi")).toEqual([]);
    expect(sims("ROW")).toEqual([]);
  });

  describe("items with prefix bytes, no value or a layout", () => {
    const u16 = (n: number): number[] => [n & 0xff, n >> 8];
    const u32 = (n: number): number[] => [...u16(n & 0xffff), ...u16(n >>> 16)];
    const item = (type: number, attr: number, body: number[]): number[] => [...u32(8 + body.length), type, attr, 0, 0, ...body];
    const nv = (attr: number, n: number, data: number[]): number[] => item(1, attr, [...u16(n), ...u16(data.length), ...data]);
    const efs = (attr: number, path: string, data: number[]): number[] => {
      const p = [...new TextEncoder().encode(path), 0];
      return item(2, attr, [...u16(1), ...u16(p.length), ...p, ...u16(2), ...u16(data.length), ...data]);
    };
    const label = [...new TextEncoder().encode("Test")];
    const trailer = item(10, 0, [0xa1, 0, 0, 0, ...new TextEncoder().encode("MCFG_TRL"), 3, ...u16(label.length), ...label, 9, 0, 0]);
    const items = [
      nv(0x39, 10, [7, 0, 4, 0]),
      // The secondary subscriptions' mode preference, GSM only.
      nv(0x39, 10, [6, 0, 13, 0]),
      nv(0x19, 1897, [7, 0xf4, 1, 0xa0, 0xf, 0xa0, 0xf, 3, 0, 3, 0, 0, 0]),
      nv(0x39, 1206, [7, 2, ...new Array<number>(26).fill(1)]),
      // Its class leads with an EVRC NAM byte that the attributes do not mark.
      nv(0x19, 285, [7, 0, 1, 3, 0, 3, 0, 3, 0]),
      nv(0x39, 850, [7, 0, 1]),
      efs(0x58, "/sd/mru001", [7]),
      trailer,
    ];
    const mbn = Uint8Array.from([
      ...new TextEncoder().encode("MCFG"), ...u16(2), ...u16(1), ...u32(items.length), ...u16(0), ...u16(0), ...u16(0x1383), ...u16(0), ...items.flat(),
    ]);
    const mapped = qualcommConfig(new Map([["mcfg_sw.mbn", mbn], ["selection.json", json([])]]), "s2");
    const c = mapped.config;

    it("ids each item by its index and a subscription mask narrower than all, with values read past both", async () => {
      expect(await stored(mapped)).toBe(true);
      expect(c.items.map((i) => i.id)).toEqual(["nv:10", "nv:10@6", "nv:1897", "nv:1206/2", "nv:285", "nv:850", "efs:/sd/mru001"]);
      expect(byId(c, "nv:10")).toMatchObject({ value: { kind: "number", value: 4 }, label: "Automatic" });
      expect(byId(c, "nv:10@6")).toMatchObject({ value: { kind: "number", value: 13 }, label: "GSM only" });
      expect(byId(c, "efs:/sd/mru001")).toMatchObject({ value: { kind: "bytes", hex: "" }, label: "No value" });
    });

    it("reads values of a layout's size as its fields, and keeps others as stored with an error", () => {
      expect(byId(c, "nv:1897")).toMatchObject({ value: { kind: "fields", fields: { InitSolDelay: { kind: "number", value: 500 }, MaxResolAttempts: { kind: "number", value: 3 } } } });
      expect(byId(c, "nv:285")).toMatchObject({ value: { kind: "fields", fields: { EvrcCapabilityEnabled: { kind: "number", value: 1 }, RoamOrigVoiceSo: { kind: "number", value: 3 } } } });
      expect(byId(c, "nv:850")).toMatchObject({ value: { kind: "bytes", hex: "01" }, label: null });
      expect(c.errors).toEqual(["nv:850: 1 bytes where its layout has 2; shown as stored"]);
    });
  });
});

/** Protobuf bytes from (field, value) pairs: numbers as varints, everything else length-delimited. */
function pb(fields: readonly (readonly [number, number | string | Uint8Array])[]): Uint8Array {
  const varint = (n: number): number[] => { const out: number[] = []; for (; n > 0x7f; n = Math.floor(n / 128)) out.push((n & 0x7f) | 0x80); return [...out, n]; };
  return new Uint8Array(fields.flatMap(([f, x]) => {
    if (typeof x === "number") return [...varint(f * 8), ...varint(x)];
    const b = typeof x === "string" ? new TextEncoder().encode(x) : x;
    return [...varint(f * 8 + 2), ...varint(b.length), ...b];
  }));
}
const hexBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

describe("shannonConfig", () => {
  const plain = fixture("decode-shannon", "confseq-plain.pb");
  const ca = fixture("decode-shannon", "confseq-clz4.bin");
  const entry = (scope: number, seq: Uint8Array, base: boolean): Uint8Array =>
    pb([...(scope === 0 ? [] : [[1, scope] as const]), [2, hexBytes(sha1Hex(seq))], ...(base ? [[4, 1] as const] : []), [8, 4]]);
  // common: the CA layer; sim1: the carrier layer, then the same again as sim2.
  const manifest = pb([[1, "v0.1"], [2, "xx_test"], [3, 4242], [5, entry(0, ca, true)], [5, entry(1, plain, false)], [5, entry(2, plain, false)]]);
  const db = decodeCarrierDb(fixture("decode-shannon", "cfg.db"));
  const matchers = db.carriers.filter((x) => x.id >= 4242 && x.id <= 4245).flatMap((x) => x.matchers);
  const MTU = "!NRPM.MTU_DEFAULT_SIZE";
  // The carrier layer's items, and the CA base layer's.
  const [OWN, BASE] = [4, 61];
  const files = new Map<string, Uint8Array>([
    ["manifest.pb", manifest],
    [`confseqs/${sha1Hex(plain)}.pb`, plain],
    [`confseqs/${sha1Hex(ca)}.pb`, ca],
    ["names.json", json({ [crc32(new TextEncoder().encode(MTU)).toString(16).padStart(8, "0")]: [MTU] })],
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
    expect(c.facts).toEqual([{ label: "Manifest version", value: "v0.1" }, { label: "Carrier id", value: "4242" }]);
    expect(c.errors).toEqual([]);
    expect(c.selection).toEqual([
      { mccmnc: "310260" }, { mccmnc: "31026" }, { mccmnc: "310260", imsiPrefix: "31026097" }, { mccmnc: "310260", gid1: "4276" },
      { mccmnc: "20404", spn: "TEST SPN", iccidPrefix: "898603" },
    ]);
  });

  it("keeps what its own layers set, merging scopes, and the base layers apart as the firmware's", () => {
    expect(c.items).toHaveLength(OWN);
    // Set alike in sim1 and sim2, so one value.
    expect(c.items.find((i) => i.name === MTU)).toMatchObject({ value: { kind: "number", value: 1400 }, description: null, label: null, certainty: "medium" });
    expect(mapped.base).toMatchObject({ family: "shannon", scope: "firmware", selection: [], facts: [], errors: [] });
    expect(mapped.base?.items).toHaveLength(BASE);
    expect([...c.items, ...(mapped.base?.items ?? [])].filter((i) => i.name === null).every((i) => i.certainty === "opaque" && /^crc:[0-9a-f]{8}$/.test(i.id))).toBe(true);
  });

  it("names the same base for every config on the same base layers, by its content", async () => {
    const other = new Map([...files, ["manifest.pb", pb([[1, "v0.1"], [2, "yy_test"], [3, 4243], [5, entry(0, ca, true)], [5, entry(1, plain, false)]])]]);
    const [a, b] = await Promise.all([normalizeMapped(mapped), normalizeMapped(shannonConfig(other, "s9"))]);
    expect(a.config.base).toMatch(/^[0-9a-f]{64}$/);
    expect([b.config.base, b.base?.sha]).toEqual([a.config.base, a.config.base]);
  });

  it("reads each uecap file as a list of its own", () => {
    expect(c.combos.map(([source, list]) => [source, list.length])).toEqual([["uecap/TMO_1.binarypb", 6], ["uecap/lte_1.binarypb", 4], ["LTE CA items", 0]]);
    // Files in UTF-8 order: TMO_1's n41C+A (100 + 80 MHz), then lte_1's 1A2-3A4A.
    expect(combinations(c)[2]).toEqual([{ band: "n41", dl: "C", ul: "A", dlLayers: 4, bandwidthMhz: 180, scsKhz: 30 }]);
    expect(combinations(c)[6]).toEqual([{ band: "B1", dl: "A", dlLayers: 2 }, { band: "B3", dl: "A", ul: "A", dlLayers: 4 }]);
  });

  it("is the firmware's own when cfg.db names no SIM for it", () => {
    expect(shannonConfig(new Map([...files, ["carrier.json", json([])]]), "s2").config.scope).toBe("firmware");
  });

  it("types multi-value items as lists and values that differ by scope as fields", () => {
    const all = [...c.items, ...(mapped.base?.items ?? [])];
    const kinds = new Set(all.map((i) => i.value.kind));
    expect([...kinds].every((k) => ["number", "list", "fields"].includes(k))).toBe(true);
    const list = all.find((i) => i.value.kind === "list");
    expect(list?.value).toMatchObject({ kind: "list", values: expect.arrayContaining([{ kind: "number", value: expect.any(Number) }]) });
  });

  it("keeps the rest when a confseq or uecap file does not decode, with the errors", async () => {
    const broken = shannonConfig(new Map([...files, [`confseqs/${sha1Hex(plain)}.pb`, new Uint8Array([0xff])], ["uecap/TMO_1.binarypb", new Uint8Array([0xff])]]), "s2");
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
    const hash = (name: string): number => crc32(new TextEncoder().encode(name));
    const hex = (name: string): string => hash(name).toString(16).padStart(8, "0");
    const item = (name: string, ...values: number[]): readonly [number, Uint8Array] =>
      [4, pb([[1, hash(name)], ...values.map((x) => [2, pb(x === 0 ? [] : [[3, x]])] as const)])];
    const seq = (name: string, ...items: (readonly [number, Uint8Array])[]): Uint8Array => pb([[1, "v1.0"], [2, name], ...items]);
    const URI = "PSS.AIMS.XCAP.ROOT.URI";
    const comb = (...dl: number[]): (readonly [number, Uint8Array])[] => [
      item("UECAPA_REL10_CA_COMB_NUM", 1), item("UECAPA_REL10_CA_COMB_1_NUM_BAND", 2), item("UECAPA_REL10_CA_COMB_1_BAND", 1, 3),
      item("UECAPA_REL10_CA_COMB_1_DL_BW_CLASS_BIT_MAP", ...dl), item("UECAPA_REL10_CA_COMB_1_UL_BW_CLASS_BIT_MAP", 0, 0x8000),
    ];
    // NOT_IN_REGISTRY has no definition in items.json, as a firmware's registry can lack an item its confseqs set.
    const common = seq("default.common", item("PSS.AIMS.EVS.ChAwRecv", 255, 0), item(URI, ...[..."/mtas"].map((c) => c.charCodeAt(0)), 0), item("AP_BASED_EMC", 1, 2), item("NOT_IN_REGISTRY", 7));
    // Two hardware variants' layers, alike but for MTU.
    const hw0 = seq("lte_ca_0x241_0.common", ...comb(0x8000, 0x8001), item(MTU, 1400));
    const hw1 = seq("lte_ca_0x242_0.common", ...comb(0x8000, 0x8001), item(MTU, 1500));
    const on = (variant: number, seq: Uint8Array): Uint8Array => pb([[2, hexBytes(sha1Hex(seq))], [6, 4], [7, 14], ...(variant ? [[8, variant] as const] : [])]);
    const defs = {
      "PSS.AIMS.EVS.ChAwRecv": ["s8", 2], [URI]: ["u8", 100], [MTU]: ["u16", 1], AP_BASED_EMC: ["u8", 1], UECAPA_REL10_CA_COMB_NUM: ["u16", 1],
      UECAPA_REL10_CA_COMB_1_NUM_BAND: ["u8", 1], UECAPA_REL10_CA_COMB_1_BAND: ["u16", 6],
      UECAPA_REL10_CA_COMB_1_DL_BW_CLASS_BIT_MAP: ["u16", 6], UECAPA_REL10_CA_COMB_1_UL_BW_CLASS_BIT_MAP: ["u16", 6],
    } as const;
    const m = shannonConfig(new Map([
      ["manifest.pb", pb([[1, "v0.1"], [2, "xx_test"], [5, pb([[2, hexBytes(sha1Hex(common))], [8, 4]])], [5, on(0, hw0)], [5, on(1, hw1)]])],
      ...[common, hw0, hw1].map((b) => [`confseqs/${sha1Hex(b)}.pb`, b] as const),
      ["items.json", json(Object.fromEntries(Object.entries(defs).map(([name, [type, capacity]]) => [hex(name), { name, type, capacity }])))],
      ["carrier.json", json([])],
    ]), "s3");
    const c = m.config;
    const byName = (name: string): unknown => c.items.find((i) => i.name === name);

    it("reads each value at its registry type, described by it", async () => {
      expect(await stored(m)).toBe(true);
      expect(byName("PSS.AIMS.EVS.ChAwRecv")).toMatchObject({ description: "s8[2]", value: { kind: "list", values: [{ kind: "number", value: -1 }, { kind: "number", value: 0 }] } });
      expect(byName(URI)).toMatchObject({ description: "u8[100]", value: { kind: "text", value: "/mtas" }, certainty: "medium" });
    });

    it("keys a value that differs by hardware by scope and condition, and keeps one that breaks its type, untyped, with an error", () => {
      expect(byName(MTU)).toMatchObject({ value: { kind: "fields", fields: { "common · hw 4=14/0": { kind: "number", value: 1400 }, "common · hw 4=14/1": { kind: "number", value: 1500 } } } });
      expect(byName("UECAPA_REL10_CA_COMB_NUM")).toMatchObject({ value: { kind: "number", value: 1 } });
      expect(byName("AP_BASED_EMC")).toMatchObject({ description: "u8", value: { kind: "list", values: [{ kind: "number", value: 1 }, { kind: "number", value: 2 }] } });
      expect(c.errors).toContain(`crc:${hex("AP_BASED_EMC")}: AP_BASED_EMC: 2 values for 1 elements`);
    });

    it("keeps an item the registry lacks, untyped, and says so", () => {
      expect(c.items.find((i) => i.id === `crc:${hex("NOT_IN_REGISTRY")}`)).toMatchObject({ value: { kind: "number", value: 7 } });
      expect(c.errors).toContain(`crc:${hex("NOT_IN_REGISTRY")}: not in the modem's item registry; its values are shown untyped`);
    });

    it("reads LTE CA combinations from the items, once however many conditions give them", () => {
      expect(c.combos).toEqual([["LTE CA items", [[{ band: "B1", dl: "A", dlLayers: 2 }, { band: "B3", dl: "A", ul: "A", dlLayers: 4 }]]]]);
    });
  });
});

describe("mediatekConfig", () => {
  // The fixtures' items as a900a-MP_260716's md1rom item table shapes them: LID, size, unit, array depth.
  const shapes = {
    build: "a900a-MP_260716-260716-M-15880348",
    items: {
      7916: [1346, 1, "byte", 0], 7989: [1346, 1, "byte", 0], 8398: [2191, 1, "byte", 2], 8399: [2191, 1, "byte", 1],
      8400: [2191, 8, "bit", 1], 8401: [2191, 1, "byte", 1], 8402: [2191, 4, "byte", 1], 8403: [2191, 32, "bit", 1],
      8405: [2191, 1, "byte", 1], 8406: [2191, 8, "bit", 1], 8407: [2191, 1, "byte", 1], 8408: [2191, 8, "bit", 1],
      8409: [2191, 1, "bit", 1], 11082: [2191, 1, "byte", 1], 11083: [2191, 8, "bit", 1], 17960: [2191, 1, "bit", 1],
      28976: [961, 8, "bit", 0], 29084: [960, 1, "bit", 0], 29086: [960, 1, "bit", 0], 29087: [960, 1, "bit", 0],
      29088: [960, 1, "bit", 0], 29089: [960, 1, "bit", 0], 29090: [960, 1, "bit", 0], 35279: [960, 1, "bit", 0],
    },
    owners: { 960: "SBP", 961: "SBP", 1346: "IMS", 2191: "D2" },
    // Stand-ins for the names md1rom's SBP tables give.
    names: { 28976: "SBP_TEST_DATA", 29084: "SBP_TEST_FEATURE" },
  };
  const files = new Map([
    ["op.mcfopota", fixture("decode-mediatek", "op-ota.mcfopota")],
    ["nw.mcfnwota", fixture("decode-mediatek", "nw-ota.mcfnwota")],
    ["sbp.json", json({ id: 108, operator: null, plmns: [{ mcc: "466", mnc: "97" }, { mcc: "466", mnc: null }] })],
    ["items.json", json(shapes)],
  ]);
  const mapped = mediatekConfig(files, "s3");
  const c = mapped.config;

  it("keys items by LID and item id, named where the item table names them, with values typed by it", async () => {
    expect(await stored(mapped)).toBe(true);
    expect([c.family, c.label, c.scope, c.selection, c.combos, c.errors]).toEqual(["mediatek", "SBP 108", "carrier", [{ mccmnc: "46697" }], [], []]);
    expect(c.facts).toEqual([
      { label: "Build", value: expect.stringMatching(/./) },
      { label: "SBP", value: "108" },
      { label: "Item table", value: expect.stringMatching(/^a900a-/) },
    ]);
    expect(c.items.every((i) => /^lid:0x[0-9a-f]+\/\d+$/.test(i.id))).toBe(true);
    expect(c.items.filter((i) => i.name !== null).map((i) => [i.id, i.name, i.certainty])).toEqual([
      [`lid:0x3c1/${28976}`, "SBP_TEST_DATA", "medium"], [`lid:0x3c0/${29084}`, "SBP_TEST_FEATURE", "medium"],
    ]);
    expect(c.items.filter((i) => i.name === null).every((i) => i.certainty === "opaque")).toBe(true);
    // Recorded once per PLMN of the SBP: keyed by condition, values by array path.
    const text = (value: string): ModemValue => ({ kind: "text", value });
    const apn: ModemValue = { kind: "fields", fields: { "0$0$": text("examplea"), "1$0$": text("ims"), "2$0$": text("xyz") } };
    expect(byId(c, `lid:0x88f/${0x20ce}`)).toMatchObject({ description: "D2 · 8-bit, 2-index array", value: { kind: "fields", fields: { "466-97": apn, "466-99": apn } } });
    // A scalar for any PLMN of the SBP.
    expect(c.items.find((i) => i.id.endsWith(`/${0x7130}`))?.value).toEqual({ kind: "number", value: 12 });
  });

  it("is the firmware's own for SBP 0, no operator's", () => {
    expect(mediatekConfig(new Map([...files, ["sbp.json", json({ id: 0, operator: null, plmns: [] })]]), "s3").config.scope).toBe("firmware");
  });

  it("keeps a value the item table cannot place as bytes, and says why", async () => {
    const { 28976: _, ...rest } = shapes.items;
    const m = mediatekConfig(new Map([...files, ["items.json", json({ ...shapes, items: rest })]]), "s3");
    const unplaced = m.config;
    expect(await stored(m)).toBe(true);
    expect(unplaced.errors).toEqual([`lid:0x3c1/${0x7130}: item not in the modem's item table; kept as bytes`]);
    expect(byId(unplaced, `lid:0x3c1/${0x7130}`)).toMatchObject({ description: null, value: { kind: "bytes", hex: "0c" } });
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
const iosModemConfigs = (bundle: OpenedBundle, sha: string): ModemConfig[] =>
  bundle.info.files.filter((f) => f.path.endsWith(".der.pri")).flatMap((f) => iosModemConfig(bundle, f.path, sha) ?? []);

describe("iosModemConfig", () => {
  const pixel = qualcommConfig(
    pixelFiles(fixture("decode-qualcomm", "pixel5a/dcm-cut.mbn"), new TextDecoder().decode(fixture("decode-qualcomm", "pixel5a/mcfg_sel_db-cut.xml"))), "s1",
  ).config;

  it("gives one config per .der.pri, labelled by file, with Pixel's item ids and values", () => {
    const configs = iosModemConfigs(priBundle("DoCoMo_jp", fixture("decode-ios", "pri/docomo.der.pri")), "b1");
    expect(configs.map((c) => [c.family, c.label, c.sha, c.selection])).toEqual([["qualcomm", "overrides_D93_D94_D47_D48.der.pri", "b1", []]]);
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
      "overrides_D49.der.pri", "overrides_D52g_D53g_D53p_D54p.der.pri", "overrides_D63_D64_D16_D17.der.pri",
      "overrides_D73_D74_D27_D28.der.pri", "overrides_D83_D84_D37_D38.der.pri",
    ]);
    expect(configs.every((c) => c.errors.length === 0 && c.items.every((i) => /^(nv:\d+|efs:\/|pri:)/.test(i.id)))).toBe(true);
  });

  it("gives a file that does not decode a config of its own, holding the error", () => {
    const pri = fixture("decode-ios", "pri/docomo.der.pri");
    const broken = new Uint8Array([0x31, 0x84, 0xff, 0xff, 0xff, 0xff]);
    const configs = iosModemConfigs(bundle("Test_jp", {
      "overrides_A.der.pri": pri,
      "overrides_B.der.pri": new Uint8Array([...pri, ...broken]),
      "overrides_C.der.pri": broken,
    }), "b3");
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
    expect([c.family, c.label, c.facts, c.errors]).toEqual(["qualcomm", "overrides_V64.der.tri", [{ label: "File version", value: "1.2.300" }], []]);
    expect(c.items.map((i) => [i.id, i.certainty])).toEqual([
      ["tri:2", "opaque"], ["tri:3/1", "low"], ["tri:3/2", "opaque"], ["tri:3/3", "medium"], ["tri:3/4", "medium"], ["tri:3/5", "low"], ["tri:3/9", "opaque"],
    ]);
    expect(byId(c, "tri:3/9")).toMatchObject({ value: { kind: "bytes", hex: "abcd" } });
    const list = c.items.find((i) => i.id === "tri:3/3")?.value;
    expect(list?.kind === "list" && list.values.at(-1)).toEqual({
      kind: "fields",
      fields: { plmn: { kind: "text", value: "001-01" }, access: { kind: "text", value: "E-UTRAN" }, unknownBits: { kind: "number", value: 0x0100 } },
    });
  });

  it("has no Qualcomm items in the Apple-modem form, a PRI in the Intel dialect", () => {
    expect(iosModemConfig(b, "overrides_V63_V64s_V68.der.tri", "t1")).toBeNull();
  });
});

/** A PriValue as the ModemValue it must become: the decoder's own reading of the same bytes. */
function asModemValue(v: PriValue): ModemValue {
  switch (v.kind) {
    case "int": return v.exact === undefined ? { kind: "number", value: v.int } : { kind: "bytes", hex: v.hex };
    case "string": return { kind: "text", value: v.text };
    case "xml": return { kind: "xml", value: v.text };
    case "bytes":
    case "empty": return { kind: "bytes", hex: v.hex };
  }
}

describe("iosModemConfig: everything the decoded PRI holds", () => {
  const files = ["carrier-att.ipcc", "carrier-verizon.ipcc", "carrier-airtel-in.ipcc", "carrier-cw-pa.ipcc"].flatMap((name) => {
    const b = openIpcc(fixture("decode-ios", name));
    return b.info.files.filter((f) => f.path.endsWith(".der.pri")).map((f) => ({ b, path: `${name}/${f.path}`, file: f.path }));
  });

  it.each(files)("$path", ({ b, file }) => {
    const pri = decodedPri(decodeFile(b, file));
    if (pri === undefined) throw new Error("not a DER PRI");
    const c = iosModemConfig(b, file, "b");
    if (pri.dialect === "intel") return expect(c).toBeNull();
    if (c === null) throw new Error("no config");
    const item = (id: string): ModemItem | undefined => c.items.find((i) => i.id === id);

    expect(c.errors).toEqual(pri.errors);
    expect(c.facts).toEqual([
      { label: "Written for", value: `${dialectLabel(pri.dialect)} modem` },
      ...Object.entries(pri.header).filter(([, v]) => v !== "").map(([label, value]) => ({ label, value })),
    ]);
    // Each path once: one row per path loses no override.
    expect(new Set(pri.efs.map((e) => e.path)).size).toBe(pri.efs.length);
    for (const e of pri.efs) {
      expect(item(`efs:${e.path}`)).toEqual({
        id: `efs:${e.path}`, name: e.name ?? null, description: e.meaning === e.name ? null : e.meaning ?? null,
        value: asModemValue(e.value), label: e.label ?? null, certainty: e.confidence === undefined ? "opaque" : expect.any(String),
      });
    }
    for (const n of pri.nv) {
      expect(item(`nv:${n.item}`)).toMatchObject({ name: n.name ?? null, description: n.meaning ?? null, value: asModemValue(n.value), label: n.label ?? null });
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
    for (const n of pri.named) expect(item(`pri:setting/${n.name}`)).toMatchObject({ name: n.name, value: asModemValue(n.value) });
    if (pri.nvListed.length) {
      expect(item("pri:nv-list")?.value).toEqual({
        kind: "list",
        values: pri.nvListed.map((n) => ({ kind: "fields", fields: { nv: { kind: "number", value: n.item }, ...(n.name && { name: { kind: "text", value: n.name } }) } })),
      });
      expect(item("pri:nv-list")?.description).toContain(`with a value here: ${pri.nvListed.filter((n) => n.set).map((n) => n.item).join(", ")}.`);
    }
    if (pri.schema.count) {
      expect(item("pri:schema")).toMatchObject({ value: { kind: "list", values: pri.schema.paths.map((p) => ({ kind: "text", value: p })) } });
      expect(item("pri:schema")?.description).toContain(`${pri.schema.count} NV paths the PRI format knows (${pri.schema.source})`);
    }
    for (const u of pri.unknown) {
      expect(item(`pri:${u.tag}`)?.description).toContain(`${u.count} ${u.count === 1 ? "time" : "times"}, ${u.len} bytes${u.note ? `: ${u.note}` : ""}`);
    }
    const listed = (pri.nvListed.length ? 1 : 0) + (pri.schema.count ? 1 : 0);
    expect(c.items).toHaveLength(pri.efs.length + new Set([...pri.nv.map((n) => n.item), ...pri.featureGroups.map((g) => g.nv)]).size + pri.named.length + listed + pri.unknown.length);
  });
});

const corpus = process.env["CORPUS"] && join(process.env["CORPUS"], "modem");
describe.runIf(corpus && existsSync(corpus))("corpus: Pixel 5a and iPhone T-Mobile", () => {
  const read = (name: string): Uint8Array => new Uint8Array(readFileSync(join(corpus || "", name)));

  it("share item ids for the EFS paths both set", () => {
    const pixel = qualcommConfig(pixelFiles(read("pixel5a_TMO_Commercial_mcfg_sw.mbn"), new TextDecoder().decode(read("pixel5a_mcfg_sel_db.xml"))), "p").config;
    const [ios] = iosModemConfigs(priBundle("TMobile_US", read("ios_TMobile_US_overrides_D93_D94_D47_D48.der.pri")), "i");
    if (ios === undefined) throw new Error("no config");
    expect(pixel.label).toBe("Commercial-TMO");
    expect(pixel.selection).toContainEqual({ mccmnc: "310260" });
    expect(sharedIds(pixel, ios).filter((id) => id.startsWith("efs:")).map((id) => id.slice("efs:".length))).toEqual([
      "/nv/item_files/ims/IMS_enable",
      "/nv/item_files/modem/lte/rrc/efs/band_priority_list_v2",
      "/nv/item_files/modem/lte/rrc/efs/eps_fallback_control",
      "/nv/item_files/modem/mmode/sms_domain_pref",
      "/nv/item_files/modem/mmode/voice_domain_pref",
      "/policyman/carrier_policy.xml",
      "/nv/item_files/modem/lte/rrc/PC2_WHITELIST.xml",
      "/nv/item_files/modem/lte/rrc/efs/lte_feature_disable",
      "/nv/item_files/modem/lte/rrc/efs/lte_feature_enable",
      "/nv/item_files/modem/nr5g/RRC/cap_add_bw",
      "/nv/item_files/modem/mmode/nr5g_disable_mode",
    ]);
    // Equal bytes, equal item: the domain preferences read the same on both.
    expect(byId(ios, "efs:/nv/item_files/modem/mmode/voice_domain_pref")).toEqual(byId(pixel, "efs:/nv/item_files/modem/mmode/voice_domain_pref"));
  });
});

describe("modemRadios", () => {
  it("counts the 5G items of a config's base layers as its own", () => {
    const release: Release = {
      platform: "android", id: "CP3A.1", version: "16", patch: "2026-09", devices: ["tokay"], extractedAt: "x", carrierList: "l", sources: {},
      modems: [{ family: "shannon", firmware: "g5400", devices: ["tokay"], configs: { us_tmo: "own" } }],
    };
    const configs = new Map<string, IndexModemConfig>([
      ["own", { sha: "own", selection: [], base: "base", radio: "lte" }],
      ["base", { sha: "base", selection: [], base: null, radio: "nr" }],
    ]);
    expect(modemRadios([release], (sha) => configs.get(sha)).fiveG).toEqual(new Set(["tokay"]));
  });
});

describe("buildIndexes: CarrierDoc.modems", () => {
  const config = (sha: string, label: string, selection: SimMatcher[]): ModemConfig =>
    ({ schema: PROFILE_SCHEMA, family: "shannon", sha, label, scope: "carrier", selection, facts: [], items: [], base: null, combos: [], errors: [] });
  const configs = new Map([
    config("m-tmo", "us_tmo", [{ mccmnc: "310260" }]),
    config("m-mint", "us_mint", [{ mccmnc: "310260", spn: "MINT" }]),
    config("m-default", "default", []),
    config("m-old", "us_tmo", [{ mccmnc: "310260" }]),
    { ...config("q-tmo", "Commercial-TMO", [{ mccmnc: "310260" }, { mccmnc: "310200" }]), family: "qualcomm" as const },
  ].map((c) => [c.sha, indexModemConfig(c)]));
  const profile = (name: string, sims: SimMatcher[]): Profile => {
    const source: SourceRef = { platform: "ios", kind: "carrier", name };
    return { schema: PROFILE_SCHEMA, source, sha: name, identity: { display: name, iso: ["us"], sims }, apns: [], concepts: {}, raw: {}, variants: [] };
  };
  const profiles = new Map([profile("TMobile_US", [{ mccmnc: "310260" }]), profile("Mint_US", [{ mccmnc: "310260", spn: "MINT" }])].map((p) => [p.sha, indexProfile(p)]));
  const android = (id: string, patch: string, modems: Extract<Release, { platform: "android" }>["modems"]): Release =>
    ({ platform: "android", id, version: "16", patch, devices: modems.flatMap((m) => m.devices), extractedAt: "x", carrierList: "l", sources: {}, modems });
  const releases: Release[] = [
    { platform: "ios", id: "24A1", version: "27.0", label: "27.0", prerelease: false, devices: [], extractedAt: "x", modems: [], sources: {
      "ios:carrier:TMobile_US": { sha: "TMobile_US", cid: "c1", version: "1", size: 1 },
      "ios:carrier:Mint_US": { sha: "Mint_US", cid: "c2", version: "1", size: 1 },
    } },
    android("CP3A.2", "2026-09", [{ family: "shannon", firmware: "g5400-new", devices: ["tokay"], configs: { us_tmo: "m-tmo", us_mint: "m-mint", default: "m-default" } }]),
    android("CP3A.1", "2026-08", [
      { family: "shannon", firmware: "g5400-old", devices: ["tokay", "caiman"], configs: { us_tmo: "m-old" } },
      { family: "qualcomm", firmware: "MPSS.HI", devices: ["barbet"], configs: { "Commercial-TMO": "q-tmo", missing: "not-stored" } },
    ]),
  ];
  const out = buildIndexes({ releases, otaFiles: [], devices: [], labels: [], profiles: (sha) => profiles.get(sha), manifestSims: {}, modemConfigs: (sha) => configs.get(sha), carrierIds: {} });

  it("reads exactly the configs linkedConfigShas names", () => {
    const read = new Set<string>();
    buildIndexes({ releases, otaFiles: [], devices: [], labels: [], profiles: (sha) => profiles.get(sha), manifestSims: {}, modemConfigs: (sha) => (read.add(sha), configs.get(sha)), carrierIds: {} });
    expect([...read].sort()).toEqual(linkedConfigShas(releases).sort());
  });
  const modems = (id: string): string[] =>
    out.docs.find((d) => d.carrier.id === id)?.modems.map((m) => `${m.release} ${m.firmware} ${m.devices.join(",")} ${m.family.code} ${m.label} ${m.sha}`) ?? [];

  it("attaches the configs a carrier's SIM rules select exactly, from each device's newest release", () => {
    // caiman is in CP3A.1's group only, so that group keeps it alone; tokay's comes from CP3A.2.
    expect(modems("TMobile_US")).toEqual([
      "CP3A.2 g5400-new tokay shannon us_tmo m-tmo",
      "CP3A.1 g5400-old caiman shannon us_tmo m-old",
      "CP3A.1 MPSS.HI barbet qualcomm Commercial-TMO q-tmo",
    ]);
  });

  it("falls back to configs selected by the whole MCC-MNC, and never attaches an unselected config", () => {
    expect(modems("Mint_US")).toEqual([
      "CP3A.2 g5400-new tokay shannon us_mint m-mint",
      "CP3A.1 g5400-old caiman shannon us_tmo m-old",
      "CP3A.1 MPSS.HI barbet qualcomm Commercial-TMO q-tmo",
    ]);
    expect(out.docs.flatMap((d) => d.modems).some((m) => m.label === "default")).toBe(false);
  });
});

describe("modemConfig", () => {
  const dcm = pixelFiles(fixture("decode-qualcomm", "pixel5a/dcm-cut.mbn"), new TextDecoder().decode(fixture("decode-qualcomm", "pixel5a/mcfg_sel_db-cut.xml")));

  it("maps an archive by the family its members name", async () => {
    expect(await modemConfig(packFiles(dcm), "s1")).toEqual(await normalizeMapped(qualcommConfig(dcm, "s1")));
  });

  it("refuses an archive that is no one family's", async () => {
    await expect(modemConfig(packFiles(new Map([["selection.json", json([])]])), "s0")).rejects.toThrow(/not one family's archive/);
    await expect(modemConfig(packFiles(new Map([...dcm, ["manifest.pb", new Uint8Array()]])), "s0")).rejects.toThrow(/not one family's archive/);
  });
});

describe("deviceModems", () => {
  const modem = (vendor: ModemVendor, devices: string[]): CarrierModem => ({ family: { code: vendor, name: vendor }, release: "r", firmware: "f", devices, label: vendor, sha: vendor });
  const modems = [modem("qualcomm", ["redfin"]), modem("shannon", ["tokay", "caiman"])];

  it("keeps the configurations the device carries, and none for no device", () => {
    expect(deviceModems(modems, "caiman").map((m) => m.family.code)).toEqual(["shannon"]);
    expect(deviceModems(modems, "cubs")).toEqual([]);
    expect(deviceModems(modems, null)).toEqual([]);
  });
});
