// AEA decryption and Apple's key metadata. os-image.aea.head is the real header of iOS 27.0.1's OS image
// (iPhone17,1_27.0.1_24A446_Restore.ipsw, member 043-70165-666.dmg.aea).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { openAea, parseAeaHeader } from "../src/aea/aea.ts";
import { ByteQueue } from "../src/aea/byte-queue.ts";
import { aeaMetadata, fcsKey } from "../src/aea/fcs-key.ts";

const read = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/ios/${name}`, import.meta.url)));
const HEAD = read("os-image.aea.head");

describe("parseAeaHeader", () => {
  it("reads the profile word and the auth data", () => {
    const h = parseAeaHeader(HEAD);
    expect(h.profileWord & 0xffffff).toBe(1);
    expect(h.authData.length).toBe(HEAD.length - 12);
  });

  it("refuses what is not AEA1, or is cut short", () => {
    expect(() => parseAeaHeader(new TextEncoder().encode("AEA2\0\0\0\0\0\0\0\0"))).toThrow(/not an AEA1/);
    expect(() => parseAeaHeader(HEAD.subarray(0, 100))).toThrow(/wants/);
  });
});

describe("fcsKey", () => {
  const authData = parseAeaHeader(HEAD).authData;

  it("finds Apple's key/value metadata", () => {
    const meta = aeaMetadata(authData);
    expect([...meta.keys()]).toEqual([
      "com.apple.wkms.url", "com.apple.wkms.auth-data", "saksKey", "com.apple.wkms.fcs-response", "com.apple.wkms.fcs-key-url",
    ]);
  });

  it("refuses metadata without the wrapped key", async () => {
    await expect(fcsKey(new Uint8Array(0), () => Promise.reject(new Error("not fetched")))).rejects.toThrow(/lacks fcs-response/);
  });
});

/**
 * repeat.aea: blacktop/ipsw's own encryptor (pkg/aea Encrypt: symmetric profile,
 * LZFSE segments, sha256 checksums) over the text below, key 00 01 .. 1f.
 */
const SYM_KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const ARCHIVE = read("repeat.aea");
const PLAIN_SIZE = 2300000;
/** Header, auth data, salt, root MAC, root header, first cluster MAC: what precedes the first segment headers. */
const PROLOGUE = 12 + new DataView(ARCHIVE.buffer, ARCHIVE.byteOffset).getUint32(8, true) + 32 + 32 + 48 + 32;

function repeatPlain(): Uint8Array {
  let s = "";
  for (let i = 0; s.length < PLAIN_SIZE; i++) s += `<key>Entry${i % 97}</key><integer>${i % 13}</integer>\n`;
  return new TextEncoder().encode(s.slice(0, PLAIN_SIZE));
}

async function* chunked(b: Uint8Array, size = 4097): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < b.length; i += size) yield b.subarray(i, i + size);
}

async function decrypt(archive: Uint8Array, key = SYM_KEY): Promise<{ size: number; segments: Uint8Array[] }> {
  const s = await openAea(chunked(archive), async () => key);
  const segments: Uint8Array[] = [];
  for await (const p of s.chunks) segments.push(p);
  return { size: s.size, segments };
}

describe("openAea", () => {
  it("decrypts and inflates every segment, in order", async () => {
    const got = await decrypt(ARCHIVE);
    expect(got.size).toBe(PLAIN_SIZE);
    expect(got.segments.map((p) => p.length)).toEqual([1048576, 1048576, 202848]);
    expect(Buffer.concat(got.segments).equals(Buffer.from(repeatPlain()))).toBe(true);
  });

  it("knows the size from the prologue alone", async () => {
    async function* prologueOnly(): AsyncGenerator<Uint8Array> {
      yield ARCHIVE.subarray(0, PROLOGUE);
      throw new Error("read past the prologue");
    }
    const s = await openAea(prologueOnly(), async () => SYM_KEY);
    expect(s.size).toBe(PLAIN_SIZE);
  });

  it("refuses the wrong key at the root header", async () => {
    await expect(decrypt(ARCHIVE, new Uint8Array(32))).rejects.toThrow(/root header HMAC/);
  });

  it("refuses a corrupted cluster header", async () => {
    const bad = ARCHIVE.slice();
    bad[PROLOGUE] = (bad[PROLOGUE] ?? 0) ^ 0x40;
    await expect(decrypt(bad)).rejects.toThrow(/cluster 0 header HMAC/);
  });

  it("refuses a corrupted segment, having yielded only authenticated ones", async () => {
    const bad = ARCHIVE.slice();
    const at = bad.length - 1000;
    bad[at] = (bad[at] ?? 0) ^ 0x40;
    const s = await openAea(chunked(bad), async () => SYM_KEY);
    const seen: number[] = [];
    await expect((async () => {
      for await (const p of s.chunks) seen.push(p.length);
    })()).rejects.toThrow(/segment \d+ HMAC/);
    expect(seen).toEqual([1048576, 1048576]);
  });

  it("refuses a truncated archive", async () => {
    await expect(decrypt(ARCHIVE.subarray(0, ARCHIVE.length - 5000))).rejects.toThrow(/stream ended/);
  });
});

describe("ByteQueue", () => {
  async function* chunks(...parts: number[][]): AsyncGenerator<Uint8Array> {
    for (const p of parts) yield new Uint8Array(p);
  }

  it("reads exact lengths across chunk boundaries", async () => {
    const q = new ByteQueue(chunks([1, 2], [], [3, 4, 5], [6]));
    expect([...(await q.read(3))]).toEqual([1, 2, 3]);
    expect([...(await q.read(2))]).toEqual([4, 5]);
    expect([...(await q.rest())]).toEqual([6]);
  });

  it("throws when the stream ends early", async () => {
    await expect(new ByteQueue(chunks([1, 2])).read(3)).rejects.toThrow(/1 short of a 3-byte read/);
  });
});
