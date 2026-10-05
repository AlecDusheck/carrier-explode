import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { keyScan, type ScanTarget, type TargetRow } from "../src/lib/server/keyscan.ts";
import { packShards, topKey, type ScanEntry, type ScanRow, type ScanShard } from "@carrier-explode/storage";
import { flatten, flattenBundle, openIpcc } from "@carrier-explode/decode-ios";
import { lookup, lookupAll, pathPattern } from "@carrier-explode/values";

const here = dirname(fileURLToPath(import.meta.url));
/** decode-ios owns the .ipcc fixtures. */
const fixture = (n: string) => new Uint8Array(readFileSync(join(here, "../../../packages/decode-ios/test/fixtures", n)));
const td = new TextDecoder();

/** What the worker does: slice the shard out of the packed data by its [offset, length]. */
function readShard(data: Uint8Array, loc: readonly [number, number] | undefined): ScanShard {
  if (!loc) throw new Error("no such shard");
  return JSON.parse(td.decode(data.subarray(loc[0], loc[0] + loc[1])));
}

const target = (name: string): ScanTarget => ({ source: `ios:carrier:${name}`, name, cc: null, version: "1" });
const read = (row: ScanRow | undefined): TargetRow => ({ kind: "read", row: row ?? {} });

describe("flatten", () => {
  it("emits leaf paths in the viewer's a.b[0].c form", () => {
    expect(flatten({ a: { b: [{ c: 1 }, { c: 2 }] }, d: "x", e: [], f: {} })).toEqual({
      "a.b[0].c": 1, "a.b[1].c": 2, d: "x", e: [], f: {},
    });
  });

  it("keeps tagged data and dates as leaves", () => {
    expect(flatten({ d: { __data: "00", __len: 1 } })).toEqual({ d: { __data: "00", __len: 1 } });
  });

  it("rebuilds containers from their leaves", () => {
    const flat = flatten({ MMS: { MaxSize: 3, URL: "u" }, apns: [{ apn: "a" }] });
    expect(lookup(flat, "MMS")).toEqual({ MaxSize: 3, URL: "u" });
    expect(lookup(flat, "apns")).toEqual([{ apn: "a" }]);
    expect(lookup(flat, "apns[0]")).toEqual({ apn: "a" });
    expect(lookup(flat, "nope")).toBeUndefined();
  });

  it("matches [*] and * wildcards", () => {
    const flat = flatten({ apns: [{ t: 1 }, { t: 2 }], x: { a: { v: 1 }, b: { v: 2 } } });
    expect(lookupAll(flat, "apns[*].t").map((m) => m.value)).toEqual([1, 2]);
    expect(lookupAll(flat, "x.*.v").map((m) => m.path)).toEqual(["x.a.v", "x.b.v"]);
    expect(pathPattern("a.b")).toBeNull();
  });

  it("flattens every decodable member of a real bundle", () => {
    const flat = flattenBundle(openIpcc(fixture("carrier-att.ipcc")));
    expect(Object.keys(flat)).toContain("carrier.plist");
    expect(Object.keys(flat["carrier.plist"] ?? {}).some((k) => /^apns\[\d+\]\./.test(k))).toBe(true);
  });
});

describe("packShards + keyScan", () => {
  const entry = (name: string, files: ScanEntry["files"]): ScanEntry => ({ source: `ios:carrier:${name}`, group: "ios:carrier", main: "carrier.plist", files });
  const packed = packShards([
    entry("a", { "carrier.plist": { "apns[0].type-mask": 1, "apns[1].type-mask": 131072, "MMS.MaxSize": 1 } }),
    entry("b", { "carrier.plist": { "apns[0].type-mask": 1 } }),
    entry("c", { "carrier.plist": { "MMS.MaxSize": 2 } }),
    entry("d", { "Info.plist": { CFBundleVersion: "1" } }),
  ]);
  const plist = packed.get("carrier.plist");

  it("packs one index + data pair per file, one shard per top-level key", () => {
    expect(plist?.index.srcs).toEqual(["ios:carrier:a", "ios:carrier:b", "ios:carrier:c"]);
    expect(Object.keys(plist?.index.shards ?? {}).sort()).toEqual(["MMS", "apns"]);
    expect(plist && readShard(plist.data, plist.index.shards.apns).at).toEqual([0, 1]);
    expect(packed.get("Info.plist")?.index.srcs).toEqual(["ios:carrier:d"]);
  });

  it("answers a wildcard query, telling absent from missing from unindexed", () => {
    if (!plist) throw new Error("carrier.plist not packed");
    const shard = readShard(plist.data, plist.index.shards[topKey("apns[*].type-mask")]);
    const rows: TargetRow[] = [read(shard.rows[0]), read(shard.rows[1]), read({}), { kind: "missing" }, { kind: "unindexed" }];
    const r = keyScan(["a", "b", "c", "d", "e"].map(target), rows, "carrier.plist", "apns[*].type-mask", "carriers");
    expect(r.scanned).toBe(3);
    expect(r.set).toBe(2);
    expect(r.unindexed).toBe(1);
    expect(r.buckets.map((b) => [b.present ? b.value : "absent", b.count])).toEqual([[1, 2], [131072, 1], ["absent", 1]]);
    expect(r.hits.map((h) => h.name)).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.hits.map((h) => h.state)).toEqual(["read", "read", "read", "missing", "unindexed"]);
    const a = r.hits.find((h) => h.name === "a");
    expect(a?.state === "read" ? a.matches.map((m) => m.path) : []).toEqual(["apns[0].type-mask", "apns[1].type-mask"]);
  });

  it("counts a source once per distinct value", () => {
    const r = keyScan([target("a")], [read({ "apns[0].t": 1, "apns[1].t": 1 })], "carrier.plist", "apns[*].t", "carriers");
    expect(r.buckets).toEqual([{ value: 1, present: true, count: 1, sources: ["ios:carrier:a"] }]);
  });
});

// A generation built by the extractor's `scan` job (CORPUS=<dir>, see packages/decode-ios/test/README.md); skipped when unset.
const LOCAL = process.env.CORPUS ? join(process.env.CORPUS, "scan") : "";
describe.skipIf(!LOCAL || !existsSync(LOCAL))("real index", () => {
  it("scans every carrier for a wildcard path fast", () => {
    const index = JSON.parse(readFileSync(join(LOCAL, "carrier.plist.idx.json"), "utf8"));
    const data = new Uint8Array(readFileSync(join(LOCAL, "carrier.plist.dat")));
    const t0 = performance.now();
    const shard = readShard(data, index.shards.apns);
    const rows: TargetRow[] = index.srcs.map(() => read({}));
    shard.at.forEach((at: number, k: number) => (rows[at] = read(shard.rows[k])));
    const r = keyScan(index.srcs.map((s: string) => target(s)), rows, "carrier.plist", "apns[*].type-mask", "all");
    const ms = performance.now() - t0;
    expect(r.scanned).toBe(index.srcs.length);
    expect(r.scanned).toBeGreaterThan(800);
    expect(r.set).toBeGreaterThan(500);
    expect(ms).toBeLessThan(500);
  });
});
