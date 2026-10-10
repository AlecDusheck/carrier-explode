import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
	parsePlist,
	parseXmlPlist,
	parseBinaryPlist,
	toJsonSafe,
	isPlistDict,
	PlistUid,
	type PlistValue,
} from "../src/plist.ts";
import { bytesToHex } from "@carrier-explode/binary";
import { openIpcc } from "../src/bundle.ts";
import { array, defined, record } from "./defined.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", n)));

/** Raw bytes of one member of an .ipcc, straight out of the ZIP. */
const member = (ipcc: string, path: string): Uint8Array => openIpcc(fixture(ipcc)).read(path);

const enc = (s: string) => Array.from(new TextEncoder().encode(s));
const U8 = (...b: number[]) => new Uint8Array(b);
const repeat = (count: number, byte: number): number[] => Array.from({ length: count }, () => byte);

function date(v: PlistValue): Date {
	if (!(v instanceof Date)) throw new Error("expected a date");
	return v;
}

/**
 * A minimal bplist00 writer, so every binary object type can be exercised
 * directly. `objects` holds already-encoded object bodies; refs inside them
 * are plain object-table indices written at `objectRefSize` bytes.
 */

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

	it("decodes 16 byte integers as exact signed 128-bit values", () => {
		expect(bp([[0x14, ...repeat(8, 0), 0, 0, 0, 0, 0, 0, 0, 5]])).toBe(5);
		expect(bp([[0x14, ...repeat(8, 0), 0, 0, 0, 0, 0x7f, 0xff, 0xff, 0xff]])).toBe(2147483647);
		// CF's encoding of a UInt64 above INT64_MAX: high half zero.
		expect(bp([[0x14, ...repeat(8, 0), ...repeat(8, 0xff)]])).toBe(0xffffffffffffffffn);
		expect(bp([[0x14, ...repeat(16, 0xff)]])).toBe(-1);
		expect(bp([[0x14, 0, 0, 0, 0, 0, 0, 0, 1, ...repeat(8, 0)]])).toBe(1n << 64n);
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
		const epoch = date(bp([[0x33, ...f64(0)]]));
		expect(epoch).toBeInstanceOf(Date);
		expect(epoch.toISOString()).toBe("2001-01-01T00:00:00.000Z");
		expect(date(bp([[0x33, ...f64(700000000)]])).toISOString()).toBe("2023-03-08T20:26:40.000Z");
		expect(date(bp([[0x33, ...f64(-978307200)]])).toISOString()).toBe("1970-01-01T00:00:00.000Z");
		expect(date(bp([[0x33, ...f64(1.5)]])).toISOString()).toBe("2001-01-01T00:00:01.500Z");
	});

	it("decodes data blobs, including the zero-length form", () => {
		expect(bp([[0x43, 1, 2, 3]])).toEqual(U8(1, 2, 3));
		expect(bp([[0x40]])).toEqual(new Uint8Array());
		expect(bp([[0x4e, ...repeat(14, 0xab)]])).toEqual(new Uint8Array(14).fill(0xab));
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

	it("decodes UIDs as PlistUid, sized by the low nibble plus one", () => {
		expect(bp([[0x80, 0x2a]])).toEqual(new PlistUid(42));
		expect(bp([[0x80, 0x2a]])).toBeInstanceOf(PlistUid);
		expect(bp([[0x81, 0x01, 0x00]])).toEqual(new PlistUid(256));
		expect(bp([[0x83, 0x00, 0x00, 0x01, 0x00]])).toEqual(new PlistUid(256));
		expect(bp([[0x87, 0, 0, 0, 0, 0, 0, 0, 1]])).toEqual(new PlistUid(1));
		expect(toJsonSafe(bp([[0x80, 0x2a]]))).toEqual({ __uid: 42 });
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
		expect(
			bp([
				[0xc2, 1, 2],
				[0x51, 0x61],
				[0x51, 0x62],
			]),
		).toEqual(["a", "b"]);
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
		expect(
			bp([
				[0xd1, 1, 2],
				[0x10, 5],
				[0x53, ...enc("abc")],
			]),
		).toEqual({ "5": "abc" });
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
		expect(bp([[0x4f, 0x10, 20, ...repeat(20, 7)]])).toEqual(new Uint8Array(20).fill(7));
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
		const out = record(bp(objs));
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
		const objs: number[][] = [
			[0xa2, 1, 2],
			[0x51, 0x78],
			[0x10, 3],
		];
		for (const offsetIntSize of [1, 2, 4, 8]) {
			expect(bp(objs, 0, { offsetIntSize })).toEqual(["x", 3]);
		}
	});

	it("handles 2 byte object references", () => {
		const objs: number[][] = [
			[0xa2, 0, 1, 0, 2],
			[0x10, 7],
			[0x10, 8],
		];
		expect(bp(objs, 0, { objectRefSize: 2 })).toEqual([7, 8]);
	});

	it("honours a topObject other than zero", () => {
		expect(bp([[0x51, 0x61], [0x10, 9], [0x09]], 1)).toBe(9);
		expect(bp([[0x51, 0x61], [0x10, 9], [0x09]], 2)).toBe(true);
	});

	it("returns the identical cached instance when one object is referenced twice", () => {
		const strs = array(
			bp([
				[0xa2, 1, 1],
				[0x53, ...enc("dup")],
			]),
		);
		expect(strs).toEqual(["dup", "dup"]);

		const arrays = array(
			bp([
				[0xa2, 1, 1],
				[0xa1, 2],
				[0x10, 9],
			]),
		);
		expect(arrays).toEqual([[9], [9]]);
		expect(arrays[0]).toBe(arrays[1]);

		const dicts = record(
			bp([
				[0xd2, 1, 2, 3, 3],
				[0x51, 0x61],
				[0x51, 0x62],
				[0xd1, 4, 5],
				[0x51, 0x6b],
				[0x10, 1],
			]),
		);
		expect(dicts).toEqual({ a: { k: 1 }, b: { k: 1 } });
		expect(dicts.a).toBe(dicts.b);
	});

	it("decodes deeply nested containers up to the depth guard", () => {
		const depth = 60;
		const objs: number[][] = [];
		for (let i = 0; i < depth; i++) objs.push([0xa1, i + 1]);
		objs.push([0x10, 99]);
		let cur = bp(objs);
		let seen = 0;
		while (Array.isArray(cur)) {
			cur = cur[0] ?? null;
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
		expect(() =>
			bp([
				[0xa1, 1],
				[0xa1, 0],
			]),
		).toThrow(/nested too deep/);
		expect(() => bp([[0xa1, 0]])).toThrow(/nested too deep/);
	});
});

/** Asserts the call terminates, either by throwing an Error or returning something. */
function survives(fn: () => unknown): void {
	try {
		fn();
	} catch (e) {
		expect(e).toBeInstanceOf(Error);
		if (e instanceof Error) expect(typeof e.message).toBe("string");
	}
}

describe("binary plist: malformed and hostile input", () => {
	const real = fixture("manifest.bplist");

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
		expect(() => parseBinaryPlist(buildBplist([[0x10, 1]], 0, { offsetTableOffset: 1_000_000 }))).toThrow(
			RangeError,
		);
	});

	it("does not hang on nonsense trailer field sizes", () => {
		survives(() => parseBinaryPlist(buildBplist([[0x10, 1]], 0, { offsetIntSize: 0 })));
		survives(() =>
			parseBinaryPlist(
				buildBplist(
					[
						[0xa2, 1, 2],
						[0x10, 1],
						[0x10, 2],
					],
					0,
					{ objectRefSize: 0 },
				),
			),
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
		// XML spells a hex reference with a lowercase x only.
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
		expect(parseXmlPlist("<plist><dict><key>&#x41;&#66;</key><string>v</string></dict></plist>")).toEqual({
			AB: "v",
		});
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
		expect(parseXmlPlist("<plist><data>\t\tQ\tU\tJ\tD\t</data></plist>")).toEqual(new Uint8Array(enc("ABC")));
		expect(parseXmlPlist("<plist><data></data></plist>")).toEqual(new Uint8Array());
		expect(parseXmlPlist("<plist><data>   </data></plist>")).toEqual(new Uint8Array());
	});

	it("parses <date> through the Date constructor", () => {
		const d = date(parseXmlPlist("<plist><date>2024-03-05T06:07:08Z</date></plist>"));
		expect(d).toBeInstanceOf(Date);
		expect(d.toISOString()).toBe("2024-03-05T06:07:08.000Z");
		// An unparseable date stays as its text so the value remains serialisable.
		expect(parseXmlPlist("<plist><date>not-a-date</date></plist>")).toBe("not-a-date");
	});

	it("parses decimal and 0x-hex <integer> and falls back to 0 on garbage", () => {
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
		).toEqual([12, -7, 0, 16, 0]);
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
			parseXmlPlist(
				`<plist version="1.0"><dict><key >a</key ><string xml:space="preserve">v</string></dict></plist>`,
			),
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

	it("handles a four-deep alternation ending in a scalar tail", () => {
		expect(
			parseXmlPlist(
				"<plist><dict><key>a</key><array><dict><key>b</key><array><dict><key>c</key><string>deep</string></dict></array></dict></array><key>tail</key><true/></dict></plist>",
			),
		).toEqual({ a: [{ b: [{ c: "deep" }] }], tail: true });
	});

	it("does not merge consecutive empty dicts in an array", () => {
		expect(
			parseXmlPlist("<plist><array><dict></dict><dict></dict><string>x</string></array></plist>"),
		).toEqual([{}, {}, "x"]);
		expect(parseXmlPlist("<plist><array><dict/><array/><string>x</string></array></plist>")).toEqual([
			{},
			[],
			"x",
		]);
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
		// Unlike <dict>/<array>, the <plist> branch does not skip stray closes,
		// so this degrades to null rather than recovering the dict. It must not throw.
		expect(() =>
			parseXmlPlist("<plist></array><dict><key>a</key><string>v</string></dict></plist>"),
		).not.toThrow();
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
			parseXmlPlist(
				"<plist><dict><key>a</key><string>x</string><foo>bar</foo><key>b</key><string>y</string></dict></plist>",
			),
		).toEqual({ a: "x", b: "y" });
		expect(
			parseXmlPlist("<plist><dict><key>a</key><foo>bar</foo><key>b</key><string>y</string></dict></plist>"),
		).toEqual({ a: null, b: "y" });
	});

	it("lets a later duplicate key win", () => {
		expect(
			parseXmlPlist(
				"<plist><dict><key>a</key><string>1</string><key>a</key><string>2</string></dict></plist>",
			),
		).toEqual({ a: "2" });
	});

	it("tolerates unterminated comments and CDATA sections", () => {
		expect(parseXmlPlist("<plist><string>a</string><!-- never closed")).toBe("a");
		expect(parseXmlPlist("<plist><string><![CDATA[abc</plist>")).toBe("abc</plist>");
	});

	it("returns null for input that is not XML at all", () => {
		expect(parseXmlPlist("not xml at all just text")).toBeNull();
		expect(parseXmlPlist('{"json": true}')).toBeNull();
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
		let cur = parseXmlPlist(xml);
		let depth = 0;
		while (Array.isArray(cur)) {
			cur = cur[0] ?? null;
			depth++;
		}
		expect(depth).toBe(n);
		expect(cur).toBe("x");
	});

	it("finishes quickly on a pathological entity-heavy string", () => {
		const xml = "<plist><string>" + "&amp;".repeat(50000) + "</string></plist>";
		const started = Date.now();
		expect(parseXmlPlist(xml)).toHaveLength(50000);
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

/**
 * Normalises a parsed plist for cross-format comparison: binary blobs become
 * `hex:<...>` and dates become their ISO string. Everything else keeps its
 * exact shape so structural differences still fail the comparison.
 */
function normalise(v: PlistValue): unknown {
	if (v instanceof Uint8Array) return `hex:${bytesToHex(v)}`;
	if (v instanceof Date) return `date:${v.getTime()}`;
	if (Array.isArray(v)) return v.map(normalise);
	if (isPlistDict(v)) {
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(v).toSorted()) out[k] = normalise(defined(v[k]));
		return out;
	}
	return v;
}

describe("cross-format equivalence: manifest.xml vs manifest.bplist", () => {
	it("produces deeply identical documents once data and dates are normalised", () => {
		expect(normalise(parsePlist(fixture("manifest.xml")))).toEqual(
			normalise(parsePlist(fixture("manifest.bplist"))),
		);
	});
});

describe("integer precision", () => {
	it("keeps 64-bit ints beyond 2^53 exact as bigint", () => {
		expect(bp([[0x13, ...i64(9007199254740992n)]])).toBe(9007199254740992n);
		expect(bp([[0x13, ...i64(9223372036854775807n)]])).toBe(9223372036854775807n);
		expect(bp([[0x13, ...i64(-9223372036854775808n)]])).toBe(-9223372036854775808n);
		expect(bp([[0x13, ...i64(-9007199254740991n)]])).toBe(-9007199254740991);
		expect(bp([[0x13, ...i64(-9007199254740992n)]])).toBe(-9007199254740992n);
	});

	it("keeps XML <integer> values beyond 2^53 exact, in decimal and hex", () => {
		expect(
			parseXmlPlist(
				"<plist><array>" +
					"<integer>9007199254740991</integer>" +
					"<integer>9007199254740993</integer>" +
					"<integer>-18446744073709551615</integer>" +
					"<integer>0xFFFFFFFFFFFFFFFF</integer>" +
					"<integer>+5</integer>" +
					"</array></plist>",
			),
		).toEqual([9007199254740991, 9007199254740993n, -18446744073709551615n, 18446744073709551615n, 5]);
	});

	it("serialises big ints as { __int } strings and leaves safe ints as numbers", () => {
		const v: PlistValue = { big: 12345678901234567890n, small: 7, uid: new PlistUid(3), list: [1n << 70n] };
		const out = toJsonSafe(v);
		expect(out).toEqual({
			big: { __int: "12345678901234567890" },
			small: 7,
			uid: { __uid: 3 },
			list: [{ __int: "1180591620717411303424" }],
		});
		expect(() => JSON.stringify(out)).not.toThrow();
	});

	it("round-trips a bigint through a hand-built bplist dict", () => {
		const d = record(
			bp([
				[0xd1, 1, 2],
				[0x51, 0x6b],
				[0x13, ...i64(-(1n << 60n))],
			]),
		);
		expect(d.k).toBe(-(1n << 60n));
	});
});

describe("toJsonSafe", () => {
	it("tags data and dates, recursing through arrays and dicts", () => {
		const at = "2024-01-02T03:04:05.678Z";
		expect(
			toJsonSafe({ a: [1, null, U8(0xde, 0xad)], b: { d: new Uint8Array(enc("nested")), t: new Date(at) } }),
		).toEqual({
			a: [1, null, { __data: "dead", __len: 2, __text: undefined }],
			b: { d: { __data: "6e6573746564", __len: 6, __text: "nested" }, t: { __date: at } },
		});
	});

	it("produces output that survives JSON.stringify for a whole real bundle plist", () => {
		const parsed = parseBinaryPlist(member("carrier-att.ipcc", "carrier.plist"));
		const safe = toJsonSafe(parsed);
		const round = JSON.parse(JSON.stringify(safe));
		expect(round.CarrierName).toBe("AT&T");
		expect(round.OTAActivationAPN.signature).toEqual({ __data: "", __len: 0 });
	});
});

describe("real .ipcc fixtures", () => {
	it("decodes UTF-16BE strings out of localised .strings files", () => {
		expect(parseBinaryPlist(member("carrier-att.ipcc", "ar.lproj/carrier.strings"))).toMatchObject({
			"Voice Connect_SERVICE_NAME": "توصيل الصوت",
			"AT&T MyAccount_MYACCOUNTURLTITLE": "AT&T MyAccount",
		});
		expect(parseBinaryPlist(member("carrier-att.ipcc", "zh_CN.lproj/carrier.strings"))).toMatchObject({
			"Pay My Bill_SERVICE_NAME": "支付账单",
			"Directory Assistance_SERVICE_NAME": "查号台",
		});
	});

	it("decodes negative integers stored through the 8 byte signed path", () => {
		expect(parseBinaryPlist(member("carrier-verizon.ipcc", "overrides_D23.plist"))).toMatchObject({
			IMSConfig: {
				Signaling: {
					SpamCallRiskLevels: { high: -4, medium: -3, low: -2 },
					ActivationBackoffTimerOverIWLANMilliseconds: 3600001,
				},
			},
			CarrierEntitlements: { SupportedEntitlements: 4238745 },
		});
	});

	it("parses an XML .mobileconfig, an array of dicts followed by more keys", () => {
		const v = parsePlist(member("carrier-verizon.ipcc", "profile.mobileconfig"));
		expect(v).toHaveProperty(
			["PayloadContent", 0],
			expect.objectContaining({
				SSID_STR: "VerizonWiFiAccess",
				AutoJoin: true,
				HIDDEN_NETWORK: false,
				PayloadVersion: 1,
				EAPClientConfiguration: { AcceptEAPTypes: [23], EAPSIMAKAEncryptedIdentityEnabled: true },
			}),
		);
		expect(v).toHaveProperty(["PayloadContent", 1, "SSID_STR"], "PrivateMobileWiFi");
		// Keys after the array must survive the array's terminator.
		expect(v).toHaveProperty("PayloadType", "Configuration");
	});
});

describe("recovery paths that used to abort the document", () => {
	// An Invalid Date from <date>garbage</date> could not be serialised by toJsonSafe.
	it("keeps an unparseable date as text so toJsonSafe can serialise it", () => {
		const v = parseXmlPlist("<plist><dict><key>d</key><date>not a date</date></dict></plist>");
		expect(record(v).d).toBe("not a date");
		expect(() => toJsonSafe(v)).not.toThrow();
		expect(toJsonSafe(v)).toEqual({ d: "not a date" });
	});

	it("tags a genuinely Invalid Date rather than throwing", () => {
		expect(toJsonSafe(new Date("nope"))).toEqual({ __date: "invalid date" });
	});

	// An out-of-range numeric character reference is left literal, like an unknown entity.
	it("leaves an out-of-range numeric character reference literal", () => {
		expect(parseXmlPlist("<plist><string>&#x110000;</string></plist>")).toBe("&#x110000;");
		expect(parseXmlPlist("<plist><string>&#99999999;</string></plist>")).toBe("&#99999999;");
		expect(parseXmlPlist("<plist><string>a&#x41;b</string></plist>")).toBe("aAb");
	});

	// atob throws a DOMException on malformed base64; one <data> leaf must not take the document with it.
	it("recovers from malformed base64 inside <data>", () => {
		expect(() => parseXmlPlist("<plist><data>Q</data></plist>")).not.toThrow();
		expect(parseXmlPlist("<plist><data>Q</data></plist>")).toEqual(new Uint8Array());
		expect(() => parseXmlPlist("<plist><data>QUJD=QQ==</data></plist>")).not.toThrow();
		// A bad leaf must not take the surrounding document with it.
		const v = record(
			parseXmlPlist(
				"<plist><dict><key>bad</key><data>Q</data><key>good</key><string>kept</string></dict></plist>",
			),
		);
		expect(v.good).toBe("kept");
	});

	it("still decodes padded and unpadded valid base64", () => {
		expect(parseXmlPlist("<plist><data>QUJD</data></plist>")).toEqual(new Uint8Array([65, 66, 67]));
		expect(parseXmlPlist("<plist><data>QUJ</data></plist>")).toEqual(new Uint8Array([65, 66]));
		expect(parseXmlPlist("<plist><data>QQ==</data></plist>")).toEqual(new Uint8Array([65]));
	});
});
