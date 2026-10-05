/** binary: bounds-checked reads, varints, encodings and digests. */

import { describe, expect, it } from "vitest";
import {
  b64ToBytes, base64ToBytes, base64UrlToBytes, BitReader, BoundsError, bytesToBase64, bytesToHex, concatBytes, crc32,
  decodeLz4Block, errorMessage, hexToBytes, Lz4Error,
  packedVarints, ProtobufError, safeU64le, sha1Hex, sha256Hex, sha384Hex, u16be, u16le, u32be, u32le, u64le,
  wireFields,
} from "../src/index.ts";
import { EncodingError } from "../src/text.ts";
import { readVarint, VarintError } from "../src/varint.ts";

describe("fixed-width reads", () => {
  const b = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0xff]);

  it("reads both byte orders, also from a subarray", () => {
    expect(u16le(b, 0)).toBe(0x0201);
    expect(u16be(b, 0)).toBe(0x0102);
    expect(u32le(b, 0)).toBe(0x04030201);
    expect(u32be(b.subarray(1), 0)).toBe(0x02030405);
    expect(u64le(b, 0)).toBe(0x0807060504030201n);
    expect(safeU64le(new Uint8Array([1, 2, 0, 0, 0, 0, 0, 0]), 0)).toBe(0x0201);
  });

  it("throws BoundsError past the end and RangeError past 2^53", () => {
    expect(() => u32le(b, 6)).toThrow(BoundsError);
    expect(() => u16le(b, -1)).toThrow(BoundsError);
    expect(() => safeU64le(new Uint8Array(8).fill(0xff), 0)).toThrow(RangeError);
  });
});

describe("readVarint", () => {
  it("reads LEB128 up to 64 bits", () => {
    expect(readVarint(new Uint8Array([0xac, 0x02]), 0)).toEqual({ value: 300n, next: 2 });
    const minusOne = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
    expect(readVarint(minusOne, 0).value).toBe(0xffff_ffff_ffff_ffffn);
  });

  it("rejects truncated and overlong varints", () => {
    expect(() => readVarint(new Uint8Array([0x80]), 0)).toThrow(BoundsError);
    expect(() => readVarint(new Uint8Array(11).fill(0x80), 0)).toThrow(VarintError);
  });
});

describe("wireFields", () => {
  // field 1 varint 150, field 2 bytes "hi", field 3 fixed32, field 4 fixed64, field 5 packed [3, 270]
  const msg = new Uint8Array([
    0x08, 0x96, 0x01, 0x12, 0x02, 0x68, 0x69, 0x1d, 1, 2, 3, 4, 0x21, 1, 2, 3, 4, 5, 6, 7, 8, 0x2a, 0x03, 0x03, 0x8e, 0x02,
  ]);

  it("reads every wire type, keyed by field and wire", () => {
    const fields = [...wireFields(msg)];
    expect(fields.map((f) => f.key)).toEqual(["1:varint", "2:bytes", "3:fixed32", "4:fixed64", "5:bytes"]);
    expect(fields[0]?.value).toBe(150n);
    expect(fields[2]?.value).toEqual(new Uint8Array([1, 2, 3, 4]));
    const packed = fields[4];
    expect(packed?.wire === "bytes" && packedVarints(packed.value)).toEqual([3n, 270n]);
  });

  it("rejects field 0, groups and lengths past the end", () => {
    expect(() => [...wireFields(new Uint8Array([0x00, 0x01]))]).toThrow(ProtobufError);
    expect(() => [...wireFields(new Uint8Array([0x0b]))]).toThrow(expect.objectContaining({ offset: 0 }));
    expect(() => [...wireFields(new Uint8Array([0x12, 0x05, 0x68]))]).toThrow(BoundsError);
  });
});

describe("encodings", () => {
  it("writes hex and round-trips base64", () => {
    const b = new Uint8Array([0, 1, 0xab, 0xff]);
    expect(bytesToHex(b)).toBe("0001abff");
    expect(bytesToBase64(b)).toBe("AAGr/w==");
    expect(base64ToBytes("AAGr/w==")).toEqual(b);
    expect(hexToBytes("0001ABff")).toEqual(b);
  });

  it("is strict where it says so and lenient where it says so", () => {
    expect(() => base64ToBytes("AA G")).toThrow(EncodingError);
    expect(b64ToBytes(" AAGr\n/w ")).toEqual(new Uint8Array([0, 1, 0xab, 0xff]));
    expect(b64ToBytes("AAGr/")).toEqual(new Uint8Array([0, 1, 0xab]));
    expect(() => hexToBytes("abc")).toThrow(EncodingError);
    expect(() => hexToBytes("zz")).toThrow(EncodingError);
  });
});

describe("errorMessage", () => {
  it("reads an Error's message and stringifies anything else", () => {
    expect(errorMessage(new TypeError("bad"))).toBe("bad");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("digests", () => {
  it("hashes like the standards", async () => {
    const abc = new TextEncoder().encode("abc");
    expect(await sha256Hex(abc)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha384Hex(abc)).toBe("cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7");
    expect(sha1Hex(abc)).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1Hex(new Uint8Array(1000).fill(0x61))).toBe("291e9a6c66994949b57ba5e650361e98fc36b1ba");
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("BitReader", () => {
  it("reads MSB first", () => {
    const r = new BitReader(new Uint8Array([0b1010_0000, 0xff]));
    expect(r.u(3)).toBe(0b101);
    r.skip(5);
    expect(r.hex(8)).toBe("ff");
    expect(() => r.u(1)).toThrow(RangeError);
  });
});

describe("base64url and concatBytes", () => {
  it("reads JWK-style base64url, with or without padding", () => {
    expect([...base64UrlToBytes("-_8")]).toEqual([0xfb, 0xff]);
    expect([...base64UrlToBytes("-_8=")]).toEqual([0xfb, 0xff]);
    expect(() => base64UrlToBytes("+/8")).toThrow(EncodingError);
  });

  it("joins buffers end to end", () => {
    expect([...concatBytes([new Uint8Array([1]), new Uint8Array(0), new Uint8Array([2, 3])])]).toEqual([1, 2, 3]);
  });
});

describe("decodeLz4Block", () => {
  const ascii = (t: string): Uint8Array => new TextEncoder().encode(t);

  it("copies literals and overlapping matches, with extended lengths", () => {
    // 3 literals, then offset 1 for 4 + 15 + 2 bytes; then 18 literals (15 + 3) end the block.
    const tail = "0123456789abcdefgh";
    const block = new Uint8Array([0x3f, ...ascii("abc"), 1, 0, 2, 0xf0, 3, ...ascii(tail)]);
    expect(new TextDecoder().decode(decodeLz4Block(block, 3 + 21 + 18))).toBe(`abc${"c".repeat(21)}${tail}`);
  });

  it("rejects offsets before the output and sizes that do not match", () => {
    expect(() => decodeLz4Block(new Uint8Array([0x10, 0x61, 2, 0, 0x00]), 10)).toThrow(Lz4Error);
    expect(() => decodeLz4Block(new Uint8Array([0x10, 0x61, 2, 0, 0x00]), 10)).toThrow(/offset 2/);
    expect(() => decodeLz4Block(new Uint8Array([0x20, 0x61, 0x62]), 3)).toThrow(/gives 2 bytes, not 3/);
  });
});
