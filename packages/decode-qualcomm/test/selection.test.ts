/**
 * Tests for `src/selection.ts` (mcfg_sel_db.xml and pairing SW configs with it).
 * Fixtures in test/fixtures/pixel5a/ are cut from a Pixel 5a (see test/README.md);
 * the corpus block runs on a whole vendor `mbn` directory.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import { mcfgItemData, parseMcfg, type McfgImage } from "../src/mcfg.ts";
import { pairSelection, parseSelectionDb, ruleValues, SELECTION_DB_PATH, type SelectionDb } from "../src/selection.ts";
import { defined } from "./defined.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => new Uint8Array(readFileSync(join(here, "fixtures", "pixel5a", name)));
const db = parseSelectionDb(new TextDecoder().decode(fx("mcfg_sel_db-cut.xml")));
const dcm = defined(parseMcfg(fx("dcm-cut.mbn")));

describe("parseSelectionDb", () => {
  it("reads each rule's carrier, index and options", () => {
    expect(db.records.map((r) => [r.carrierName, r.carrierIndex])).toEqual([
      ["DCM", 13], ["KDDI", 7], ["Reliance", 27], ["Chatr", 200], ["USCC-Fi", 251], ["ROW", 8],
    ]);
    // iin="iin" and the like name rule variables, not settings.
    expect(db.records[0]?.options).toEqual({ country_code: "356", volte: "true", vowifi: "false" });
    expect(db.records[5]?.options).toEqual({});
  });

  it("reads the SIM tests as a rule tree", () => {
    expect(db.records[0]?.rule).toEqual({
      kind: "any",
      rules: [
        { kind: "match", matcher: "iin_in", variable: "iin", values: ["8981100"] },
        { kind: "match", matcher: "imsi_3gpp_plmn_in", variable: "3gpp_imsi", values: ["440-10"] },
      ],
    });
    expect(db.records[3]?.rule).toEqual({
      kind: "all",
      rules: [
        { kind: "match", matcher: "imsi_3gpp_plmn_in", variable: "3gpp_imsi", values: ["302-720"] },
        {
          kind: "any",
          rules: [
            { kind: "match", matcher: "gid_in", variable: "gid1", values: ["D2"] },
            { kind: "match", matcher: "customid_in", variable: "customid", values: ["20"] },
          ],
        },
      ],
    });
    expect(ruleValues(defined(db.records[2]).rule, "impi_in")).toHaveLength(22);
    expect(ruleValues(defined(db.records[4]).rule, "customid_in")).toEqual(["11"]);
    expect(db.records[5]?.rule).toEqual({ kind: "always" });
  });

  it("refuses what it does not read", () => {
    const one = (test: string) => `<policy mcfg_db_ver="1"><if>${test}<then><SelRecord carrier_name="X" mcfg_carrier_index="1"/></then></if></policy>`;
    expect(() => parseSelectionDb(one('<spn_in not_present="false" store_in="spn">X</spn_in>'))).toThrow(/unknown test <spn_in>/);
    expect(() => parseSelectionDb(one('<iin_in not_present="true" store_in="iin">1</iin_in>'))).toThrow(/not_present/);
    expect(parseSelectionDb(one('<imsi_3gpp2_plmn_in not_present="false" store_in="3gpp2_imsi">310-12</imsi_3gpp2_plmn_in>')).records[0]?.rule)
      .toEqual({ kind: "match", matcher: "imsi_3gpp2_plmn_in", variable: "3gpp2_imsi", values: ["310-12"] });
    expect(() => parseSelectionDb(one('<tristate_reset_all return="false" />'))).toThrow(/unknown test/);
    expect(() => parseSelectionDb('<policy mcfg_db_ver="1"><if><then/></if></policy>')).toThrow(/without a SelRecord/);
  });
});

describe("pairSelection", () => {
  const config = (image: McfgImage, name: string) => ({ name, image });

  it("pairs a config with the records that select its carrier index", () => {
    const p = pairSelection([config(dcm, "DCM")], db);
    expect(p.paired.map((x) => [x.config.name, x.records.map((r) => r.carrierName)])).toEqual([["DCM", ["DCM"]]]);
  });

  it("splits a shared carrier index by the trailer's IINs and PLMNs", () => {
    const shared: SelectionDb = { records: [...db.records, { ...defined(db.records[1]), carrierIndex: 13 }] };
    const other = { ...dcm, trailer: { fields: [] } };
    const p = pairSelection([config(dcm, "DCM"), config(other, "no lists")], shared);
    expect(p.paired.map((x) => [x.config.name, x.records.map((r) => r.carrierName)])).toEqual([["DCM", ["DCM"]]]);
  });

  it("leaves out a config no record selects", () => {
    expect(pairSelection([config({ ...dcm, muxdCarrierIndex: 99 }, "orphan")], db).paired).toEqual([]);
  });
});

// CORPUS=<dir>, see test/README.md; skipped when unset.
const MBN = process.env.CORPUS ? join(process.env.CORPUS, "android", "mbn") : "";

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".mbn") ? [join(dir, e.name)] : []));

describe.skipIf(!existsSync(MBN))("Pixel 5a vendor mbn directory", () => {
  it("parses every MBN and pairs each SW config with a selection record, or reports it", () => {
    const mbns = walk(MBN).sort().map((path) => {
      const bytes = new Uint8Array(readFileSync(path));
      return { path: relative(MBN, path), bytes, image: defined(parseMcfg(bytes)) };
    });
    for (const m of mbns) expect(m.image.trailer, m.path).toBeDefined();
    const sw = mbns.filter((m) => m.image.cfgTypeName === "SW");
    const hw = mbns.filter((m) => m.image.cfgTypeName === "HW");
    expect([mbns.length, sw.length, hw.length]).toEqual([121, 117, 4]);

    const dbs = hw.flatMap((m) => {
      const item = m.image.items.find((it) => it.kind === "file" && it.path === SELECTION_DB_PATH);
      return item ? [parseSelectionDb(new TextDecoder().decode(mcfgItemData(m.bytes, item)))] : [];
    });
    expect(dbs).toHaveLength(2); // the DSDS and SS configs; their CDMA-less variants carry none
    expect(dbs[1]).toEqual(dbs[0]);
    const sel = defined(dbs[0]);
    expect(sel.records).toHaveLength(125);

    const p = pairSelection(sw, sel);
    const unpaired = sw.filter((m) => !p.paired.some((x) => x.config === m));
    const unused = sel.records.filter((r) => !sw.some((m) => m.image.muxdCarrierIndex === r.carrierIndex));
    expect([p.paired.length, unpaired.length, unused.length]).toEqual([115, 2, 4]);
    expect(unpaired.map((m) => `${m.path} ${m.image.muxdCarrierIndex}`)).toEqual([
      "mcfg_sw/generic/Pixel/common/WildCard_IMS/pixel_WildCard_IMS/mcfg_sw.mbn 246",
      "mcfg_sw/generic/common/Default/Default/mcfg_sw.mbn 0",
    ]);
    expect(unused.map((r) => `${r.carrierName} ${r.carrierIndex}`)).toEqual(["Elisa 82", "Telefonica 44", "CBRS 86", "APT 66"]);
  });
});
