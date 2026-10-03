// The LZFSE decoder against Apple's reference encoder (github.com/lzfse/lzfse,
// `lzfse -encode`), one fixture per block kind it writes. The inputs are
// regenerated here; only the encoder's output is checked in.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LzfseError, lzfseDecode } from "../src/jobs/ios/shared/lzfse.ts";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/ios/${name}.lzfse`, import.meta.url)));
const enc = new TextEncoder();

/** plist-ish text: repetitive enough for matches, varied enough for real FSE tables. */
function text(n: number): Uint8Array {
  let s = "";
  for (let i = 0; s.length < n; i++) s += `<key>Entry${i % 97}</key><integer>${(i * 7919) % 100003}</integer>\n`;
  return enc.encode(s.slice(0, n));
}

/** A 32-bit LCG's top bytes: incompressible, so nearly everything is a literal. */
function noise(n: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = 1;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

describe("lzfseDecode", () => {
  it.each([
    ["v2", text(20000), "bvx2"],
    ["lzvn", text(3000), "bvxn"],
    ["raw", enc.encode("abcde"), "bvx-"],
    ["noise", noise(9000), "bvx2"],
  ] as const)("decodes %s blocks", (name, plain, magic) => {
    const z = fixture(name);
    expect(new TextDecoder().decode(z.subarray(0, 4))).toBe(magic);
    expect(lzfseDecode(z, plain.length)).toEqual(plain);
  });

  it("refuses a stream that decodes to another size", () => {
    expect(() => lzfseDecode(fixture("v2"), 19999)).toThrow(LzfseError);
    expect(() => lzfseDecode(fixture("raw"), 6)).toThrow(LzfseError);
  });

  it("refuses a truncated stream", () => {
    const z = fixture("v2");
    expect(() => lzfseDecode(z.subarray(0, z.length - 100), 20000)).toThrow(LzfseError);
  });

  it("refuses an unknown block", () => {
    expect(() => lzfseDecode(enc.encode("bvxZ\0\0\0\0"), 0)).toThrow(/unknown block magic/);
  });
});
