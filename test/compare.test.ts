import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { diffValues, summariseDiff, compareBundles, comparable } from "../src/lib/decode/compare.ts";
import { openIpcc, decodeFile } from "../src/lib/decode/bundle.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", n)));

describe("diffValues", () => {
  it("walks nested dicts and reports each leaf", () => {
    const rows = diffValues({ a: 1, b: { c: 2 }, d: [1, 2] }, { a: 1, b: { c: 3 }, e: 5, d: [1, 3] });
    expect(rows).toEqual([
      { path: "b.c", kind: "changed", a: 2, b: 3 },
      { path: "d[1]", kind: "changed", a: 2, b: 3 },
      { path: "e", kind: "added", b: 5 },
    ]);
  });

  it("aligns arrays so an insertion is one added row, not a cascade", () => {
    const A = [{ apn: "a", t: 1 }, { apn: "b", t: 2 }, { apn: "c", t: 3 }];
    const B = [{ apn: "a", t: 1 }, { apn: "new", t: 9 }, { apn: "b", t: 2 }, { apn: "c", t: 4 }];
    expect(diffValues(A, B)).toEqual([
      { path: "[1]", kind: "added", b: { apn: "new", t: 9 } },
      { path: "[3].t", kind: "changed", a: 3, b: 4 },
    ]);
  });

  it("reports a removal at the old index", () => {
    expect(diffValues(["x", "y", "z"], ["x", "z"])).toEqual([{ path: "[1]", kind: "removed", a: "y" }]);
  });

  it("pairs unmatched entries between anchors and diffs them in place", () => {
    expect(diffValues([{ k: 1 }, "s"], [{ k: 2 }, "s"])).toEqual([{ path: "[0].k", kind: "changed", a: 1, b: 2 }]);
  });

  it("treats key order as irrelevant", () => {
    expect(diffValues({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });

  it("emits same rows only on request", () => {
    const rows = diffValues({ a: 1, b: 2 }, { a: 1, b: 3 }, true);
    expect(summariseDiff(rows)).toEqual({ added: 0, removed: 0, changed: 1, same: 1 });
  });

  it("falls back to index alignment past the LCS budget", () => {
    const big = Array.from({ length: 2100 }, (_, i) => i);
    const rows = diffValues(big, [...big.slice(0, 2000), -1, ...big.slice(2001)]);
    expect(rows).toEqual([{ path: "[2000]", kind: "changed", a: 2000, b: -1 }]);
  });
});

describe("compareBundles", () => {
  const att = openIpcc(fixture("ATT_US.ipcc"));
  const vzw = openIpcc(fixture("Verizon_LTE_US.ipcc"));

  it("finds nothing between a bundle and itself", () => {
    const d = compareBundles(att, att);
    expect(d.files).toEqual([]);
    expect(d.counts.same).toBe(att.info.files.length);
    expect(d.counts.changed + d.counts.added + d.counts.removed).toBe(0);
  });

  it("classifies files as added, removed and changed", () => {
    const d = compareBundles(att, vzw);
    const pa = new Set(att.info.files.map((f) => f.path));
    const pb = new Set(vzw.info.files.map((f) => f.path));
    for (const f of d.files) {
      if (f.kind === "added") expect(pa.has(f.path)).toBe(false);
      if (f.kind === "removed") expect(pb.has(f.path)).toBe(false);
      if (f.kind === "changed") expect(pa.has(f.path) && pb.has(f.path)).toBe(true);
    }
    const plist = d.files.find((f) => f.path === "carrier.plist")!;
    expect(plist.kind).toBe("changed");
    expect(plist.rows.length).toBeGreaterThan(0);
    expect(plist.counts.changed + plist.counts.added + plist.counts.removed).toBeGreaterThanOrEqual(plist.rows.length);
    expect(d.shared).toContain("carrier.plist");
  });

  it("narrows to one member and caps rows", () => {
    const d = compareBundles(att, vzw, { path: "carrier.plist", maxRows: 3 });
    expect(d.files.map((f) => f.path)).toEqual(["carrier.plist"]);
    expect(d.files[0].rows).toHaveLength(3);
    expect(d.files[0].truncated).toBe(true);
  });

  it("keeps identical files when asked", () => {
    const d = compareBundles(att, att, { includeSame: true });
    expect(d.files).toHaveLength(att.info.files.length);
    expect(d.files.every((f) => f.kind === "same" && f.rows.length === 0)).toBe(true);
  });

  it("diffs a PRI by setting, not by position", () => {
    const pri = att.info.files.find((f) => f.kind === "pri-der");
    if (!pri) return;
    const c = comparable(decodeFile(att, pri.path)) as Record<string, unknown>;
    expect(Object.keys(c)).toEqual(expect.arrayContaining(["header", "named", "efs", "featureGroups"]));
    expect(Array.isArray(c.efs)).toBe(false);
  });
});
