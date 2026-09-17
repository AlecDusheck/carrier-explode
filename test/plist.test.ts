import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  parsePlist,
  parseXmlPlist,
  parseBinaryPlist,
  toJsonSafe,
  bytesToHex,
  maybeText,
  type PlistValue,
} from "../worker/lib/plist.ts";
import { openIpcc } from "../worker/lib/ipcc.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", n)));

/** Raw bytes of one member of an .ipcc, straight out of the ZIP. */
const member = (ipcc: string, path: string): Uint8Array => {
  const opened = openIpcc(fixture(ipcc));
  const bytes = opened.entries[opened.prefix + path];
  if (!bytes) throw new Error(`missing fixture member ${ipcc}!${path}`);
  return bytes;
};

const enc = (s: string) => Array.from(new TextEncoder().encode(s));
const U8 = (...b: number[]) => new Uint8Array(b);

/* ------------------------------------------------------------------------ */
/* A minimal bplist00 writer, so every binary object type can be exercised    */
/* directly. `objects` holds already-encoded object bodies; refs inside them  */
/* are plain object-table indices written at `objectRefSize` bytes.           */
/* ------------------------------------------------------------------------ */

interface BuildOpts {
  offsetIntSize?: number;
  objectRefSize?: number;
  /** Override the trailer's numObjects (for malformed-input tests). */
  numObjects?: number;
  /** Override the trailer's offset-table offset (for malformed-input tests). */
  offsetTableOffset?: number;
}

function buildBplist(objects: number[][], topObject = 0, opts: BuildOpts = {}): Uint8Array {
  const body: number[] = enc("bplist00");
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(body.length);
    body.push(...o);
  }
  const offsetIntSize = opts.offsetIntSize ?? (body.length < 256 ? 1 : 2);
  const offsetTable = body.length;
  for (const off of offsets) {
    for (let i = offsetIntSize - 1; i >= 0; i--) {
      body.push(Number((BigInt(off) >> BigInt(8 * i)) & 0xffn));
    }
  }
  const trailer = new Uint8Array(32);
  const dv = new DataView(trailer.buffer);
  trailer[6] = offsetIntSize;
  trailer[7] = opts.objectRefSize ?? 1;
  dv.setBigUint64(8, BigInt(opts.numObjects ?? objects.length));
  dv.setBigUint64(16, BigInt(topObject));
  dv.setBigUint64(24, BigInt(opts.offsetTableOffset ?? offsetTable));
  return new Uint8Array([...body, ...trailer]);
}

const bp = (objects: number[][], topObject = 0, opts: BuildOpts = {}) =>
  parseBinaryPlist(buildBplist(objects, topObject, opts));

const f32 = (x: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, x);
  return Array.from(b);
};
const f64 = (x: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x);
  return Array.from(b);
};
const i64 = (x: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, x);
  return Array.from(b);
};
/** UTF-16BE code units for a string (surrogate pairs kept as two units). */
const u16 = (s: string) => {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out.push(c >> 8, c & 0xff);
  }
  return out;
};

/* ====================================================================== */

describe("binary plist: primitive object types", () => {
  it("decodes the null, false and true singletons", () => {
    expect(bp([[0x00]])).toBeNull();
    expect(bp([[0x08]])).toBe(false);
    expect(bp([[0x09]])).toBe(true);
  });

  it("treats an unassigned 0x0n marker (including the 0x0f fill byte) as null", () => {
    expect(bp([[0x0f]])).toBeNull();
    expect(bp([[0x01]])).toBeNull();
    expect(bp([[0x0c]])).toBeNull();
  });

  it("decodes 1, 2 and 4 byte unsigned integers big-endian", () => {
    expect(bp([[0x10, 0x00]])).toBe(0);
    expect(bp([[0x10, 0x2a]])).toBe(42);
    expect(bp([[0x10, 0xff]])).toBe(255);
    expect(bp([[0x11, 0x12, 0x34]])).toBe(0x1234);
    expect(bp([[0x11, 0xff, 0xff]])).toBe(65535);
    expect(bp([[0x12, 0x7f, 0xff, 0xff, 0xff]])).toBe(2147483647);
    expect(bp([[0x12, 0xff, 0xff, 0xff, 0xff]])).toBe(4294967295);
  });

  it("decodes 8 byte integers as signed, which is the only way negatives are stored", () => {
    expect(bp([[0x13, ...i64(-1n)]])).toBe(-1);
    expect(bp([[0x13, ...i64(-4n)]])).toBe(-4);
    expect(bp([[0x13, ...i64(-2147483648n)]])).toBe(-2147483648);
    expect(bp([[0x13, ...i64(0n)]])).toBe(0);
    expect(bp([[0x13, ...i64(9007199254740991n)]])).toBe(9007199254740991);
  });

  it("decodes 16 byte integers by keeping the low 64 bits", () => {
    expect(bp([[0x14, ...new Array(8).fill(0), 0, 0, 0, 0, 0, 0, 0, 5]])).toBe(5);
    expect(bp([[0x14, ...new Array(8).fill(0), 0, 0, 0, 0, 0x7f, 0xff, 0xff, 0xff]])).toBe(2147483647);
    // High 64 bits are discarded by design; the low half is read unsigned.
    expect(bp([[0x14, ...new Array(16).fill(0xff)]])).toBe(Number(0xffffffffffffffffn));
  });

  it("decodes float32 and float64 reals", () => {
    expect(bp([[0x22, ...f32(1.5)]])).toBe(1.5);
    expect(bp([[0x22, ...f32(-0.5)]])).toBe(-0.5);
    // 0.1 is not representable in binary32, so the widened value is expected.
    expect(bp([[0x22, ...f32(0.1)]])).toBeCloseTo(0.1, 7);
    expect(bp([[0x22, ...f32(0.1)]])).not.toBe(0.1);
    expect(bp([[0x23, ...f64(-2.25)]])).toBe(-2.25);
    expect(bp([[0x23, ...f64(0.1)]])).toBe(0.1);
    expect(bp([[0x23, ...f64(Number.MAX_VALUE)]])).toBe(Number.MAX_VALUE);
  });

  it("decodes dates relative to the 2001-01-01 Apple epoch", () => {
    const epoch = bp([[0x33, ...f64(0)]]) as Date;
    expect(epoch).toBeInstanceOf(Date);
    expect(epoch.toISOString()).toBe("2001-01-01T00:00:00.000Z");
    expect((bp([[0x33, ...f64(700000000)]]) as Date).toISOString()).toBe("2023-03-08T20:26:40.000Z");
    expect((bp([[0x33, ...f64(-978307200)]]) as Date).toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect((bp([[0x33, ...f64(1.5)]]) as Date).toISOString()).toBe("2001-01-01T00:00:01.500Z");
  });

  it("decodes data blobs, including the zero-length form", () => {
    expect(bp([[0x43, 1, 2, 3]])).toEqual(U8(1, 2, 3));
    expect(bp([[0x40]])).toEqual(new Uint8Array());
    expect(bp([[0x4e, ...new Array(14).fill(0xab)]])).toEqual(new Uint8Array(14).fill(0xab));
  });

  it("decodes ASCII strings and UTF-8 (0x7) strings", () => {
    expect(bp([[0x55, ...enc("hello")]])).toBe("hello");
    expect(bp([[0x50]])).toBe("");
    const cafe = enc("café"); // 5 bytes for 4 characters
    expect(cafe.length).toBe(5);
    expect(bp([[0x70 | cafe.length, ...cafe]])).toBe("café");
  });

  it("decodes UTF-16BE strings, counting length in code units not bytes", () => {
    expect(bp([[0x63, ...u16("日本語")]])).toBe("日本語");
    expect(bp([[0x62, ...u16("\ud83d\ude00")]])).toBe("\u{1F600}"); // surrogate pair = 2 units
    expect(bp([[0x66, ...u16("Привет")]])).toBe("Привет");
    expect(bp([[0x60]])).toBe("");
  });

  it("decodes UIDs as plain numbers sized by the low nibble plus one", () => {
    expect(bp([[0x80, 0x2a]])).toBe(42);
    expect(bp([[0x81, 0x01, 0x00]])).toBe(256);
    expect(bp([[0x83, 0x00, 0x00, 0x01, 0x00]])).toBe(256);
    expect(bp([[0x87, 0, 0, 0, 0, 0, 0, 0, 1]])).toBe(1);
  });

  it("rejects markers that the format does not define", () => {
    expect(() => bp([[0xb0]])).toThrow(/unknown marker 0xb0/);
    expect(() => bp([[0xe0]])).toThrow(/unknown marker 0xe0/);
    expect(() => bp([[0xf0]])).toThrow(/unknown marker 0xf0/);
  });
});

describe("binary plist: container object types", () => {
  it("decodes arrays of object references in order", () => {
    expect(bp([[0xa3, 1, 2, 3], [0x10, 1], [0x51, 0x62], [0x09]])).toEqual([1, "b", true]);
    expect(bp([[0xa0]])).toEqual([]);
  });

  it("decodes sets (0xC) as arrays", () => {
    expect(bp([[0xc2, 1, 2], [0x51, 0x61], [0x51, 0x62]])).toEqual(["a", "b"]);
    expect(bp([[0xc0]])).toEqual([]);
  });

  it("decodes dicts with the key table preceding the value table", () => {
    expect(bp([[0xd2, 1, 2, 3, 4], [0x51, 0x61], [0x51, 0x62], [0x10, 1], [0x09]])).toEqual({
      a: 1,
      b: true,
    });
    expect(bp([[0xd0]])).toEqual({});
  });

  it("stringifies non-string dict keys", () => {
    expect(bp([[0xd1, 1, 2], [0x10, 5], [0x53, ...enc("abc")]])).toEqual({ "5": "abc" });
    expect(bp([[0xd1, 1, 2], [0x09], [0x51, 0x76]])).toEqual({ true: "v" });
  });

  it("decodes nested containers", () => {
    // { list: [ { n: 1 } ] }
    const v = bp([
      [0xd1, 1, 2], // root dict
      [0x54, ...enc("list")],
      [0xa1, 3], // array
      [0xd1, 4, 5], // inner dict
      [0x51, 0x6e], // "n"
      [0x10, 1],
    ]);
    expect(v).toEqual({ list: [{ n: 1 }] });
  });
});

describe("binary plist: 0x0f extended length form", () => {
  it("reads an extended length for data", () => {
    expect(bp([[0x4f, 0x10, 20, ...new Array(20).fill(7)]])).toEqual(new Uint8Array(20).fill(7));
  });

  it("reads an extended length for ASCII strings", () => {
    const s = "0123456789abcdef";
    expect(bp([[0x5f, 0x10, s.length, ...enc(s)]])).toBe(s);
  });

  it("reads an extended length for UTF-8 (0x7) strings", () => {
    const s = "0123456789abcdefgh";
    expect(bp([[0x7f, 0x10, s.length, ...enc(s)]])).toBe(s);
  });

  it("reads an extended length for UTF-16BE strings", () => {
    const s = "Привет, мир! ok";
    expect(s.length).toBe(15);
    expect(bp([[0x6f, 0x11, 0x00, s.length, ...u16(s)]])).toBe(s);
  });

  it("reads an extended length for arrays", () => {
    const objs: number[][] = [[0xaf, 0x10, 20, ...Array.from({ length: 20 }, (_, i) => i + 1)]];
    for (let i = 0; i < 20; i++) objs.push([0x10, i]);
    expect(bp(objs)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("reads an extended length for sets", () => {
    const objs: number[][] = [[0xcf, 0x10, 16, ...Array.from({ length: 16 }, (_, i) => i + 1)]];
    for (let i = 0; i < 16; i++) objs.push([0x10, i * 2]);
    expect(bp(objs)).toEqual(Array.from({ length: 16 }, (_, i) => i * 2));
  });

  it("reads an extended length for dicts", () => {
    const keyRefs: number[] = [];
    const valRefs: number[] = [];
    const objs: number[][] = [[]];
    for (let i = 0; i < 16; i++) {
      objs.push([0x52, 0x6b, 0x61 + i]); // "ka".."kp"
      keyRefs.push(objs.length - 1);
    }
    for (let i = 0; i < 16; i++) {
      objs.push([0x10, i]);
      valRefs.push(objs.length - 1);
    }
    objs[0] = [0xdf, 0x10, 16, ...keyRefs, ...valRefs];
    const out = bp(objs) as Record<string, number>;
    expect(Object.keys(out)).toHaveLength(16);
    expect(out.ka).toBe(0);
    expect(out.kp).toBe(15);
  });

  it("accepts 1, 2, 4 and 8 byte count integers in the extended length prefix", () => {
    const s = "0123456789abcdef";
    expect(bp([[0x5f, 0x10, 16, ...enc(s)]])).toBe(s);
    expect(bp([[0x5f, 0x11, 0x00, 0x10, ...enc(s)]])).toBe(s);
    expect(bp([[0x5f, 0x12, 0, 0, 0, 0x10, ...enc(s)]])).toBe(s);
    expect(bp([[0x5f, 0x13, 0, 0, 0, 0, 0, 0, 0, 0x10, ...enc(s)]])).toBe(s);
  });
});

describe("binary plist: trailer, offset table and object references", () => {
  it("handles 1, 2, 4 and 8 byte offset-table integers", () => {
    const objs: number[][] = [[0xa2, 1, 2], [0x51, 0x78], [0x10, 3]];
    for (const offsetIntSize of [1, 2, 4, 8]) {
      expect(bp(objs, 0, { offsetIntSize })).toEqual(["x", 3]);
    }
  });

  it("handles 2 byte object references", () => {
    const objs: number[][] = [[0xa2, 0, 1, 0, 2], [0x10, 7], [0x10, 8]];
    expect(bp(objs, 0, { objectRefSize: 2 })).toEqual([7, 8]);
  });

  it("honours a topObject other than zero", () => {
    expect(bp([[0x51, 0x61], [0x10, 9], [0x09]], 1)).toBe(9);
    expect(bp([[0x51, 0x61], [0x10, 9], [0x09]], 2)).toBe(true);
  });

  it("returns the identical cached instance when one object is referenced twice", () => {
    const strs = bp([[0xa2, 1, 1], [0x53, ...enc("dup")]]) as PlistValue[];
    expect(strs).toEqual(["dup", "dup"]);

    const arrays = bp([[0xa2, 1, 1], [0xa1, 2], [0x10, 9]]) as PlistValue[];
    expect(arrays).toEqual([[9], [9]]);
    expect(arrays[0]).toBe(arrays[1]);

    const dicts = bp([
      [0xd2, 1, 2, 3, 3],
      [0x51, 0x61],
      [0x51, 0x62],
      [0xd1, 4, 5],
      [0x51, 0x6b],
      [0x10, 1],
    ]) as Record<string, PlistValue>;
    expect(dicts).toEqual({ a: { k: 1 }, b: { k: 1 } });
    expect(dicts.a).toBe(dicts.b);
  });

  it("decodes deeply nested containers up to the depth guard", () => {
    const depth = 60;
    const objs: number[][] = [];
    for (let i = 0; i < depth; i++) objs.push([0xa1, i + 1]);
    objs.push([0x10, 99]);
    let cur = bp(objs) as PlistValue;
    let seen = 0;
    while (Array.isArray(cur)) {
      cur = cur[0];
      seen++;
    }
    expect(seen).toBe(depth);
    expect(cur).toBe(99);
  });

  it("stops rather than recursing forever past the depth guard", () => {
    const objs: number[][] = [];
    for (let i = 0; i < 80; i++) objs.push([0xa1, i + 1]);
    objs.push([0x10, 99]);
    expect(() => bp(objs)).toThrow(/nested too deep/);
  });

  it("stops rather than looping forever on a self-referential object graph", () => {
    expect(() => bp([[0xa1, 1], [0xa1, 0]])).toThrow(/nested too deep/);
    expect(() => bp([[0xa1, 0]])).toThrow(/nested too deep/);
  });
});

describe("binary plist: malformed and hostile input", () => {
  const real = fixture("manifest-trimmed.bplist");

  /** Asserts the call terminates, either by throwing an Error or returning something. */
  const survives = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(typeof (e as Error).message).toBe("string");
    }
  };

  it("rejects buffers too small to hold a trailer", () => {
    expect(() => parseBinaryPlist(new Uint8Array())).toThrow(/bplist too short/);
    expect(() => parseBinaryPlist(real.subarray(0, 20))).toThrow(/bplist too short/);
    expect(() => parseBinaryPlist(real.subarray(0, 39))).toThrow(Error);
  });

  it("does not hang when the trailer is cut off", () => {
    for (const cut of [1, 2, 8, 10, 16, 31]) {
      survives(() => parseBinaryPlist(real.subarray(0, real.length - cut)));
    }
  });

  it("does not hang when the body is truncated but the trailer is kept", () => {
    const keepTrailer = (bodyLen: number) => {
      const out = new Uint8Array(bodyLen + 32);
      out.set(real.subarray(0, bodyLen));
      out.set(real.subarray(real.length - 32), bodyLen);
      return out;
    };
    for (const bodyLen of [8, 64, 1000, Math.floor(real.length / 2), real.length - 4000]) {
      survives(() => parseBinaryPlist(keepTrailer(bodyLen)));
    }
  });

  it("throws instead of allocating when numObjects is absurd", () => {
    expect(() => parseBinaryPlist(buildBplist([[0x10, 1]], 0, { numObjects: 0xffffffff }))).toThrow(Error);
    expect(() =>
      parseBinaryPlist(buildBplist([[0x10, 1]], 0, { numObjects: Number.MAX_SAFE_INTEGER })),
    ).toThrow(RangeError);
  });

  it("throws a named error when topObject is out of range", () => {
    expect(() => parseBinaryPlist(buildBplist([[0x10, 1]], 5))).toThrow(/object index out of range/);
    expect(() => parseBinaryPlist(buildBplist([[0x10, 1]], 1))).toThrow(/object index out of range/);
  });

  it("throws when the offset table points outside the buffer", () => {
    expect(() =>
      parseBinaryPlist(buildBplist([[0x10, 1]], 0, { offsetTableOffset: 1_000_000 })),
    ).toThrow(RangeError);
  });

  it("does not hang on nonsense trailer field sizes", () => {
    survives(() => parseBinaryPlist(buildBplist([[0x10, 1]], 0, { offsetIntSize: 0 })));
    survives(() =>
      parseBinaryPlist(buildBplist([[0xa2, 1, 2], [0x10, 1], [0x10, 2]], 0, { objectRefSize: 0 })),
    );
  });

  it("does not hang when a declared length runs past the end of the buffer", () => {
    // A string/data length longer than the remaining bytes clamps via subarray.
    expect(() => parseBinaryPlist(buildBplist([[0x5f, 0x11, 0xff, 0xff, 0x61]]))).not.toThrow();
    expect(() => parseBinaryPlist(buildBplist([[0x4f, 0x12, 0x7f, 0xff, 0xff, 0xff]]))).not.toThrow();
    // A container element count past the end resolves to missing objects instead.
    expect(() => parseBinaryPlist(buildBplist([[0xaf, 0x11, 0x00, 0xff]]))).toThrow(Error);
  });

  it("does not hang on pure garbage that happens to reach the trailer check", () => {
    survives(() => parseBinaryPlist(new Uint8Array(64).fill(0xab)));
    survives(() => parseBinaryPlist(new Uint8Array(64)));
    survives(() => parseBinaryPlist(new Uint8Array(4096).fill(0xff)));
    const random = new Uint8Array(512);
    for (let i = 0; i < random.length; i++) random[i] = (i * 37 + 11) & 0xff;
    survives(() => parseBinaryPlist(random));
  });
});

describe("parsePlist: format detection", () => {
  it("routes a bplist00 magic to the binary parser", () => {
    const b = buildBplist([[0x53, ...enc("bin")]]);
    expect(parsePlist(b)).toBe("bin");
  });

  it("only looks at the six magic bytes, not the version digits", () => {
    const b = buildBplist([[0x10, 7]]);
    b.set(new Uint8Array(enc("bplist01")), 0);
    expect(parsePlist(b)).toBe(7);
  });

  it("treats an 8 byte buffer as XML because the magic check needs length > 8", () => {
    expect(parsePlist(new Uint8Array(enc("bplist00")))).toBeNull();
  });

  it("routes anything else to the XML parser", () => {
    expect(parsePlist(new Uint8Array(enc("<plist><string>x</string></plist>")))).toBe("x");
    expect(parsePlist(new Uint8Array(enc("\uFEFF<plist><string>x</string></plist>")))).toBe("x");
    expect(parsePlist(new Uint8Array(enc("\n\n  <plist><string>x</string></plist>")))).toBe("x");
    expect(parsePlist(new Uint8Array())).toBeNull();
    expect(parsePlist(U8(0, 1, 2, 3, 4, 5, 6, 7, 8, 9))).toBeNull();
  });

  it("does not silently fall back to XML for a corrupt bplist", () => {
    expect(() => parsePlist(new Uint8Array([...enc("bplist00"), 1]))).toThrow(/bplist too short/);
  });
});

/* ====================================================================== */

describe("XML plist: lexical features", () => {
  it("decodes the five named entities", () => {
    expect(parseXmlPlist("<plist><string>&amp;&lt;&gt;&quot;&apos;</string></plist>")).toBe("&<>\"'");
  });

  it("decodes decimal numeric character references", () => {
    expect(parseXmlPlist("<plist><string>&#65;&#66;&#8364;</string></plist>")).toBe("AB€");
    expect(parseXmlPlist("<plist><string>a&#0;b</string></plist>")).toBe("a b");
  });

  it("decodes hexadecimal numeric character references including astral planes", () => {
    expect(parseXmlPlist("<plist><string>&#x41;&#xE9;</string></plist>")).toBe("Aé");
    expect(parseXmlPlist("<plist><string>&#x1F600;</string></plist>")).toBe("\u{1F600}");
    // The entity regex only accepts a lowercase "x" (as XML itself requires),
    // so the uppercase form is left literal and the `e[1] === "X"` branch in
    // decodeEntities is unreachable.
    expect(parseXmlPlist("<plist><string>&#X41;</string></plist>")).toBe("&#X41;");
  });

  it("leaves an unrecognised entity untouched instead of failing", () => {
    expect(parseXmlPlist("<plist><string>&nbsp;x</string></plist>")).toBe("&nbsp;x");
    expect(parseXmlPlist("<plist><string>a & b</string></plist>")).toBe("a & b");
  });

  it("decodes entities inside <key> as well as inside values", () => {
    expect(parseXmlPlist("<plist><dict><key>a&amp;b</key><string>v</string></dict></plist>")).toEqual({
      "a&b": "v",
    });
    expect(
      parseXmlPlist("<plist><dict><key>&#x41;&#66;</key><string>v</string></dict></plist>"),
    ).toEqual({ AB: "v" });
  });

  it("takes CDATA content literally and concatenates it with surrounding text", () => {
    expect(parseXmlPlist("<plist><string><![CDATA[a<b&c]]>d</string></plist>")).toBe("a<b&cd");
    expect(parseXmlPlist("<plist><string>x<![CDATA[]]>y</string></plist>")).toBe("xy");
  });

  it("skips comments, processing instructions and the DOCTYPE", () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<?some-pi data?>` +
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">` +
      `<!-- leading -->` +
      `<plist version="1.0"><!--inner--><dict><key>k</key><!--between--><string>v</string></dict></plist>`;
    expect(parseXmlPlist(xml)).toEqual({ k: "v" });
  });

  it("splices text around an embedded comment rather than truncating at it", () => {
    expect(parseXmlPlist("<plist><string>a<!--x-->b</string></plist>")).toBe("ab");
  });

  it("handles every self-closing element form", () => {
    const xml =
      `<plist><dict>` +
      `<key>a</key><dict/>` +
      `<key>b</key><array/>` +
      `<key>c</key><string/>` +
      `<key>d</key><true/>` +
      `<key>e</key><false/>` +
      `<key>f</key><data/>` +
      `<key>g</key><integer/>` +
      `</dict></plist>`;
    expect(parseXmlPlist(xml)).toEqual({
      a: {},
      b: [],
      c: "",
      d: true,
      e: false,
      f: new Uint8Array(),
      g: null,
    });
  });

  it("ignores whitespace and newlines inside base64 <data>", () => {
    expect(parseXmlPlist("<plist><data>\n   QUJD\n   REVG\n  </data></plist>")).toEqual(
      new Uint8Array(enc("ABCDEF")),
    );
    expect(parseXmlPlist("<plist><data>\t\tQ\tU\tJ\tD\t</data></plist>")).toEqual(
      new Uint8Array(enc("ABC")),
    );
    expect(parseXmlPlist("<plist><data></data></plist>")).toEqual(new Uint8Array());
    expect(parseXmlPlist("<plist><data>   </data></plist>")).toEqual(new Uint8Array());
  });

  it("parses <date> through the Date constructor", () => {
    const d = parseXmlPlist("<plist><date>2024-03-05T06:07:08Z</date></plist>") as Date;
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe("2024-03-05T06:07:08.000Z");
    // An unparseable date stays as its text so the value remains serialisable.
    expect(parseXmlPlist("<plist><date>not-a-date</date></plist>")).toBe("not-a-date");
  });

  it("parses <integer> with radix 10 and falls back to 0 on garbage", () => {
    expect(
      parseXmlPlist(
        "<plist><array>" +
          "<integer>  12  </integer>" +
          "<integer>-7</integer>" +
          "<integer>abc</integer>" +
          "<integer>0x10</integer>" +
          "<integer></integer>" +
          "</array></plist>",
      ),
    ).toEqual([12, -7, 0, 0, 0]);
  });

  it("parses <real> and falls back to 0 on garbage", () => {
    expect(
      parseXmlPlist(
        "<plist><array>" +
          "<real>1.5e3</real>" +
          "<real>-0.25</real>" +
          "<real>x</real>" +
          "<real>NaN</real>" +
          "<real>Infinity</real>" +
          "</array></plist>",
      ),
    ).toEqual([1500, -0.25, 0, 0, Infinity]);
  });

  it("lowercases element names and ignores attributes and inner whitespace", () => {
    expect(parseXmlPlist("<PLIST><DICT><KEY>a</KEY><STRING>v</STRING></DICT></PLIST>")).toEqual({ a: "v" });
    expect(
      parseXmlPlist(`<plist version="1.0"><dict><key >a</key ><string xml:space="preserve">v</string></dict></plist>`),
    ).toEqual({ a: "v" });
  });

  it("returns null for empty and content-free documents", () => {
    expect(parseXmlPlist("")).toBeNull();
    expect(parseXmlPlist("   \n\t ")).toBeNull();
    expect(parseXmlPlist("<plist></plist>")).toBeNull();
    expect(parseXmlPlist("<plist/>")).toBeNull();
    expect(parseXmlPlist(`<?xml version="1.0"?><!DOCTYPE plist>`)).toBeNull();
  });

  it("parses a bare root element with no <plist> wrapper", () => {
    expect(parseXmlPlist("<dict><key>k</key><string>v</string></dict>")).toEqual({ k: "v" });
    expect(parseXmlPlist("<array><integer>1</integer></array>")).toEqual([1]);
  });

  it("unwraps a <plist> wrapper only once per level", () => {
    expect(parseXmlPlist("<plist><plist><string>x</string></plist></plist>")).toBe("x");
  });
});

describe("XML plist: sibling terminator correctness", () => {
  it("keeps every scalar in an array of mixed scalars", () => {
    expect(
      parseXmlPlist(
        "<plist><array>" +
          "<string>a</string><integer>1</integer><real>2.5</real>" +
          "<true/><false/><data>QQ==</data>" +
          "</array></plist>",
      ),
    ).toEqual(["a", 1, 2.5, true, false, new Uint8Array([0x41])]);
  });

  it("does not let a nested array swallow its parent's terminator", () => {
    expect(
      parseXmlPlist(
        "<plist><array><array><integer>1</integer></array><array><integer>2</integer></array><integer>3</integer></array></plist>",
      ),
    ).toEqual([[1], [2], 3]);
  });

  it("keeps trailing siblings at every level of a three-deep array", () => {
    expect(
      parseXmlPlist(
        "<plist><array><array><array><string>x</string></array><string>y</string></array><string>z</string></array></plist>",
      ),
    ).toEqual([[["x"], "y"], "z"]);
  });

  it("continues reading dict keys after an array of dicts", () => {
    expect(
      parseXmlPlist(
        "<plist><dict><key>l</key><array>" +
          "<dict><key>a</key><integer>1</integer></dict>" +
          "<dict><key>b</key><integer>2</integer></dict>" +
          "</array><key>z</key><string>end</string></dict></plist>",
      ),
    ).toEqual({ l: [{ a: 1 }, { b: 2 }], z: "end" });
  });

  it("continues reading dict keys after a nested dict whose last value is a scalar", () => {
    expect(
      parseXmlPlist(
        "<plist><dict><key>a</key><dict><key>b</key><integer>1</integer></dict><key>c</key><integer>2</integer></dict></plist>",
      ),
    ).toEqual({ a: { b: 1 }, c: 2 });
  });

  it("continues reading dict keys after an array whose last element is a dict", () => {
    expect(
      parseXmlPlist(
        "<plist><dict><key>a</key><array><integer>1</integer><dict><key>k</key><string>v</string></dict></array><key>b</key><integer>9</integer></dict></plist>",
      ),
    ).toEqual({ a: [1, { k: "v" }], b: 9 });
  });

  it("survives deeply alternating array and dict nesting with trailing keys", () => {
    expect(
      parseXmlPlist(
        "<plist><dict><key>k1</key><array>" +
          "<dict><key>k2</key><array><string>s</string></array><key>k3</key><integer>3</integer></dict>" +
          "</array><key>k4</key><integer>4</integer></dict></plist>",
      ),
    ).toEqual({ k1: [{ k2: ["s"], k3: 3 }], k4: 4 });
  });

  it("handles a four-deep alternation ending in a scalar tail", () => {
    expect(
      parseXmlPlist(
        "<plist><dict><key>a</key><array><dict><key>b</key><array><dict><key>c</key><string>deep</string></dict></array></dict></array><key>tail</key><true/></dict></plist>",
      ),
    ).toEqual({ a: [{ b: [{ c: "deep" }] }], tail: true });
  });

  it("does not merge consecutive empty dicts in an array", () => {
    expect(parseXmlPlist("<plist><array><dict></dict><dict></dict><string>x</string></array></plist>")).toEqual([
      {},
      {},
      "x",
    ]);
    expect(parseXmlPlist("<plist><array><dict/><array/><string>x</string></array></plist>")).toEqual([
      {},
      [],
      "x",
    ]);
  });

  it("keeps consecutive array-valued keys separate", () => {
    expect(
      parseXmlPlist(
        "<plist><dict><key>a</key><array><string>1</string><string>2</string></array>" +
          "<key>b</key><array><string>3</string></array>" +
          "<key>c</key><string>4</string></dict></plist>",
      ),
    ).toEqual({ a: ["1", "2"], b: ["3"], c: "4" });
  });

  it("keeps boolean values from consuming the next key", () => {
    expect(
      parseXmlPlist(
        "<plist><dict><key>a</key><true/><key>b</key><false/><key>c</key><dict><key>d</key><true/></dict><key>e</key><string>last</string></dict></plist>",
      ),
    ).toEqual({ a: true, b: false, c: { d: true }, e: "last" });
  });

  it("keeps <data> and <date> siblings distinct", () => {
    const v = parseXmlPlist(
      "<plist><array><data>QUJD</data><data>REVG</data><date>2001-01-01T00:00:00Z</date><string>tail</string></array></plist>",
    ) as PlistValue[];
    expect(v).toHaveLength(4);
    expect(v[0]).toEqual(new Uint8Array(enc("ABC")));
    expect(v[1]).toEqual(new Uint8Array(enc("DEF")));
    expect((v[2] as Date).toISOString()).toBe("2001-01-01T00:00:00.000Z");
    expect(v[3]).toBe("tail");
  });

  it("keeps a nested structure intact when a dict is the last array element", () => {
    expect(
      parseXmlPlist(
        "<plist><array><dict><key>a</key><array><integer>1</integer><integer>2</integer></array></dict><dict><key>b</key><string>z</string></dict></array></plist>",
      ),
    ).toEqual([{ a: [1, 2] }, { b: "z" }]);
  });
});

describe("XML plist: malformed and hostile input", () => {
  it("recovers a best-effort value from unterminated tags", () => {
    expect(parseXmlPlist("<plist><dict><key>a</key><string>v")).toEqual({ a: "" });
    expect(parseXmlPlist("<plist><dict><key>a</key><string>v</string")).toEqual({ a: "v" });
    expect(parseXmlPlist("<plist><dict><key>a</key><string>v</string></dict>")).toEqual({ a: "v" });
  });

  it("skips stray closing tags inside a dict or array", () => {
    expect(parseXmlPlist("<plist><dict></array><key>a</key><string>v</string></dict></plist>")).toEqual({
      a: "v",
    });
    expect(parseXmlPlist("<plist><array></dict><string>v</string></array></plist>")).toEqual(["v"]);
    expect(parseXmlPlist("</dict></array></plist>")).toBeNull();
  });

  it("does not throw when a stray closing tag is the first child of <plist>", () => {
    // NOTE: unlike <dict>/<array>, the <plist> branch does not skip stray closes,
    // so this degrades to null rather than recovering the dict. It must not throw.
    expect(() => parseXmlPlist("<plist></array><dict><key>a</key><string>v</string></dict></plist>")).not.toThrow();
  });

  it("recovers from mismatched tags", () => {
    expect(parseXmlPlist("<plist><dict><key>a</key><array><string>v</dict></array></plist>")).toEqual({
      a: ["v"],
    });
    expect(parseXmlPlist("<plist><dict><key>a</key><string>v</dict></plist>")).toEqual({ a: "v" });
  });

  it("tolerates a missing </key>", () => {
    expect(parseXmlPlist("<plist><dict><key>a<string>v</string></dict></plist>")).toEqual({ a: "v" });
  });

  it("tolerates keys with no value and values with no key", () => {
    expect(parseXmlPlist("<plist><dict><key>a</key></dict></plist>")).toEqual({ a: null });
    expect(parseXmlPlist("<plist><dict><key></key><string>v</string></dict></plist>")).toEqual({ "": "v" });
    expect(
      parseXmlPlist("<plist><dict><key>a</key><string>x</string><foo>bar</foo><key>b</key><string>y</string></dict></plist>"),
    ).toEqual({ a: "x", b: "y" });
    expect(
      parseXmlPlist("<plist><dict><key>a</key><foo>bar</foo><key>b</key><string>y</string></dict></plist>"),
    ).toEqual({ a: null, b: "y" });
  });

  it("lets a later duplicate key win", () => {
    expect(parseXmlPlist("<plist><dict><key>a</key><string>1</string><key>a</key><string>2</string></dict></plist>")).toEqual(
      { a: "2" },
    );
  });

  it("tolerates unterminated comments and CDATA sections", () => {
    expect(parseXmlPlist("<plist><string>a</string><!-- never closed")).toBe("a");
    expect(parseXmlPlist("<plist><string><![CDATA[abc</plist>")).toBe("abc</plist>");
  });

  it("returns null for input that is not XML at all", () => {
    expect(parseXmlPlist("not xml at all just text")).toBeNull();
    expect(parseXmlPlist("{\"json\": true}")).toBeNull();
    expect(parseXmlPlist("<<<>>>")).toBeNull();
    expect(parseXmlPlist("<".repeat(10000))).toBeNull();
  });

  it("throws rather than recursing without bound past the XML depth guard", () => {
    const n = 300;
    const xml = "<plist>" + "<array>".repeat(n) + "<string>x</string>" + "</array>".repeat(n) + "</plist>";
    expect(() => parseXmlPlist(xml)).toThrow(/nested too deep/);
    expect(() => parseXmlPlist("<plist>" + "<array>".repeat(5000))).toThrow(/nested too deep/);
  });

  it("parses nesting just under the depth guard", () => {
    const n = 150;
    const xml = "<plist>" + "<array>".repeat(n) + "<string>x</string>" + "</array>".repeat(n) + "</plist>";
    let cur = parseXmlPlist(xml) as PlistValue;
    let depth = 0;
    while (Array.isArray(cur)) {
      cur = cur[0];
      depth++;
    }
    expect(depth).toBe(n);
    expect(cur).toBe("x");
  });

  it("finishes quickly on a pathological entity-heavy string", () => {
    const xml = "<plist><string>" + "&amp;".repeat(50000) + "</string></plist>";
    const started = Date.now();
    expect((parseXmlPlist(xml) as string).length).toBe(50000);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("emits an extra null rather than swallowing siblings when an element nests inside <string>", () => {
    expect(parseXmlPlist("<plist><array><string>a<b/>c</string><string>z</string></array></plist>")).toEqual([
      "a",
      null,
      "z",
    ]);
  });
});

/* ====================================================================== */

/**
 * Normalises a parsed plist for cross-format comparison: binary blobs become
 * `hex:<...>` and dates become their ISO string. Everything else keeps its
 * exact shape so structural differences still fail the comparison.
 */
function normalise(v: PlistValue): unknown {
  if (v instanceof Uint8Array) return `hex:${bytesToHex(v)}`;
  if (v instanceof Date) return `date:${v.getTime()}`;
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = normalise((v as Record<string, PlistValue>)[k]);
    return out;
  }
  return v;
}

describe("cross-format equivalence: manifest-trimmed.xml vs manifest-trimmed.bplist", () => {
  const fromXml = parsePlist(fixture("manifest-trimmed.xml")) as Record<string, PlistValue>;
  const fromBin = parsePlist(fixture("manifest-trimmed.bplist")) as Record<string, PlistValue>;

  it("produces the same top-level key set", () => {
    expect(Object.keys(fromXml).sort()).toEqual(Object.keys(fromBin).sort());
    expect(Object.keys(fromBin).sort()).toEqual([
      "CarrierBundleSignatures",
      "CarrierBundles",
      "CountryBundleSignatures",
      "CountryBundles",
      "MobileDeviceCarrierBundles",
      "MobileDeviceCarrierBundlesByProductVersion",
      "MobileDeviceCarriers",
      "MobileDeviceCarriersByCarrierID",
      "MobileDeviceCarriersByMccMnc",
      "iTunesMacVersion",
    ]);
  });

  it("produces deeply identical documents once data and dates are normalised", () => {
    expect(normalise(fromXml)).toEqual(normalise(fromBin));
  });

  it("agrees on MobileDeviceCarrierBundlesByProductVersion.ATT_US", () => {
    const x = (fromXml.MobileDeviceCarrierBundlesByProductVersion as any).ATT_US;
    const b = (fromBin.MobileDeviceCarrierBundlesByProductVersion as any).ATT_US;
    expect(Object.keys(x).sort()).toEqual(Object.keys(b).sort());
    expect(normalise(x)).toEqual(normalise(b));

    // Concrete values, read out of the fixture.
    expect(b["17.5"].BuildVersion).toBe("58.1");
    expect(b["17.5"].BundleURL).toBe(
      "https://updates.cdn-apple.com/20240607/carrierbundles/032-24052/B739986A-91FF-4A56-A0C6-08F0A826C7C4/ATT_US_iPhone.ipcc",
    );
    expect(bytesToHex(b["17.5"].Digest)).toBe("a7151006fb3b71643ec59040fce64310079fe550");
    expect(bytesToHex(b["17.5"].Digest3)).toBe(
      "b326c7f75a589acb3d5addf2f51ac67fc5462bb6f0915bb48f60189ea5611ecc047ad6db9683350c738cbc63011e09ab",
    );
    // The 2009-era entry has no Digest at all.
    expect(Object.keys(b["3.1"]).sort()).toEqual(["BuildVersion", "BundleURL"]);
    expect(Object.keys(b.ByProductType).sort()).toEqual(["iPad", "iPhone", "iPhone7,1", "iPhone7,2"]);
  });

  it("agrees on CountryBundles.iPhone.Bundles entry by entry", () => {
    const x = (fromXml.CountryBundles as any).iPhone.Bundles;
    const b = (fromBin.CountryBundles as any).iPhone.Bundles;
    expect(Object.keys(b).sort()).toEqual([
      "Australia_1",
      "Germany_1",
      "Germany_2",
      "Netherlands_1",
      "Netherlands_2",
      "UnitedStates_1",
    ]);
    expect(Object.keys(x).sort()).toEqual(Object.keys(b).sort());
    for (const name of Object.keys(b)) {
      expect(normalise(x[name])).toEqual(normalise(b[name]));
      expect(Object.keys(b[name]).sort()).toEqual(["BundleID", "BundleURL", "BundleVersion", "Digest"]);
    }
    expect(b.Australia_1.BundleID).toBe("Australia");
    expect(b.Australia_1.BundleVersion).toBe("69.1");
    expect(bytesToHex(b.Australia_1.Digest)).toBe(
      "c6ef6b9d61c26ee874718790c470f3390f5f2dfd7b481cffe2513528b2cf2192bbe4567307d455faba3af761e8b220df",
    );
  });

  it("round-trips <data> to byte-identical Uint8Arrays for every Digest in the document", () => {
    const digests = (v: PlistValue, path: string, out: Array<[string, Uint8Array]>) => {
      if (v instanceof Uint8Array || v instanceof Date) return;
      if (Array.isArray(v)) {
        v.forEach((x, i) => digests(x, `${path}[${i}]`, out));
        return;
      }
      if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) {
          if (val instanceof Uint8Array && k.startsWith("Digest")) out.push([`${path}.${k}`, val]);
          else digests(val, `${path}.${k}`, out);
        }
      }
    };
    const xd: Array<[string, Uint8Array]> = [];
    const bd: Array<[string, Uint8Array]> = [];
    digests(fromXml, "$", xd);
    digests(fromBin, "$", bd);
    expect(bd.length).toBeGreaterThan(20);
    expect(xd.map(([p]) => p)).toEqual(bd.map(([p]) => p));
    for (let i = 0; i < bd.length; i++) {
      expect(xd[i][1]).toBeInstanceOf(Uint8Array);
      expect(bytesToHex(xd[i][1])).toBe(bytesToHex(bd[i][1]));
      expect([20, 48]).toContain(bd[i][1].length);
    }
  });

  it("agrees on the signature blobs and the scalar leaves", () => {
    const xs = (fromXml.CarrierBundleSignatures as any).Format1.signature3 as Uint8Array;
    const bs = (fromBin.CarrierBundleSignatures as any).Format1.signature3 as Uint8Array;
    expect(bs).toBeInstanceOf(Uint8Array);
    expect(bs.length).toBe(103);
    expect(bytesToHex(xs)).toBe(bytesToHex(bs));
    expect(bytesToHex(bs).startsWith("3065023100c72262401d858225ec8111")).toBe(true);
    expect(fromXml.iTunesMacVersion).toBe("12.8.1");
    expect(fromBin.iTunesMacVersion).toBe("12.8.1");
  });

  it("agrees on CountryBundles.iPhone.CountryId and BundleMappings", () => {
    const x = (fromXml.CountryBundles as any).iPhone;
    const b = (fromBin.CountryBundles as any).iPhone;
    expect(normalise(x.CountryId)).toEqual(normalise(b.CountryId));
    expect(normalise(x.BundleMappings)).toEqual(normalise(b.BundleMappings));
    expect(b.CountryId["310"]).toEqual({ BundleMapKey: "UnitedStates_Map" });
    expect(b.CountryId["com.apple.Australia"]).toEqual({ BundleMapKey: "Australia_Map" });
    expect(b.BundleMappings.Germany_Map["2"]).toEqual({
      BundleMatchEntry: "Germany_2",
      OS: { Min: "18.5" },
    });
  });
});

/* ====================================================================== */

describe("toJsonSafe", () => {
  it("tags Uint8Array as __data/__len/__text", () => {
    expect(toJsonSafe(U8(1, 2, 3))).toEqual({ __data: "010203", __len: 3, __text: undefined });
    expect(toJsonSafe(new Uint8Array(enc("hello world")))).toEqual({
      __data: "68656c6c6f20776f726c64",
      __len: 11,
      __text: "hello world",
    });
  });

  it("tags an empty Uint8Array with a zero length and no text", () => {
    expect(toJsonSafe(new Uint8Array())).toEqual({ __data: "", __len: 0, __text: undefined });
  });

  it("tags Date as __date with an ISO string", () => {
    expect(toJsonSafe(new Date("2024-01-02T03:04:05.678Z"))).toEqual({
      __date: "2024-01-02T03:04:05.678Z",
    });
  });

  it("passes scalars through unchanged", () => {
    expect(toJsonSafe(null)).toBeNull();
    expect(toJsonSafe(1.25)).toBe(1.25);
    expect(toJsonSafe("s")).toBe("s");
    expect(toJsonSafe(true)).toBe(true);
    expect(toJsonSafe(false)).toBe(false);
  });

  it("recurses through arrays and dicts", () => {
    const out = toJsonSafe({
      a: [1, "x", null, true, U8(0xde, 0xad)],
      b: { c: { d: new Uint8Array(enc("nested")) } },
      e: [],
      f: {},
    }) as any;
    expect(out.a[4]).toEqual({ __data: "dead", __len: 2, __text: undefined });
    expect(out.b.c.d).toEqual({ __data: "6e6573746564", __len: 6, __text: "nested" });
    expect(out.e).toEqual([]);
    expect(out.f).toEqual({});
    expect(JSON.parse(JSON.stringify(out)).a[0]).toBe(1);
  });

  it("produces output that survives JSON.stringify for a whole real bundle plist", () => {
    const parsed = parseBinaryPlist(member("ATT_US.ipcc", "carrier.plist"));
    const safe = toJsonSafe(parsed);
    const round = JSON.parse(JSON.stringify(safe));
    expect(round.CarrierName).toBe("AT&T");
    expect(round.OTAActivationAPN.signature).toEqual({ __data: "", __len: 0 });
  });
});

describe("bytesToHex", () => {
  it("emits two lowercase hex digits per byte", () => {
    expect(bytesToHex(new Uint8Array())).toBe("");
    expect(bytesToHex(U8(0, 1, 15, 16, 127, 255))).toBe("00010f107fff");
    expect(bytesToHex(new Uint8Array(300)).length).toBe(600);
  });

  it("works on a subarray view, not just a standalone buffer", () => {
    const backing = U8(9, 9, 1, 2, 3, 9);
    expect(bytesToHex(backing.subarray(2, 5))).toBe("010203");
  });
});

describe("maybeText", () => {
  it("returns undefined for empty input", () => {
    expect(maybeText(new Uint8Array())).toBeUndefined();
  });

  it("returns printable ASCII as-is", () => {
    expect(maybeText(new Uint8Array(enc("AB")))).toBe("AB");
    expect(maybeText(new Uint8Array(enc("hello world")))).toBe("hello world");
    expect(maybeText(new Uint8Array(enc(" !~")))).toBe(" !~");
  });

  it("allows tab, newline and carriage return", () => {
    expect(maybeText(new Uint8Array(enc("a\tb\nc\r\n")))).toBe("a\tb\nc\r\n");
  });

  it("returns undefined for any non-printable byte", () => {
    expect(maybeText(U8(0x61, 0x1f))).toBeUndefined();
    expect(maybeText(U8(0x61, 0x7f))).toBeUndefined();
    expect(maybeText(U8(0x61, 0xc3, 0xa9))).toBeUndefined();
    expect(maybeText(U8(0x00))).toBeUndefined();
    expect(maybeText(U8(0x61, 0x00, 0x62))).toBeUndefined();
    expect(maybeText(U8(0x61, 0x00, 0x62, 0x00))).toBeUndefined();
  });

  it("strips trailing NUL padding regardless of how much there is", () => {
    expect(maybeText(new Uint8Array([...enc("abcdefghij"), 0]))).toBe("abcdefghij");
    expect(maybeText(new Uint8Array([...enc("abcdefghi"), 0]))).toBe("abcdefghi");
    expect(maybeText(U8(0x61, 0x62, 0x00))).toBe("ab");
  });

  it("applies a 4096 byte cutoff inclusively", () => {
    expect(maybeText(new Uint8Array(4096).fill(0x41))).toBe("A".repeat(4096));
    expect(maybeText(new Uint8Array(4097).fill(0x41))).toBeUndefined();
  });
});

/* ====================================================================== */

describe("real .ipcc fixtures: binary plists", () => {
  it("parses UnitedStates carrier.plist with the values the bundle actually carries", () => {
    const p = parseBinaryPlist(member("UnitedStates.ipcc", "carrier.plist")) as any;
    expect(p.CountryName).toBe("United States of America");
    expect(p.ISOAlpha2CountryCode).toEqual(["us"]);
    expect(Object.keys(p).sort()).toEqual([
      "CellBroadcast",
      "CountryName",
      "EmergencyCalling",
      "IMSConfig",
      "ISOAlpha2CountryCode",
      "ShowVolteSwitch",
      "SupportedCountryIds",
      "SuppressSOSOnlyWithLimitedService",
    ]);
    expect(p.CellBroadcast.AlertTypes.Presidential.UserConfigurable).toBe(false);
    expect(p.CellBroadcast.MessageIDParameters3GPP).toHaveLength(9);
    expect(p.CellBroadcast.MessageIDParameters3GPP[0]).toEqual({
      FromServiceID: 4370,
      ToServiceID: 4370,
      AlertType: "Presidential",
      AlertConfiguration: "Configuration_us",
    });
    expect(p.CellBroadcast.AlertTypes.Emergency.EnabledByDefault).toBe(true);
    expect(p.CellBroadcast.DuplicateDetectionParameters.DuplicationWindowInMinutes).toBe(30);
  });

  it("parses Info.plist of a country bundle and a Watch bundle", () => {
    const us = parseBinaryPlist(member("UnitedStates.ipcc", "Info.plist")) as any;
    expect(us.CFBundleIdentifier).toBe("com.apple.UnitedStates");
    expect(us.CFBundleDeviceFamily).toBe("iPhone");
    expect(us.CFBundleShortVersionString).toBe("58.1.0");
    expect(us.CFBundleSignature).toBe("????");

    const watch = parseBinaryPlist(member("Australia_Watch.ipcc", "Info.plist")) as any;
    expect(watch.CFBundleIdentifier).toBe("com.apple.Australia");
    expect(watch.CFBundleDeviceFamily).toBe("Watch");
    expect(watch.CFBundleVersion).toBe("39.1");
  });

  it("parses signature blobs as raw data objects", () => {
    const sig = parseBinaryPlist(member("UnitedStates.ipcc", "signatures/common.plist")) as any;
    expect(Object.keys(sig).sort()).toEqual(["CBSignature2", "CBSignature3"]);
    expect(sig.CBSignature2).toBeInstanceOf(Uint8Array);
    expect(sig.CBSignature2.length).toBe(256);
    expect(sig.CBSignature3.length).toBe(103);
    expect(bytesToHex(sig.CBSignature3).startsWith("3065023100")).toBe(true);
  });

  it("decodes UTF-16BE strings out of localised .strings files", () => {
    const ar = parseBinaryPlist(member("ATT_US.ipcc", "ar.lproj/carrier.strings")) as any;
    expect(ar["Voice Connect_SERVICE_NAME"]).toBe("توصيل الصوت");
    expect(ar["AT&T MyAccount_MYACCOUNTURLTITLE"]).toBe("AT&T MyAccount");

    const bg = parseBinaryPlist(member("ATT_US.ipcc", "bg.lproj/carrier.strings")) as any;
    expect(bg["Voice Connect_SERVICE_NAME"]).toBe("Гласова връзка");

    const zh = parseBinaryPlist(member("ATT_US.ipcc", "zh_CN.lproj/carrier.strings")) as any;
    expect(zh["Pay My Bill_SERVICE_NAME"]).toBe("支付账单");
    expect(zh["Directory Assistance_SERVICE_NAME"]).toBe("查号台");

    const ja = parseBinaryPlist(member("ATT_US.ipcc", "ja.lproj/carrier.strings")) as any;
    expect(ja["Pay My Bill_SERVICE_NAME"]).toBe("料金を支払う");
  });

  it("gives every locale of one .strings file the same key set", () => {
    const opened = openIpcc(fixture("ATT_US.ipcc"));
    const paths = opened.info.files
      .map((f) => f.path)
      .filter((p) => p.endsWith(".lproj/carrier.strings"));
    expect(paths.length).toBeGreaterThan(30);
    const reference = Object.keys(
      parseBinaryPlist(opened.entries[opened.prefix + paths[0]]) as object,
    ).sort();
    expect(reference).toHaveLength(7);
    for (const p of paths) {
      const v = parseBinaryPlist(opened.entries[opened.prefix + p]) as Record<string, unknown>;
      expect(Object.keys(v).sort()).toEqual(reference);
      for (const val of Object.values(v)) expect(typeof val).toBe("string");
    }
  });

  it("decodes negative integers stored through the 8 byte signed path", () => {
    const p = parseBinaryPlist(member("Verizon_LTE_US.ipcc", "overrides_D23.plist")) as any;
    expect(p.IMSConfig.Signaling.SpamCallRiskLevels).toEqual({ high: -4, medium: -3, low: -2 });
    expect(p.IMSConfig.Signaling.ActivationBackoffTimerOverIWLANMilliseconds).toBe(3600000);
    expect(p.CarrierEntitlements.SupportedEntitlements).toBe(4238745);
  });

  it("decodes a 0x0f extended-length array out of a real bundle", () => {
    const p = parseBinaryPlist(member("Verizon_LTE_US.ipcc", "supported_devices.plist")) as any;
    expect(Object.keys(p).sort()).toEqual(["SupportedDevicesExactMatch", "SupportedSIMOverrides"]);
    expect(p.SupportedDevicesExactMatch).toHaveLength(31);
    expect(p.SupportedDevicesExactMatch[0]).toBe("D421");
    expect(p.SupportedDevicesExactMatch[30]).toBe("V159");
    expect(p.SupportedSIMOverrides["310590"].SupportedDevices).toHaveLength(14);
  });

  it("decodes a legacy 2009-era bundle", () => {
    const p = parseBinaryPlist(member("legacy_ATT_2009.ipcc", "carrier.plist")) as any;
    expect(p.CarrierName).toBe("AT&T");
    expect(p.SupportsNITZ).toBe(true);
    expect(p.MyAccountURL).toBe("https://www.wireless.att.com/my-account");
    expect(p.StockSymboli).toEqual([{ name: "AT&T", symbol: "T" }]);
    expect(p.BookmarkURLs).toEqual([
      { BookmarkURL: "https://www.wireless.att.com/my-account", BookmarkName: "AT&T MyAccount" },
    ]);
    expect(p.SupportedSIMs).toEqual([
      "310150",
      "310170",
      "310180",
      "310380",
      "310410",
      "310980",
      "311180",
    ]);
  });

  it("decodes an ERI table keyed by stringified numeric indices", () => {
    const p = parseBinaryPlist(member("Verizon_LTE_US.ipcc", "ERI.plist")) as any;
    expect(Object.keys(p).sort()).toEqual(["name", "roaming_indicator_table", "version"]);
    expect(p.name).toBe("Verizon Wireless");
    expect(p.version).toBe(8);
    expect(p.roaming_indicator_table["0"]).toEqual({
      alert_id: 1,
      is_home_system: false,
      icon_image_id: 1,
      icon_mode: 1,
      call_prompt_id: 1,
      character_encoding_type: 1,
      text: "Roaming",
      Data_Supported: false,
    });
    expect(p.roaming_indicator_table["1"].text).toBe("Verizon");
    expect(p.roaming_indicator_table["1"].is_home_system).toBe(true);
  });

  it("decodes an ATT bundle with an empty <data> leaf and 60+ top-level keys", () => {
    const p = parseBinaryPlist(member("ATT_US.ipcc", "carrier.plist")) as any;
    expect(p.CarrierName).toBe("AT&T");
    expect(Object.keys(p).length).toBe(61);
    expect(p.OTAActivationAPN.apn).toBe("LWAActivate");
    expect(p.OTAActivationAPN.signature).toBeInstanceOf(Uint8Array);
    expect(p.OTAActivationAPN.signature.length).toBe(0);
    expect(p.apns[0]).toEqual({ password: "", username: "", apn: "phone", "type-mask": 32775 });
  });

  it("decodes every binary plist in every fixture bundle without throwing", () => {
    const bundles = [
      "ATT_US.ipcc",
      "Verizon_LTE_US.ipcc",
      "UnitedStates.ipcc",
      "Germany.ipcc",
      "CW_pa.ipcc",
      "CW_wi.ipcc",
      "BhartiAirtel_in.ipcc",
      "legacy_ATT_2009.ipcc",
      "Australia_Watch.ipcc",
    ];
    let count = 0;
    for (const name of bundles) {
      const opened = openIpcc(fixture(name));
      for (const f of opened.info.files) {
        const bytes = opened.entries[opened.prefix + f.path];
        if (!bytes || bytes.length < 9) continue;
        const head = new TextDecoder().decode(bytes.subarray(0, 6));
        if (head !== "bplist") continue;
        const v = parsePlist(bytes);
        expect(v).not.toBeUndefined();
        expect(() => JSON.stringify(toJsonSafe(v))).not.toThrow();
        count++;
      }
    }
    expect(count).toBeGreaterThan(200);
  });
});

describe("real .ipcc fixtures: XML plists", () => {
  it("parses version.plist", () => {
    const v = parsePlist(member("UnitedStates.ipcc", "version.plist")) as any;
    expect(v).toEqual({
      BuildVersion: "1",
      CFBundleShortVersionString: "58.1.0",
      CFBundleVersion: "58.1",
      ProjectName: "CarrierBundles",
      SourceVersion: "3906002000000000",
    });
  });

  it("parses a locversion.plist out of a localisation folder", () => {
    const v = parsePlist(member("ATT_US.ipcc", "en.lproj/locversion.plist")) as any;
    expect(v).toEqual({
      LprojCompatibleVersion: "3479.90",
      LprojLocale: "en",
      LprojRevisionLevel: "1",
      LprojVersion: "3921.2",
    });
  });

  it("parses a .mobileconfig, an array of dicts followed by more keys", () => {
    const v = parsePlist(member("Verizon_LTE_US.ipcc", "profile.mobileconfig")) as any;
    expect(Object.keys(v).sort()).toEqual([
      "PayloadContent",
      "PayloadDisplayName",
      "PayloadIdentifier",
      "PayloadRemovalDisallowed",
      "PayloadType",
      "PayloadUUID",
      "PayloadVersion",
    ]);
    expect(Array.isArray(v.PayloadContent)).toBe(true);
    expect(v.PayloadContent.length).toBeGreaterThan(1);
    const first = v.PayloadContent[0];
    expect(first.SSID_STR).toBe("VerizonWiFiAccess");
    expect(first.AutoJoin).toBe(true);
    expect(first.HIDDEN_NETWORK).toBe(false);
    expect(first.PayloadVersion).toBe(1);
    expect(first.EAPClientConfiguration).toEqual({
      AcceptEAPTypes: [23],
      EAPSIMAKAEncryptedIdentityEnabled: true,
    });
    expect(v.PayloadContent[1].SSID_STR).toBe("PrivateMobileWiFi");
    // Keys after the array must survive the array's terminator.
    expect(v.PayloadType).toBe("Configuration");
  });

  it("parses every XML plist in every fixture bundle without throwing", () => {
    const bundles = [
      "ATT_US.ipcc",
      "Verizon_LTE_US.ipcc",
      "UnitedStates.ipcc",
      "Germany.ipcc",
      "CW_pa.ipcc",
      "CW_wi.ipcc",
      "BhartiAirtel_in.ipcc",
      "legacy_ATT_2009.ipcc",
      "Australia_Watch.ipcc",
    ];
    let count = 0;
    for (const name of bundles) {
      const opened = openIpcc(fixture(name));
      for (const f of opened.info.files) {
        const bytes = opened.entries[opened.prefix + f.path];
        if (!bytes || bytes.length < 9) continue;
        const head = new TextDecoder().decode(bytes.subarray(0, 16));
        if (!/^\s*<(\?xml|!DOCTYPE|plist)/.test(head)) continue;
        const v = parsePlist(bytes);
        expect(v === null || typeof v === "object").toBe(true);
        count++;
      }
    }
    expect(count).toBeGreaterThan(100);
  });
});

/* ====================================================================== */

describe("recovery paths that used to abort the document", () => {
  // parseXmlPlist used to build an Invalid Date from <date>garbage</date>, which
  // toJsonSafe could not serialise. Unparseable dates now stay as their text.
  it("keeps an unparseable date as text so toJsonSafe can serialise it", () => {
    const v = parseXmlPlist("<plist><dict><key>d</key><date>not a date</date></dict></plist>");
    expect((v as Record<string, unknown>).d).toBe("not a date");
    expect(() => toJsonSafe(v)).not.toThrow();
    expect(toJsonSafe(v)).toEqual({ d: "not a date" });
  });

  it("tags a genuinely Invalid Date rather than throwing", () => {
    expect(toJsonSafe(new Date("nope"))).toEqual({ __date: "invalid date" });
  });

  // maybeText used to reject any buffer with a NUL that was not the final byte,
  // which is the normal shape of a fixed-width padded field.
  it("decodes ASCII padded with more than one trailing NUL", () => {
    expect(maybeText(new Uint8Array([...enc("hello world"), 0, 0]))).toBe("hello world");
    expect(maybeText(new Uint8Array([...enc("ab"), 0, 0, 0, 0]))).toBe("ab");
    expect(maybeText(new Uint8Array([0, 0, 0]))).toBeUndefined();
  });

  // An out-of-range numeric character reference used to throw RangeError and
  // abort the whole document; it is now left literal like an unknown entity.
  it("leaves an out-of-range numeric character reference literal", () => {
    expect(parseXmlPlist("<plist><string>&#x110000;</string></plist>")).toBe("&#x110000;");
    expect(parseXmlPlist("<plist><string>&#99999999;</string></plist>")).toBe("&#99999999;");
    expect(parseXmlPlist("<plist><string>a&#x41;b</string></plist>")).toBe("aAb");
  });

  // Malformed base64 in one <data> leaf used to throw a DOMException from atob
  // and kill the entire document.
  it("recovers from malformed base64 inside <data>", () => {
    expect(() => parseXmlPlist("<plist><data>Q</data></plist>")).not.toThrow();
    expect(parseXmlPlist("<plist><data>Q</data></plist>")).toEqual(new Uint8Array());
    expect(() => parseXmlPlist("<plist><data>QUJD=QQ==</data></plist>")).not.toThrow();
    // A bad leaf must not take the surrounding document with it.
    const v = parseXmlPlist(
      "<plist><dict><key>bad</key><data>Q</data><key>good</key><string>kept</string></dict></plist>",
    ) as Record<string, unknown>;
    expect(v.good).toBe("kept");
  });

  it("still decodes padded and unpadded valid base64", () => {
    expect(parseXmlPlist("<plist><data>QUJD</data></plist>")).toEqual(new Uint8Array([65, 66, 67]));
    expect(parseXmlPlist("<plist><data>QUJ</data></plist>")).toEqual(new Uint8Array([65, 66]));
    expect(parseXmlPlist("<plist><data>QQ==</data></plist>")).toEqual(new Uint8Array([65]));
  });
});
