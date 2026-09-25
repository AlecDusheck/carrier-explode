/**
 * Tests for `src/lib/decode/ftab.ts` (Apple C1 package header) and
 * `src/lib/decode/modem.ts` (package families), on a synthetic ftab.
 */

import { describe, it, expect } from "vitest";
import { ftabSummary, parseBver, parseFtab } from "../src/lib/decode/ftab.ts";
import { modemChip, modemFamily, modemVendor } from "../src/lib/decode/modem.ts";

const BVER = "240.3431000025000000.5941|24.0.0.0|BBFW:3.01.03|date:2026 8 13|c4000v59|chip_revision_b0";

/** 'rkos' 'ftab' header, then each entry's bytes in order. */
function ftab(entries: Array<[string, Uint8Array]>): Uint8Array {
  const head = 0x30 + 16 * entries.length;
  const out = new Uint8Array(head + entries.reduce((n, [, b]) => n + b.length, 0));
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode("rkosftab"), 0x20);
  dv.setUint32(0x28, entries.length, true);
  let off = head;
  entries.forEach(([tag, b], i) => {
    out.set(new TextEncoder().encode(tag.padEnd(4, "\0")), 0x30 + 16 * i);
    dv.setUint32(0x34 + 16 * i, off, true);
    dv.setUint32(0x38 + 16 * i, b.length, true);
    out.set(b, off);
    off += b.length;
  });
  return out;
}

const pkg = ftab([["illb", new Uint8Array(8)], ["bver", new TextEncoder().encode(BVER + "\0")], ["CR11", new Uint8Array(3)]]);

describe("parseFtab", () => {
  it("lists every entry with its offset and size", () => {
    expect(parseFtab(pkg)).toEqual([
      { tag: "illb", offset: 0x60, size: 8 },
      { tag: "bver", offset: 0x68, size: BVER.length + 1 },
      { tag: "CR11", offset: 0x68 + BVER.length + 1, size: 3 },
    ]);
  });

  it("rejects what is not an ftab, and tables that run past the file", () => {
    expect(() => parseFtab(new Uint8Array(0x40))).toThrow(/not an rkos/);
    expect(() => parseFtab(pkg.subarray(0, pkg.length - 1))).toThrow(/CR11 runs past/);
  });
});

describe("parseBver", () => {
  it("reads version, date, chip and revision", () => {
    expect(parseBver(BVER)).toEqual({
      build: "240.3431000025000000.5941", version: "3.01.03", date: "2026-08-13", chip: "c4000v59", chipRevision: "b0",
    });
  });
});

describe("ftabSummary", () => {
  it("names the package, its family and build", () => {
    const s = ftabSummary(pkg, { name: "c4000v59/Release/patched/ftab.bin" });
    expect(s).toMatchObject({ schema: 1, kind: "ftab", package: { name: "c4000v59/Release/patched/ftab.bin", family: "C1", version: "3.01.03", bver: BVER } });
    expect(s.entries.map((e) => e.tag)).toEqual(["illb", "bver", "CR11"]);
  });
});

describe("modemFamily", () => {
  it("reads the family off the package name", () => {
    expect(modemFamily("Mav25-2.10.01.Release.bbfw")).toBe("Mav25");
    expect(modemFamily("Mav30-7.00.01.Release.bbfw")).toBe("Mav30");
    expect(modemFamily("ICE19-8.00.00.Release.bbfw")).toBe("ICE19");
    expect(modemFamily("c4000v59/Release/patched/ftab.bin")).toBe("C1");
    expect(modemChip("c4000v59/Release/patched/ftab.bin")).toBe("c4000");
  });

  it("keeps an unnamed Apple chip's id, and has none for other firmware", () => {
    expect(modemFamily("c4020iphone/Release/patched/ftab.bin")).toBe("c4020");
    expect(modemFamily("Rose/r2p1/ftab.bin")).toBeUndefined();
    expect(modemFamily("t2026phoneG1/Release/ftab.bin")).toBeUndefined();
  });

  it("knows each family's vendor", () => {
    expect(["Mav24", "ICE19", "C1", "c4020", "Rose"].map(modemVendor)).toEqual(["qualcomm", "intel", "apple", "apple", undefined]);
  });
});
