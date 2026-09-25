import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { packShards, keyScan, topKey, type ScanShard, type ScanTarget, type TargetRow } from "../src/lib/server/keyscan.ts";
import { flatten, flattenBundle, lookup, lookupAll, pathPattern, type Flat } from "../src/lib/decode/flatten.ts";
import { openIpcc } from "../src/lib/decode/bundle.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", n)));
const td = new TextDecoder();

/** What the worker does: slice the shard out of the packed data by its [offset, length]. */
function readShard(data: Uint8Array, loc: [number, number]): ScanShard {
  return JSON.parse(td.decode(data.subarray(loc[0], loc[0] + loc[1])));
}

const target = (name: string): ScanTarget => ({ name, display: name, os: "27.0", build: "1", src: `blob:${name}` });

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
    const flat = flattenBundle(openIpcc(fixture("ATT_US.ipcc")));
    expect(Object.keys(flat)).toContain("carrier.plist");
    expect(Object.keys(flat["carrier.plist"]).some((k) => /^apns\[\d+\]\./.test(k))).toBe(true);
  });
});

describe("packShards + keyScan", () => {
  const bundles: Array<{ src: string; flat: Record<string, Flat> }> = [
    { src: "blob:a", flat: { "carrier.plist": flatten({ apns: [{ "type-mask": 1 }, { "type-mask": 131072 }], MMS: { MaxSize: 1 } }) } },
    { src: "blob:b", flat: { "carrier.plist": flatten({ apns: [{ "type-mask": 1 }] }) } },
    { src: "blob:c", flat: { "carrier.plist": flatten({ MMS: { MaxSize: 2 } }) } },
    { src: "blob:d", flat: { "Info.plist": flatten({ CFBundleVersion: "1" }) } },
  ];
  const packed = packShards(bundles);

  it("packs one index + data pair per file, one shard per top-level key", () => {
    const cp = packed.get("carrier.plist")!;
    expect(cp.index.srcs).toEqual(["blob:a", "blob:b", "blob:c"]);
    expect(Object.keys(cp.index.shards).sort()).toEqual(["MMS", "apns"]);
    const apns = readShard(cp.data, cp.index.shards.apns);
    expect(apns.at).toEqual([0, 1]);
    expect(packed.get("Info.plist")!.index.srcs).toEqual(["blob:d"]);
  });

  it("answers a wildcard query, telling absent from missing from unindexed", () => {
    const cp = packed.get("carrier.plist")!;
    const shard = readShard(cp.data, cp.index.shards[topKey("apns[*].type-mask")]);
    const targets = ["a", "b", "c", "d", "e"].map(target);
    const rows: TargetRow[] = [shard.rows[0], shard.rows[1], {}, null, undefined];
    const r = keyScan(targets, rows, "carrier.plist", "apns[*].type-mask", "all");
    expect(r.scanned).toBe(3);
    expect(r.set).toBe(2);
    expect(r.unindexed).toBe(1);
    expect(r.buckets.map((b) => [b.present ? b.value : "absent", b.count])).toEqual([[1, 2], [131072, 1], ["absent", 1]]);
    expect(r.hits.map((h) => h.name)).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.hits.find((h) => h.name === "a")!.matches.map((m) => m.path)).toEqual(["apns[0].type-mask", "apns[1].type-mask"]);
  });

  it("counts a bundle once per distinct value", () => {
    const rows: TargetRow[] = [flatten({ apns: [{ t: 1 }, { t: 1 }] })];
    const r = keyScan([target("a")], rows, "carrier.plist", "apns[*].t", "all");
    expect(r.buckets).toEqual([{ value: 1, present: true, count: 1, carriers: ["a"] }]);
  });
});

// A generation built by `scan_index.ts build` (CORPUS=<dir>, see test/README.md); skipped when unset.
const LOCAL = process.env.CORPUS ? join(process.env.CORPUS, "scan") : "";
describe.skipIf(!LOCAL || !existsSync(LOCAL))("real index", () => {
  it("scans every carrier for a wildcard path fast", () => {
    const index = JSON.parse(readFileSync(join(LOCAL, "carrier.plist.idx.json"), "utf8"));
    const data = new Uint8Array(readFileSync(join(LOCAL, "carrier.plist.dat")));
    const t0 = performance.now();
    const shard = readShard(data, index.shards.apns);
    const rows: TargetRow[] = index.srcs.map(() => ({}));
    shard.at.forEach((at, k) => (rows[at] = shard.rows[k]));
    const r = keyScan(index.srcs.map((s: string) => target(s)), rows, "carrier.plist", "apns[*].type-mask", "all");
    const ms = performance.now() - t0;
    expect(r.scanned).toBe(index.srcs.length);
    expect(r.scanned).toBeGreaterThan(800);
    expect(r.set).toBeGreaterThan(500);
    expect(ms).toBeLessThan(500);
  });
});
