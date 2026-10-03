// AEA headers and archive keys, on the real header of iOS 27.0.1's OS image
// (iPhone17,1_27.0.1_24A446_Restore.ipsw, member 043-70165-666.dmg.aea) and the
// private key Apple serves at its fcs-key URL. Both are public.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { aeaMetadata, archiveKey, decryptAea, parseAeaHeader } from "../src/jobs/ios/ipsw/aea.ts";
import { ByteQueue } from "../src/jobs/ios/ipsw/byte-queue.ts";
import { hpkeOpen, p256Scalar } from "../src/jobs/ios/ipsw/hpke.ts";

const read = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/ios/${name}`, import.meta.url)));
const HEAD = read("os-image.aea.head");
const PEM = new TextDecoder().decode(read("fcs-key.pem"));
const KEY_URL = "https://wkms-public.apple.com/fcs-keys/QCqzQwl_I7Qqryu1rCa3pUU9B0bB8stoEultRXeT16I=";
/** What `ipsw fw aea --key` prints for this member. */
const ARCHIVE_KEY = "zJ128lNSmsXPxFxTUW/Icx2q2jip0OZ+Lam4IWWyUb4=";

describe("parseAeaHeader", () => {
  it("reads the profile and the key/value auth data", () => {
    const h = parseAeaHeader(HEAD);
    expect(h.profile).toBe(1);
    expect(h.length).toBe(HEAD.length);
    const meta = aeaMetadata(h.authData);
    expect([...meta.keys()]).toEqual([
      "com.apple.wkms.url", "com.apple.wkms.auth-data", "saksKey", "com.apple.wkms.fcs-response", "com.apple.wkms.fcs-key-url",
    ]);
    expect(new TextDecoder().decode(meta.get("com.apple.wkms.fcs-key-url"))).toBe(KEY_URL);
  });

  it("refuses what is not AEA1, or is cut short", () => {
    expect(() => parseAeaHeader(new TextEncoder().encode("AEA2\0\0\0\0\0\0\0\0"))).toThrow(/not an AEA1/);
    expect(() => parseAeaHeader(HEAD.subarray(0, 100))).toThrow(/wants/);
  });
});

describe("archiveKey", () => {
  it("unwraps the key with the private key from the fcs-key URL", async () => {
    const asked: string[] = [];
    const key = await archiveKey(aeaMetadata(parseAeaHeader(HEAD).authData), async (url) => {
      asked.push(url);
      return PEM;
    });
    expect(Buffer.from(key).toString("base64")).toBe(ARCHIVE_KEY);
    expect(asked).toEqual([KEY_URL]);
  });

  it("refuses metadata without the wrapped key", async () => {
    await expect(archiveKey(new Map(), () => Promise.reject(new Error("not fetched")))).rejects.toThrow(/lacks fcs-response/);
  });
});

/**
 * repeat.aea: blacktop/ipsw's own encryptor (pkg/aea Encrypt: symmetric profile,
 * LZFSE segments, sha256 checksums) over the text below, key 00 01 .. 1f.
 */
const SYM_KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
function repeatPlain(): Uint8Array {
  let s = "";
  for (let i = 0; s.length < 2300000; i++) s += `<key>Entry${i % 97}</key><integer>${i % 13}</integer>\n`;
  return new TextEncoder().encode(s.slice(0, 2300000));
}

async function decrypt(archive: Uint8Array, key = SYM_KEY, chunk = 4097): Promise<{ plain: Uint8Array; size: number; segments: number[] }> {
  const parts: Uint8Array[] = [];
  let size = -1;
  async function* source(): AsyncGenerator<Uint8Array> {
    for (let i = 0; i < archive.length; i += chunk) yield archive.subarray(i, i + chunk);
  }
  await decryptAea(source(), key, {
    sink: async (p) => {
      parts.push(p);
    },
    onSize: (n) => {
      size = n;
    },
  });
  return { plain: new Uint8Array(Buffer.concat(parts)), size, segments: parts.map((p) => p.length) };
}

describe("decryptAea", () => {
  const ARCHIVE = read("repeat.aea");

  it("decrypts and inflates every segment, in order", async () => {
    const got = await decrypt(ARCHIVE);
    expect(got.size).toBe(2300000);
    expect(got.segments).toEqual([1048576, 1048576, 202848]);
    // Buffer.equals: toEqual walks 2.3 MB element by element.
    expect(Buffer.from(got.plain).equals(Buffer.from(repeatPlain()))).toBe(true);
  });

  it("refuses the wrong key at the root header", async () => {
    await expect(decrypt(ARCHIVE, new Uint8Array(32))).rejects.toThrow(/root header HMAC/);
  });

  it("refuses a corrupted segment", async () => {
    const bad = ARCHIVE.slice();
    const at = bad.length - 1000;
    bad[at] = (bad[at] ?? 0) ^ 0x40;
    await expect(decrypt(bad)).rejects.toThrow(/segment \d+ HMAC/);
  });

  it("refuses a truncated archive", async () => {
    await expect(decrypt(ARCHIVE.subarray(0, ARCHIVE.length - 5000))).rejects.toThrow(/stream ended/);
  });

  it("lets onSize refuse before any segment is written", async () => {
    const sink = async (): Promise<void> => {
      throw new Error("wrote");
    };
    const source = (async function* () {
      yield ARCHIVE;
    })();
    await expect(decryptAea(source, SYM_KEY, { sink, onSize: () => { throw new Error("no room"); } })).rejects.toThrow("no room");
  });
});

describe("hpkeOpen", () => {
  it("fails on a tampered ciphertext (the GCM tag)", () => {
    const fcs = JSON.parse(new TextDecoder().decode(aeaMetadata(parseAeaHeader(HEAD).authData).get("com.apple.wkms.fcs-response"))) as Record<string, string>;
    const wrapped = Buffer.from(fcs["wrapped-key"] ?? "", "base64");
    wrapped[0] = (wrapped[0] ?? 0) ^ 1;
    expect(() => hpkeOpen(p256Scalar(PEM), Buffer.from(fcs["enc-request"] ?? "", "base64"), wrapped)).toThrow();
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
    expect(q.consumed).toBe(5);
    expect([...(await q.rest())]).toEqual([6]);
  });

  it("throws when the stream ends early", async () => {
    await expect(new ByteQueue(chunks([1, 2])).read(3)).rejects.toThrow(/1 short of a 3-byte read/);
  });
});
