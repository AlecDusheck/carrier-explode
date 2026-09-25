/**
 * Tests for `src/lib/decode/mdb.ts` (modem databases, small EFS files),
 * `src/lib/decode/ssgccs.ts` (fake base station detection config) and
 * `src/lib/decode/policyman.ts` (policy element notes).
 *
 * Fixtures in test/fixtures/bbfw/ come from Mav25-2.10.01.Release.bbfw
 * (iOS 27.0 24A437, iPhone18,1), unmodified:
 *   mcc2arfcn.mdb, plmn2features.mdb, plmn2features_lte.mdb
 *                     qdsp6sw.mbn, DSDS-MN-Sariska / MSSS-MN-Sariska configs
 *   ssgccs_config.txt, ssgccs_int_config.txt   bbcfg.mbn blobs 1, 34, 122, 202, 282
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { decodeModemEfs, nrArfcnToMHz, parseMcc2Arfcn, parsePlmnFeatures, plmnFromKey, readMdb } from "../src/lib/decode/mdb.ts";
import { parseSsgccs, SSGCCS_ACTIONS } from "../src/lib/decode/ssgccs.ts";
import { describePolicyAttr, describePolicyElement, POLICY_ELEMENTS } from "../src/lib/decode/policyman.ts";
import { parsePolicyXml, walkPolicy } from "../src/lib/decode/policy.ts";
import { basebandSummary } from "../src/lib/decode/bbfw.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => new Uint8Array(readFileSync(join(here, "fixtures", "bbfw", name)));
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

describe("readMdb", () => {
  it("reads a layout 3 container", () => {
    const m = readMdb(fx("mcc2arfcn.mdb"));
    expect(m.header).toEqual({ version: 1, layout: 3, creator: "Maverick", built: "2014-02-09T11:00:00.000Z" });
    expect(m.blob).toHaveLength(1660);
  });

  it("reads a layout 1 index and groups keys that share a record", () => {
    const m = readMdb(fx("plmn2features.mdb"));
    expect(m.header).toMatchObject({ layout: 1, creator: "Qualcomm" });
    expect(m.header.built).toBeUndefined();
    expect(m.records?.map((r) => [r.keys.length, r.data.length])).toEqual([[2, 270], [1, 270], [15, 13]]);
  });

  it("rejects what it cannot read", () => {
    expect(() => readMdb(new Uint8Array(8))).toThrow(/too short/);
    const b = fx("mcc2arfcn.mdb").slice();
    b[1] = 7;
    expect(() => readMdb(b)).toThrow(/layout 7/);
  });
});

describe("parseMcc2Arfcn", () => {
  const scan = parseMcc2Arfcn(readMdb(fx("mcc2arfcn.mdb")).blob!);

  it("lists per-country NR ranges", () => {
    expect(scan.map((e) => [e.mcc, e.key, e.ranges.length, e.band])).toEqual([
      ["310", 200, 2, 77], ["310", 201, 2, 77], ["310", 210, 2, 258], ["302", 200, 1, 77], ["302", 201, 1, 77], [undefined, 189, 4, 28],
    ]);
    expect(scan[0].ranges[0]).toEqual({ lo: 630000, hi: 636666, loMHz: 3450, hiMHz: 3549.99, uplink: false, x: 2 });
    expect(scan[2].ranges[0]).toMatchObject({ loMHz: 24250.08, hiMHz: 24450 });
  });

  it("labels a band only when one band holds every range", () => {
    // 703-733.59 MHz uplink alone fits n28 and SUL n83; the downlink ranges settle it
    const n28 = scan[5];
    expect(n28.ranges.map((r) => [r.loMHz, r.hiMHz, r.uplink])).toEqual([[703, 733.59, true], [717.41, 748, true], [758, 788.59, false], [772.41, 803, false]]);
    expect(n28.band).toBe(28);
    // 3450-3550 alone is inside both n77 and n78
    const one = parseMcc2Arfcn(Uint8Array.from([...readMdb(fx("mcc2arfcn.mdb")).blob!.subarray(0, 28 + 272)].map((x, i) => (i === 8 ? 16 : i === 9 ? 1 : i === 36 ? 1 : x))));
    expect(one[0].ranges).toHaveLength(1);
    expect(one[0].band).toBeUndefined();
  });
});

describe("parsePlmnFeatures", () => {
  it("decodes NR records into feature pairs, keeping other shapes as hex", () => {
    const f = parsePlmnFeatures(readMdb(fx("plmn2features.mdb")));
    expect(f.map((x) => x.plmns.slice(0, 2))).toEqual([["440-51", "440-54"], ["440-20"], ["310-160", "310-200"]]);
    expect(f[0].tag).toBe(0x303);
    expect(f[0].features).toHaveLength(35);
    expect(f[0].features?.slice(0, 3)).toEqual([[1, 2], [2, 2], [4, 2]]);
    // KDDI and SoftBank differ only in ids 78, 47 and 64
    const diff = f[0].features!.filter(([id, v]) => f[1].features!.find((y) => y[0] === id)![1] !== v).map((x) => x[0]);
    expect(diff).toEqual([78, 47]);
    expect(f[2].plmns).toHaveLength(15);
    expect(f[2].features).toBeUndefined();
    expect(f[2].hex).toBe("170000000100000001");
  });

  it("reads the LTE database", () => {
    expect(parsePlmnFeatures(readMdb(fx("plmn2features_lte.mdb")))).toEqual([
      { plmns: ["460-FF"], tag: 0x37f, hex: "080000001000000001010101010000005a005a005a005a" },
    ]);
  });
});

describe("decodeModemEfs", () => {
  it("names the small EFS files", () => {
    expect(decodeModemEfs("/policyman/fullrat_timer", Uint8Array.from([0x2c, 1, 0, 0, 0x78, 0x5d, 2, 0]))?.value).toMatch(/^300 s .*155000/);
    expect(decodeModemEfs("/nv/item_files/modem/mmode/device_mode", Uint8Array.of(1))?.value).toMatch(/DSDS/);
    expect(decodeModemEfs("/nv/item_files/modem/mmode/device_mode", Uint8Array.of(0))?.value).toBe("single SIM");
    expect(decodeModemEfs("/protected/mcfg/active_int_carrier_info", new TextEncoder().encode("SW_DEF\0\0\0\0\0\0\0"))?.value).toBe("SW_DEF");
    expect(decodeModemEfs("/mcfg_ftb", new Uint8Array(8))).toMatchObject({ value: "clear", confidence: "low" });
    expect(decodeModemEfs("/policyman/fullrat_timer", new Uint8Array(4))).toBeUndefined();
    expect(decodeModemEfs("/other", new Uint8Array(1))).toBeUndefined();
  });
});

describe("parseSsgccs", () => {
  const c = parseSsgccs(text("ssgccs_config.txt"), text("ssgccs_int_config.txt"));

  it("names the thresholds", () => {
    expect(c.activePlmns).toEqual(["ALL"]);
    const custom = c.lines.find((l) => l.key === "CUSTOM")!;
    expect(custom.fields.map((f) => [f.name, f.value, f.confidence])).toEqual([
      ["Mode", "2", "med"], ["Countermeasure threshold", "500", "med"], ["Alert threshold", "200", "med"],
      ["Hostile threshold", "500", "med"], ["Filter", "0", "med"],
    ]);
  });

  it("reads the per-RAT line: enable, five numbers, an action word", () => {
    const g = c.lines.find((l) => l.key === "GERAN")!;
    expect(g).toMatchObject({ title: "GSM settings", confidence: "low", raw: "GERAN: 1, 500, 5, 10, 50, 80, DEFAULT" });
    expect(g.fields.map((f) => f.name)).toEqual(["Enabled", "Parameter 1", "Parameter 2", "Parameter 3", "Parameter 4", "Parameter 5", "Action"]);
    expect(g.fields.at(-1)).toEqual({ name: "Action", value: "DEFAULT", confidence: "low" });
    expect(SSGCCS_ACTIONS.DEFAULT).toBeTruthy();
  });

  it("keeps unknown keys and a PLMN list", () => {
    const x = parseSsgccs("ACTIVE_PLMN_LIST: 310-260, 311-490\r\nLTE_JAMMING: 1, 2\nnot a line\0\0");
    expect(x.activePlmns).toEqual(["310-260", "311-490"]);
    expect(x.lines.map((l) => [l.key, l.confidence, l.fields.map((f) => f.name)])).toEqual([
      ["ACTIVE_PLMN_LIST", "high", ["Networks"]], ["LTE_JAMMING", "unknown", ["Field 1", "Field 2"]],
    ]);
  });
});

describe("policy element notes", () => {
  it("every entry is short and well formed", () => {
    const kinds = new Set(["root", "block", "condition", "action", "value"]);
    for (const [name, d] of Object.entries(POLICY_ELEMENTS)) {
      expect(kinds.has(d.kind), name).toBe(true);
      expect(["high", "med", "low"]).toContain(d.confidence);
      expect(d.note.length, name).toBeLessThanOrEqual(110);
      expect(d.note, name).toMatch(/^[A-Za-z0-9].*\.$/);
      for (const n of Object.values(d.attrs ?? {})) expect(n, name).toMatch(/^[A-Za-z0-9].*\.$/);
    }
    expect(Object.keys(POLICY_ELEMENTS)).toHaveLength(134);
  });

  it("covers every element the package's policy XML uses", () => {
    const s = basebandSummary({ "bbcfg.mbn": fx("bbcfg_trimmed.mbn"), "qdsp6sw.mbn": fx("qdsp6sw_57236896.bin") });
    const xml = s.files.filter((f) => f.path.startsWith("/policyman/") && f.text && !f.path.endsWith("band_combos_per_plmn.xml"));
    expect(xml.length).toBeGreaterThan(10);
    const tags = new Set(xml.flatMap((f) => [...walkPolicy(parsePolicyXml(f.text!))].filter((n) => n.kind !== "comment").map((n) => n.tag)));
    expect(tags.size).toBeGreaterThan(40);
    expect([...tags].filter((t) => !describePolicyElement(t))).toEqual([]);
  });

  it("does not answer for prototype keys or unknown names", () => {
    expect(describePolicyElement("toString")).toBeUndefined();
    expect(describePolicyElement("carrier_name")).toBeUndefined();
  });

  it("falls back to the common attribute notes", () => {
    expect(describePolicyAttr("rf_bands", "subs")).toMatch(/dds/);
    expect(describePolicyAttr("device_configuration", "num_sims")).toBe("SIM slots.");
    expect(describePolicyAttr("policy", "constructor")).toBeUndefined();
  });
});
