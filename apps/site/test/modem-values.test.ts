import { describe, expect, it } from "vitest";
import type { ModemItem, ModemValue } from "@carrier-explode/schema/types";
import {
  baseId, countedList, hardwareGrid, mcfTable, pathText, plmnCategory, pppProfile, sidNids, smsRoutes, unpackPlmn,
} from "../src/lib/components/values/modem/model.ts";
import { modemView } from "../src/lib/components/values/registry.ts";

const n = (value: number): ModemValue => ({ kind: "number", value });
const t = (value: string): ModemValue => ({ kind: "text", value });
const list = (...xs: number[]): ModemValue => ({ kind: "list", values: xs.map(n) });
const fields = (f: Record<string, ModemValue>): ModemValue => ({ kind: "fields", fields: f });
const item = (id: string, value: ModemValue, name: string | null = null): ModemItem => ({ id, name, description: null, value, label: null, certainty: "medium" });

describe("baseId", () => {
  it("drops an item's index and subscription mask, and keeps an EFS path whole", () => {
    expect(["nv:1206/2", "nv:257@0", "nv:1206/3@4", "nv:1206", "efs:/nv/item_files/modem/mmode/sd/sdssscr_timers"].map(baseId))
      .toEqual(["nv:1206", "nv:257", "nv:1206", "nv:1206", "efs:/nv/item_files/modem/mmode/sd/sdssscr_timers"]);
  });
});

describe("sidNids", () => {
  it("lists the set pairs, NID 65535 as any (Commercial-Sprint NV 259)", () => {
    expect(sidNids(fields({ Sid1: n(4162), Nid1: n(65535), Sid2: n(0), Nid2: n(0), Sid3: n(7), Nid3: n(2) }))).toEqual([
      { sid: 4162, nid: "any" }, { sid: 7, nid: 2 },
    ]);
    expect(sidNids(fields({ Sid1: n(0), Nid1: n(0) }))).toEqual([]);
  });
});

describe("pppProfile", () => {
  it("puts each protocol's fields in one row and authentication apart (Commercial-Sprint NV 1206)", () => {
    const p = pppProfile(fields({
      LcpTermTimeout: n(1000), LcpAckTimeout: n(1000), LcpReqTry: n(12), LcpNakTry: n(3), LcpTermTry: n(1), AuthRetry: n(3), AuthTimeout: n(3000),
      IpcpTermTimeout: n(1000), IpcpAckTimeout: n(1000), IpcpReqTry: n(10), IpcpNakTry: n(3), IpcpTermTry: n(1), IpcpCompressionEnable: n(2),
    }));
    expect(p?.rows.map((r) => [r.protocol, r.cells])).toEqual([
      ["LCP", [1000, 1000, 12, 3, 1, undefined]],
      ["IPCP", [1000, 1000, 10, 3, 1, 2]],
      ["IPv6CP", [undefined, undefined, undefined, undefined, undefined, undefined]],
    ]);
    expect([p?.authRetry, p?.authTimeout]).toEqual([3, 3000]);
  });
});

describe("countedList", () => {
  it("cuts a list to its count field (Commercial-Sprint NV 7162: 3 of 62)", () => {
    const c = countedList(item("nv:7162", fields({ AllowNumSrvOpt: n(3), AllowSrvOptList: list(3, 68, 73, 0, 0) })));
    expect([c?.list, c?.values, c?.overrun, c?.rest]).toEqual(["AllowSrvOptList", [3, 68, 73], undefined, []]);
  });

  it("keeps the other fields, and flags a count past the list", () => {
    const c = countedList(item("efs:/nv/item_files/modem/mmode/sd/sdssscr_timers", fields({ Version: n(1), Count: n(4), Value: list(15, 1, 300) })));
    expect([c?.values, c?.overrun, c?.rest]).toEqual([[15, 1, 300], 4, [["Version", n(1)]]]);
  });
});

describe("smsRoutes", () => {
  it("reads six rows of four and the flag, and nothing short of that", () => {
    const f: Record<string, ModemValue> = { TransferStatusReport: n(1) };
    for (let i = 1; i <= 6; i++) Object.assign(f, { [`PPRoutes${i}`]: n(i), [`PPMemStores${i}`]: n(0), [`BCRoutes${i}`]: n(2), [`BCMemStores${i}`]: n(0) });
    expect(smsRoutes(fields(f))).toEqual({ rows: [1, 2, 3, 4, 5, 6].map((i) => [i, 0, 2, 0]), transferStatusReport: 1 });
    expect(smsRoutes(fields({ TransferStatusReport: n(1) }))).toBeUndefined();
  });
});

describe("unpackPlmn", () => {
  it("reads BCD PLMNs from es_yoigo's category 1 (VZW) and drops a filler third MNC digit", () => {
    expect([0x134000, 0x132010, 0x05f2ff].map(unpackPlmn)).toEqual([
      { kind: "plmn", mcc: "310", mnc: "004" }, { kind: "plmn", mcc: "310", mnc: "012" }, { kind: "plmn", mcc: "502", mnc: "FF" },
    ]);
    expect(unpackPlmn(0x99f999)).toEqual({ kind: "placeholder" });
  });
});

describe("plmnCategory", () => {
  const ids = item("crc:48c51569", list(0x134000, 0x99f999), "NRCAPA_CA_NV_PLMN_IDS_FOR_PLMN_CATEGORY_ID_1");

  it("names a category from its sibling, as text or as the NUL-terminated characters of an untyped list", () => {
    const named = (value: ModemValue) => plmnCategory(ids, [ids, item("crc:2d6b6556", value, "NRCAPA_CA_NV_PLMN_NAME_FOR_PLMN_CATEGORY_ID_1")]);
    expect(named(list(86, 90, 87, 0))).toEqual({ category: "1", name: "VZW", plmns: [{ kind: "plmn", mcc: "310", mnc: "004" }, { kind: "placeholder" }] });
    expect(named(t("VZW"))?.name).toBe("VZW");
    expect(plmnCategory({ ...ids, value: n(0x134000) }, [])?.plmns).toEqual([{ kind: "plmn", mcc: "310", mnc: "004" }]);
  });
});

describe("hardwareGrid", () => {
  it("rows by scope, columns by hardware, a scope set for all hardware in one cell (UECAPA_REL12_CATEGORY_DL)", () => {
    const g = hardwareGrid(fields({ common: n(1), "multislot · hw 5=21/4": n(18), "multislot · hw 5=25/4": n(19) }));
    expect(g?.conditions).toEqual(["hw 5=21/4", "hw 5=25/4"]);
    expect(g?.rows).toEqual([
      { scope: "common", cells: { kind: "all", value: n(1) } },
      { scope: "multislot", cells: { kind: "each", values: new Map([["hw 5=21/4", n(18)], ["hw 5=25/4", n(19)]]) } },
    ]);
    expect(hardwareGrid(fields({ common: n(1), sim1: n(2) }))).toBeUndefined();
  });
});

describe("mcfTable", () => {
  it("lays an array out by index, alone or a column per condition (lid:0x88f/8404)", () => {
    expect(mcfTable(fields({ "0$0$": t("wapuser"), "1$0$": t("net") }))).toEqual({
      conditions: [], rows: [{ path: "0$0$", cells: [t("wapuser")] }, { path: "1$0$", cells: [t("net")] }],
    });
    const byPlmn = mcfTable(fields({ "334-03": fields({ "0$0$": t("movistar") }), "724-06": fields({ "0$0$": t("vivo"), "10$0$": t("x"), "2$0$": t("y") }) }));
    expect(byPlmn?.conditions).toEqual(["334-03", "724-06"]);
    expect(byPlmn?.rows.map((r) => [pathText(r.path), r.cells])).toEqual([
      ["[0][0]", [t("movistar"), t("vivo")]], ["[2][0]", [undefined, t("y")]], ["[10][0]", [undefined, t("x")]],
    ]);
  });

  it("leaves a single entry and non-array fields to the plain value", () => {
    expect(mcfTable(fields({ "0$": n(3) }))).toBeUndefined();
    expect(mcfTable(fields({ Sid1: n(1), Nid1: n(2) }))).toBeUndefined();
  });
});

describe("modemView", () => {
  it("finds views by base id, then by name and shape, and none for a plain value", async () => {
    const viewName = async (x: ModemItem) => (await modemView(x, []))?.View.name;
    expect(await viewName(item("nv:1206/2@3", fields({})))).toMatch(/PppProfile/);
    expect(await viewName(item("crc:48c51569", list(1), "NRCAPA_CA_NV_PLMN_IDS_FOR_PLMN_CATEGORY_ID_1"))).toMatch(/PlmnCategory/);
    expect(await viewName(item("crc:14d3ea85", fields({ "multislot · hw 5=21/4": n(18) })))).toMatch(/HardwareGrid/);
    expect(await viewName(item("lid:0x88f/8404", fields({ "0$0$": t("a"), "1$0$": t("b") })))).toMatch(/McfTable/);
    expect(modemView(item("nv:71527", n(1)), [])).toBeNull();
  });
});
