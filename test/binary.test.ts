/** src/lib/binary: bounds-checked reads, varints, encodings and digests. */

import { describe, expect, it } from "vitest";
import {
  b64ToBytes, base64ToBytes, BitReader, BoundsError, bytesToBase64, bytesToHex, EncodingError, hexToBytes,
  readVarint, safeU64le, sha1Hex, sha256Hex, u16be, u16le, u32be, u32le, u64le, VarintError,
} from "../src/lib/binary/index.ts";

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

describe("encodings", () => {
  it("round-trips hex and base64", () => {
    const b = new Uint8Array([0, 1, 0xab, 0xff]);
    expect(bytesToHex(b)).toBe("0001abff");
    expect(hexToBytes("0001ABff")).toEqual(b);
    expect(bytesToBase64(b)).toBe("AAGr/w==");
    expect(base64ToBytes("AAGr/w==")).toEqual(b);
  });

  it("is strict where it says so and lenient where it says so", () => {
    expect(() => hexToBytes("abc")).toThrow(EncodingError);
    expect(() => base64ToBytes("AA G")).toThrow(EncodingError);
    expect(b64ToBytes(" AAGr\n/w ")).toEqual(new Uint8Array([0, 1, 0xab, 0xff]));
  });
});

describe("digests", () => {
  it("hashes like the standards", async () => {
    const abc = new TextEncoder().encode("abc");
    expect(await sha256Hex(abc)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha1Hex(abc)).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1Hex(new Uint8Array(1000).fill(0x61))).toBe("291e9a6c66994949b57ba5e650361e98fc36b1ba");
  });
});

describe("BitReader", () => {
  it("reads MSB first", () => {
    const r = new BitReader(new Uint8Array([0b1010_0000, 0xff]));
    expect(r.u(3)).toBe(0b101);
    r.align();
    expect(r.hex(8)).toBe("ff");
    expect(() => r.u(1)).toThrow(RangeError);
  });
});
