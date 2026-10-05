import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { diffValues } from "@carrier-explode/values";
import { diffKeyed, compareBundles, comparable } from "../src/compare.ts";
import { isJsonDict } from "../src/plist.ts";
import { deviceStem } from "../src/bundle.ts";
import { openIpcc, decodeFile } from "../src/bundle.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", n)));

describe("diffValues over plist values", () => {
  it("treats tagged plist scalars as leaves", () => {
    expect(diffValues({ d: { __data: "00", __len: 1 } }, { d: { __data: "01", __len: 1 } }, isJsonDict)).toEqual([
      { path: "d", kind: "changed", a: { __data: "00", __len: 1 }, b: { __data: "01", __len: 1 } },
    ]);
  });
});

describe("diffKeyed", () => {
  it("diffs keyed collections key by key", () => {
    const parts = diffKeyed({ x: [1, 2], y: 1, gone: 0 }, { x: [1, 3], y: 1, new: 0 }, { maxRows: 5 });
    expect(parts.map((p) => [p.path, p.kind, p.rows.length])).toEqual([["gone", "removed", 0], ["new", "added", 0], ["x", "changed", 1]]);
    expect(diffKeyed({ x: [1, 2, 3] }, { x: [4, 5, 6] }, { maxRows: 2 })[0]).toMatchObject({ truncated: true, counts: { changed: 3 } });
  });
});

describe("compareBundles", () => {
  const att = openIpcc(fixture("carrier-att.ipcc"));
  const vzw = openIpcc(fixture("carrier-verizon.ipcc"));

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

  it("compares the chosen phones' override files with each other and leaves other phones' out", () => {
    const stems = [...new Set(att.info.files.flatMap((f) => deviceStem(f.path) ?? []))];
    const [one, two] = stems;
    if (one === undefined || two === undefined) throw new Error("the fixture needs two phones' override files");
    const d = compareBundles(att, att, { phones: { a: one, b: two } });
    const shown = [...d.shared, ...d.files.map((f) => f.path)];
    expect(shown.filter((p) => deviceStem(p) !== undefined && deviceStem(p) !== "*")).toEqual([]);
    for (const [path, sides] of Object.entries(d.aliases)) {
      expect(deviceStem(path)).toBe("*");
      expect([sides.a && deviceStem(sides.a), sides.b && deviceStem(sides.b)]).toEqual([one, two]);
    }
    expect(Object.keys(d.aliases).length).toBeGreaterThan(0);
  });

  it("narrows to one member and caps rows", () => {
    const d = compareBundles(att, vzw, { path: "carrier.plist", maxRows: 3 });
    expect(d.files.map((f) => f.path)).toEqual(["carrier.plist"]);
    expect(d.files[0]?.rows).toHaveLength(3);
    expect(d.files[0]?.truncated).toBe(true);
  });

  it("diffs a PRI by setting, not by position", () => {
    const pri = att.info.files.find((f) => f.kind === "pri-der");
    if (!pri) return;
    const c = comparable(decodeFile(att, pri.path)) as Record<string, unknown>;
    expect(Object.keys(c)).toEqual(expect.arrayContaining(["header", "named", "efs", "featureGroups"]));
    expect(Array.isArray(c.efs)).toBe(false);
  });
});
