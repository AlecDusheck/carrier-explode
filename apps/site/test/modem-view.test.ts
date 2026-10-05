import { describe, expect, it } from "vitest";
import type { ModemItem } from "@carrier-explode/schema/types";
import { combinationRows, comboType, qualcommRows } from "../src/lib/combos.ts";
import { itemMatches, itemNote, itemSection, modemSections, valueText } from "../src/lib/modem.ts";
import { simRule } from "../src/lib/settings.ts";

describe("combo rows", () => {
  it("read Qualcomm's strings as before: bands by RAT, NR-DC and SWUL as tags", () => {
    const [r] = qualcommRows(["b66AA-b2A-n77AA-dc-swul"]);
    expect(r).toEqual({
      text: "b66AA-b2A-n77AA-dc-swul",
      lte: [{ band: 66, text: "B66A↑A" }, { band: 2, text: "B2A" }],
      nr: [{ band: 77, text: "n77A↑A" }],
      tags: ["NR-DC", "SWUL"],
    });
    expect(r && comboType(r)).toBe("endc");
  });

  it("write the neutral model's components in the same notation, with what the family states besides", () => {
    const [lte, nr] = combinationRows([
      [{ band: "B1", dl: "A", dlLayers: 4 }, { band: "B3", dl: "C", ul: "A" }],
      [{ band: "n41", dl: "C", ul: "A", dlLayers: 4, bandwidthMhz: 180, scsKhz: 30 }],
    ]);
    expect(lte).toEqual({ text: "B1A[4]-B3C↑A", lte: [{ band: 1, text: "B1A[4]" }, { band: 3, text: "B3C↑A" }], nr: [], tags: [] });
    expect(nr?.nr).toEqual([{ band: 41, text: "n41C[4]↑A 180MHz 30kHz" }]);
    expect([lte && comboType(lte), nr && comboType(nr)]).toEqual(["lte", "nr"]);
  });

  it("refuse a band outside the contract's notation", () => {
    expect(() => combinationRows([[{ band: "66", dl: "A" }]])).toThrow("not a band: 66");
  });
});

describe("simRule", () => {
  it("says any SIM for a bare PLMN, and every qualifier otherwise", () => {
    expect(simRule({ mccmnc: "310260" })).toEqual({ via: "MCC-MNC", key: "310260", match: "any SIM" });
    expect(simRule({ mccmnc: "310260", gid1: "6D", spn: "Mint", imsiPrefix: "31026097", iccidPrefix: "8901260" })).toEqual({
      via: "MCC-MNC", key: "310260", match: 'GID1 6D, SPN "Mint", IMSI 31026097…, ICCID 8901260…',
    });
  });
});

describe("itemMatches", () => {
  const item: ModemItem = {
    id: "efs:/nv/item_files/ims/IMS_enable", name: "IMS enable", description: "Enables the IMS task",
    value: { kind: "fields", fields: { mode: { kind: "number", value: 2 } } }, label: "Enabled", certainty: "high",
  };

  it("finds an item by id, name, description, label or written value, ignoring case and an empty filter", () => {
    expect(["", "  ", "IMS_ENABLE", "ims enable", "ims task", "enabled", "mode=2"].map((q) => itemMatches(item, q))).toEqual(Array(7).fill(true));
    expect(itemMatches(item, "volte")).toBe(false);
    expect(itemMatches({ ...item, name: null, description: null }, "ims enable")).toBe(false);
  });
});

describe("valueText", () => {
  it("writes every kind of value on one line", () => {
    expect(valueText({ kind: "list", values: [
      { kind: "number", value: 1 }, { kind: "text", value: "a" }, { kind: "bytes", hex: "0a0b" }, { kind: "xml", value: "<x/>" }, { kind: "flags", values: [0, 1] },
    ] })).toBe("1, a, 0a0b, <x/>, 0 1");
  });
});

describe("modem sections", () => {
  const item = (id: string, name: string | null, description: string | null = null): ModemItem =>
    ({ id, name, description, value: { kind: "number", value: 0 }, label: null, certainty: "opaque" });

  it("take an EFS file's directory, a LID's owner, a Shannon name's first word, else the id's scheme", () => {
    expect([
      item("efs:/nv/item_files/ims/qp_ims_sms_config", null),
      item("efs:/policyman", null),
      item("lid:0x3c0/5642", null, "SBP · 1-bit field"),
      item("lid:0x3c0/5643", null),
      item("crc:443f1489", "!NRPM.MTU_DEFAULT_SIZE"),
      item("crc:81f0b8d8", "UECAPA_REL15_FSULPCC_2_256Q"),
      item("crc:4da917b7", null),
      item("nv:1206/2@3", "PPP profile"),
      item("pri:nv-list", "Legacy NV item list"),
    ].map(itemSection)).toEqual(["efs:/nv/item_files/ims", "efs:/", "SBP", "lid", "NRPM", "UECAPA", "crc", "nv", "pri"]);
  });

  it("drop the section a description leads with", () => {
    expect(itemNote(item("lid:0x3c0/1", null, "SBP · 1-bit field"), "SBP")).toBe("1-bit field");
    expect(itemNote(item("nv:10", null, "SBP · 1-bit field"), "nv")).toBe("SBP · 1-bit field");
  });

  it("list sections by title, items in their order", () => {
    const [a, b, c] = [item("nv:2", null), item("efs:/x/a", null), item("nv:1", null)];
    expect(modemSections([a, b, c])).toEqual([["efs:/x", [b]], ["nv", [a, c]]]);
  });
});
