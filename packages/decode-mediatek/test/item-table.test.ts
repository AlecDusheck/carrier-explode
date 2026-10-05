/**
 * The modem bundle and md1rom tables, on synthetic images laid out as a900a's md1rom lays them out, and values read
 * by their shapes. CORPUS=<dir> also reads <dir>/mediatek/md/modem-bundle.img.gz and types every value of
 * <dir>/mediatek/mcf (that build's mcf/mtk_default) with it.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  bundleItemTable, decodeNwOta, decodeOpOta, McfError, nameOf, readItemTable, readModemBundle, readValue, shapeOf, shapesFor, type ItemShape,
  type McfItemRecord,
} from "../src/index.ts";

const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);
const ROM_BASE = 0x9000_0000;

class Image {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }
  words(at: number, ...words: number[]): void {
    words.forEach((w, i) => this.view.setUint32(at + 4 * i, w, true));
  }
}

type Row = readonly [itemId: number, lid: number, byteOffset: number, bitOffset: number, size: number, isBits: number, isArray: number];

/** SBP features 0-9, a bit each of LID 0x3c0's 2-byte array, and SBP data 0-2, a byte each of LID 0x3c1's 3-byte array. */
const FEATURES = Array.from({ length: 10 }, (_, i) => `SBP_F${i}`);
const DATA = ["SBP_D0", "SBP_D1", "SBP_D2"];
const SBP_ROWS: readonly Row[] = [
  [10, 0x3c0, 4, 0xffff, 1, 0, 1],
  [11, 0x3c0, 5, 1, 1, 1, 0],
  [12, 0x3c1, 4, 0xffff, 1, 0, 1],
  [13, 0x3c1, 5, 0, 8, 1, 0],
  [14, 0x3c1, 6, 2, 1, 1, 0],
];
const SBP_FORMULAS = [[10, "[2](4,1)"], [12, "[3](4,1)"]] as const;

/** The SBP name tables at 0xd00, their names at 0xe40: features then data, each row (name, index), then the two counts. */
function sbpTables(image: Image, counts: readonly [number, number]): void {
  let at = 0xd00;
  let name = 0xe40;
  for (const names of [FEATURES, DATA]) {
    names.forEach((n, i) => {
      image.bytes.set(ascii(`${n}\0`), name);
      image.words(at, ROM_BASE + name, i);
      at += 8;
      name += n.length + 1;
    });
  }
  image.words(at, ...counts);
}

/** Item rows (with the SBP ones), then formula rows right after, then the LID group table and its names, then the SBP name tables. */
function rom(rows: readonly Row[], formulas: readonly (readonly [number, string])[], sbpCounts: readonly [number, number] = [10, 3]): Uint8Array {
  const image = new Image(0x1000);
  image.bytes.fill(0xff, 0, 0x100);
  let at = 0x100;
  for (const [itemId, lid, byteOffset, bitOffset, size, isBits, isArray] of [...rows, ...SBP_ROWS]) {
    image.words(at, itemId, lid);
    image.view.setUint16(at + 8, byteOffset, true);
    image.view.setUint16(at + 10, bitOffset, true);
    image.view.setUint16(at + 12, size, true);
    image.bytes[at + 14] = isBits;
    image.bytes[at + 15] = isArray;
    at += 16;
  }
  for (const [itemId, text] of [...formulas, ...SBP_FORMULAS]) {
    image.words(at, itemId);
    image.bytes.set(ascii(text), at + 4);
    at += 48;
  }
  const names = 0xe00;
  image.bytes.set(ascii("UMTS\0CAMERA\0IMS\0SBP\0"), names);
  at = 0xc00;
  for (const [name, first, last] of [[0, 0, 0x3f], [5, 0x40, 0x7f], [12, 0x540, 0x57f], [16, 0x3c0, 0x3ff]] as const) {
    image.words(at, ROM_BASE + names + name, first, last, 0, 0);
    at += 20;
  }
  sbpTables(image, sbpCounts);
  return image.bytes;
}

const ROWS: readonly Row[] = [
  [1, 0x541, 0, 0xffff, 2, 0, 0],
  [2, 0x541, 4, 3, 1, 1, 0],
  [3, 0x88f, 117, 0xffff, 1, 0, 1],
];
const FORMULAS = [[3, "[10](0,504)+[128](117,1)"]] as const;

describe("md1rom item table", () => {
  it("reads items, formulas and LID groups", () => {
    const table = readItemTable(rom(ROWS, FORMULAS));
    expect(table.items.slice(0, 3)).toEqual([
      { itemId: 1, lid: 0x541, byteOffset: 0, width: { unit: "byte", size: 2 }, formula: null },
      { itemId: 2, lid: 0x541, byteOffset: 4, width: { unit: "bit", size: 1, bitOffset: 3 }, formula: null },
      {
        itemId: 3, lid: 0x88f, byteOffset: 117, width: { unit: "byte", size: 1 },
        formula: [{ kind: "array", counts: [10], base: 0, stride: 504 }, { kind: "array", counts: [128], base: 117, stride: 1 }],
      },
    ]);
    expect(table.lidGroups).toEqual([
      { first: 0, last: 0x3f, name: "UMTS" }, { first: 0x40, last: 0x7f, name: "CAMERA" }, { first: 0x540, last: 0x57f, name: "IMS" }, { first: 0x3c0, last: 0x3ff, name: "SBP" },
    ]);
  });

  it("names the SBP feature bits and data bytes by their index in the SBP LIDs' byte arrays", () => {
    // Feature 9 is byte 1 bit 1 past the array's offset 4; a field narrower than a data byte names its bits.
    expect([...readItemTable(rom(ROWS, FORMULAS)).names]).toEqual([[11, "SBP_F9"], [13, "SBP_D1"], [14, "SBP_D2 bit 2"]]);
  });

  it("rejects SBP name tables whose counts disagree with their rows, and an SBP bit past its table", () => {
    expect(() => readItemTable(rom(ROWS, FORMULAS, [10, 2]))).toThrow(/no SBP name tables/);
    expect(() => readItemTable(rom([...ROWS, [4, 0x3c0, 5, 7, 1, 1, 0]], FORMULAS))).toThrow(/past its SBP name table/);
  });

  it("parses multi-dimensional terms and fixed offsets", () => {
    const table = readItemTable(rom([[3, 0x88f, 937, 0xffff, 4, 0, 1]], [[3, "[4](864,368)+[5,4,3](64,1)+[2](0,0)+9"]]));
    expect(table.items[0]?.formula).toEqual([
      { kind: "array", counts: [4], base: 864, stride: 368 },
      { kind: "array", counts: [5, 4, 3], base: 64, stride: 1 },
      { kind: "array", counts: [2], base: 0, stride: 0 },
      { kind: "offset", bytes: 9 },
    ]);
  });

  it("rejects a formula that misplaces element 0, and a formula without its array row", () => {
    expect(() => readItemTable(rom(ROWS, [[3, "[10](0,504)+[128](116,1)"]]))).toThrow(McfError);
    expect(() => readItemTable(rom(ROWS.map(([id, lid, o, b, s, isBits]) => [id, lid, o, b, s, isBits, 0] as const), FORMULAS))).toThrow(McfError);
  });

  it("finds no table in an image without one", () => {
    expect(() => readItemTable(new Uint8Array(0x1000))).toThrow(McfError);
  });
});

describe("modem bundle", () => {
  it("lists named segments", () => {
    const image = new Image(0x200);
    image.bytes.set(ascii("HBLR"), 0);
    image.words(0x30, 1);
    image.bytes.set(ascii("SEGMmd1rom"), 0x40);
    image.words(0x64, 0x100, 4, 4);
    image.bytes.set([1, 2, 3, 4], 0x100);
    expect([...readModemBundle(image.bytes)]).toEqual([["md1rom", Uint8Array.of(1, 2, 3, 4)]]);
    image.words(0x6c, 8);
    expect(() => readModemBundle(image.bytes)).toThrow(McfError);
    expect(() => readModemBundle(new Uint8Array(0x100))).toThrow(McfError);
  });
});

describe("values", () => {
  const byte = (size: number, depth: number): ItemShape => [0, size, "byte", depth];
  const bit = (size: number): ItemShape => [0, size, "bit", 0];

  it("reads little-endian numbers, runs and C strings", () => {
    expect(readValue(byte(2, 0), [], Uint8Array.of(0xdc, 0x05))).toEqual({ kind: "number", value: 1500 });
    expect(readValue(byte(4, 1), [2], Uint8Array.of(1, 0, 0, 0, 2, 0, 0, 0))).toEqual({ kind: "numbers", values: [1, 2] });
    expect(readValue(byte(1, 1), [0], Uint8Array.of(41, 77, 78, 79))).toEqual({ kind: "chars", values: [41, 77, 78, 79], text: null });
    expect(readValue(byte(1, 1), [0], Uint8Array.of(41, 77, 78, 0))).toEqual({ kind: "chars", values: [41, 77, 78, 0], text: ")MN" });
    expect(readValue(byte(1, 2), [0, 0], ascii("ims\0\0"))).toEqual({ kind: "chars", values: [0x69, 0x6d, 0x73, 0, 0], text: "ims" });
    expect(readValue(byte(1, 1), [0], ascii("a\0b\0"))).toMatchObject({ kind: "chars", text: null });
    expect(readValue(byte(8, 0), [], new Uint8Array(8))).toEqual({ kind: "bytes", bytes: new Uint8Array(8) });
    expect(readValue(bit(1), [], Uint8Array.of(1))).toEqual({ kind: "number", value: 1 });
    expect(readValue(bit(32), [], Uint8Array.of(0xff, 0xff, 0xfd, 0xff))).toEqual({ kind: "number", value: 0xfffdffff });
  });

  it("keeps what does not fit the shape, with why", () => {
    const unknown = (reason: RegExp) => ({ kind: "unknown", reason: expect.stringMatching(reason), bytes: expect.any(Uint8Array) });
    expect(readValue(undefined, [], Uint8Array.of(1))).toEqual(unknown(/not in the modem's item table/));
    expect(readValue(bit(1), [0], Uint8Array.of(1))).toEqual(unknown(/1 array indices for an item with 0/));
    expect(readValue(bit(1), [], Uint8Array.of(2))).toEqual(unknown(/does not fit 1 bits/));
    expect(readValue(bit(8), [], Uint8Array.of(1, 0))).toEqual(unknown(/2 bytes for a 8-bit field/));
    expect(readValue(byte(2, 0), [], Uint8Array.of(1))).toEqual(unknown(/not a whole number/));
    expect(readValue(byte(1, 0), [], Uint8Array.of(1, 2))).toEqual(unknown(/2 elements for a scalar/));
  });
});

describe("item shapes", () => {
  const table = readItemTable(rom(ROWS, FORMULAS));
  const record = (itemId: number, lid: number): McfItemRecord => ({ itemId, lid, condition: { kind: "always" }, values: [] });

  it("keeps only the items a config sets, their names and their LIDs' owners", () => {
    const shapes = shapesFor(table, [record(3, 0x88f), record(1, 0x541), record(99, 0x541), record(13, 0x3c1)]);
    expect(shapes).toEqual({
      items: { 1: [0x541, 2, "byte", 0], 3: [0x88f, 1, "byte", 2], 13: [0x3c1, 8, "bit", 0] },
      owners: { [0x541]: "IMS", [0x3c1]: "SBP" },
      names: { 13: "SBP_D1" },
    });
    expect(shapeOf(shapes, 3, 0x88f)).toEqual([0x88f, 1, "byte", 2]);
    // Filed under another LID than the table's: another numbering, so no shape and no name.
    expect(shapeOf(shapes, 3, 0x88e)).toBeUndefined();
    expect(shapeOf(shapes, 99, 0x541)).toBeUndefined();
    expect([nameOf(shapes, 13, 0x3c1), nameOf(shapes, 13, 0x3c0), nameOf(shapes, 1, 0x541)]).toEqual(["SBP_D1", undefined, undefined]);
  });
});

const corpus = process.env["CORPUS"] ? join(process.env["CORPUS"], "mediatek") : "";

describe.skipIf(!corpus || !existsSync(join(corpus, "md", "modem-bundle.img.gz")))("Pixel 11 md1rom corpus", () => {
  it("reads the item, formula, LID group and SBP name tables and types the build's own MCF values with them", () => {
    const table = bundleItemTable(new Uint8Array(gunzipSync(readFileSync(join(corpus, "md", "modem-bundle.img.gz")))));
    expect([table.items.length, table.items.filter((i) => i.formula !== null).length, table.lidGroups.length, table.names.size]).toEqual([8821, 1842, 77, 3267]);
    const kinds: Record<string, number> = {};
    for (const name of readdirSync(join(corpus, "mcf"))) {
      const decode = name.endsWith(".mcfopota") ? decodeOpOta : name.endsWith(".mcfnwota") ? decodeNwOta : undefined;
      if (decode === undefined) continue;
      const { records } = decode(new Uint8Array(readFileSync(join(corpus, "mcf", name))));
      const shapes = shapesFor(table, records);
      for (const r of records) {
        for (const { path, bytes } of r.values) {
          const { kind } = readValue(shapeOf(shapes, r.itemId, r.lid), path, bytes);
          kinds[kind] = (kinds[kind] ?? 0) + 1;
        }
      }
    }
    // The one unknown: MTK_OPOTA_SBPID_5 sets a scalar bit field of item 0x24f6 at array index 3.
    expect(kinds).toEqual({ number: 44012, chars: 985, unknown: 1 });
  });
});

