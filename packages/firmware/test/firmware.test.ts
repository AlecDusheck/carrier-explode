/**
 * firmware on small images (test/fixtures/android/make-images.sh), wrapped
 * here into a payload.bin and an OTA zip. Fake codecs stand in for XZ and BZ2.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, gunzipSync } from "node:zlib";
import { deflateSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  bytesSource, ErofsCompressedError, FsError, FsNotFoundError, HttpSource, openFilesystem, openPayload,
  openPartition, openPayloadSource, openZip, partitionReader, readSuperMetadata, SourceRangeError, SuperError, ZipFormatError,
  type Decompressors, type Filesystem,
} from "../src/index.ts";

const DIR = join(import.meta.dirname, "fixtures/android");
const image = (name: string): Uint8Array => new Uint8Array(gunzipSync(readFileSync(join(DIR, name))));
const treeFile = (path: string): Uint8Array => new Uint8Array(readFileSync(join(DIR, "tree", path)));
const BS = 4096;

const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
};
function varint(v: number): number[] {
  const out: number[] = [];
  let rest = BigInt(v);
  do {
    const low = Number(rest & 0x7fn);
    rest >>= 7n;
    out.push(rest ? low | 0x80 : low);
  } while (rest);
  return out;
}
const int = (field: number, v: number): Uint8Array => new Uint8Array([...varint(field << 3), ...varint(v)]);
const bytes = (field: number, b: Uint8Array): Uint8Array => cat(new Uint8Array([...varint((field << 3) | 2), ...varint(b.length)]), b);
const msg = (field: number, ...parts: Uint8Array[]): Uint8Array => bytes(field, cat(...parts));
const sha256 = (b: Uint8Array): Uint8Array => new Uint8Array(createHash("sha256").update(b).digest());

/** Reversal and XOR stand in for XZ and BZ2: enough to prove each op reaches its codec. */
const reverse = (b: Uint8Array): Uint8Array => b.slice().reverse();
const xor = (b: Uint8Array): Uint8Array => b.map((x) => x ^ 0x5a);
const codecs: Decompressors = { xz: reverse, bz2: xor, zstd: () => { throw new Error("no zstd ops here"); } };

interface Op { type: number; blob: Uint8Array; extents: Array<[number, number]> }

/**
 * Ops of 4 blocks each: all-zero chunks become ZERO, the rest rotate through
 * REPLACE, REPLACE_XZ and REPLACE_BZ. The first two data chunks are written by
 * one op whose extents are out of order.
 */
function operations(img: Uint8Array): Op[] {
  const ops: Op[] = [];
  const chunk = 4 * BS;
  let n = 0;
  for (let at = 0; at < img.length; at += chunk) {
    const data = img.subarray(at, Math.min(img.length, at + chunk));
    const extents: Array<[number, number]> = [[at / BS, data.length / BS]];
    if (data.every((x) => x === 0)) ops.push({ type: 6, blob: new Uint8Array(), extents });
    else if (n++ % 3 === 0) ops.push({ type: 0, blob: data.slice(), extents });
    else if (n % 3 === 2) ops.push({ type: 8, blob: reverse(data), extents });
    else ops.push({ type: 1, blob: xor(data), extents });
  }
  const [a, b] = ops.filter((op) => op.type === 0).slice(0, 2);
  if (a && b) {
    ops.splice(ops.indexOf(b), 1, { type: 0, blob: cat(b.blob, a.blob), extents: [...b.extents, ...a.extents] });
    ops.splice(ops.indexOf(a), 1);
  }
  return ops;
}

interface PayloadPart { readonly name: string; readonly img: Uint8Array }

/** A payload of several partitions; `dynamic` adds a dynamic_partition_metadata field. */
function payloadOf(parts: readonly PayloadPart[], opsOf: (img: Uint8Array) => Op[] = operations, dynamic = false): Uint8Array {
  let offset = 0;
  const blobs: Uint8Array[] = [];
  const updates = parts.map(({ name, img }) => {
    const ops = opsOf(img).map((op) => {
      const encoded = msg(8,
        int(1, op.type),
        ...(op.blob.length ? [int(2, offset), int(3, op.blob.length)] : []),
        ...op.extents.map(([start, count]) => msg(6, int(1, start), int(2, count))),
        ...(op.blob.length ? [bytes(8, sha256(op.blob))] : []));
      offset += op.blob.length;
      blobs.push(op.blob);
      return encoded;
    });
    return msg(13, bytes(1, new TextEncoder().encode(name)), msg(7, int(1, img.length)), ...ops);
  });
  const manifest = cat(int(3, BS), ...updates, ...(dynamic ? [msg(15, int(3, 1))] : []));
  const head = new Uint8Array(24);
  head.set(new TextEncoder().encode("CrAU"));
  const dv = new DataView(head.buffer);
  dv.setBigUint64(4, 2n);
  dv.setBigUint64(12, BigInt(manifest.length));
  return cat(head, manifest, ...blobs);
}

const payload = (img: Uint8Array, opsOf: (img: Uint8Array) => Op[] = operations): Uint8Array => payloadOf([{ name: "product", img }], opsOf);

interface Member { name: string; data: Uint8Array; deflate?: boolean }

/** A zip of stored (or deflated) members; `zip64` saturates the 32-bit fields and adds the zip64 records. */
function zip(members: readonly Member[], zip64 = false): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const m of members) {
    const name = new TextEncoder().encode(m.name);
    const body = m.deflate ? deflateSync(m.data) : m.data;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, m.deflate ? 8 : 0, true);
    lv.setUint32(14, crc32(m.data), true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, m.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const extra = new Uint8Array(zip64 ? 28 : 0);
    if (zip64) {
      const ev = new DataView(extra.buffer);
      ev.setUint16(0, 1, true);
      ev.setUint16(2, 24, true);
      ev.setBigUint64(4, BigInt(m.data.length), true);
      ev.setBigUint64(12, BigInt(body.length), true);
      ev.setBigUint64(20, BigInt(offset), true);
    }
    const cd = new Uint8Array(46 + name.length + extra.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, m.deflate ? 8 : 0, true);
    cv.setUint32(16, crc32(m.data), true);
    cv.setUint32(20, zip64 ? 0xffffffff : body.length, true);
    cv.setUint32(24, zip64 ? 0xffffffff : m.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, extra.length, true);
    cv.setUint32(42, zip64 ? 0xffffffff : offset, true);
    cd.set(name, 46);
    cd.set(extra, 46 + name.length);
    locals.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
  }
  const cdBytes = cat(...central);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, zip64 ? 0xffff : members.length, true);
  ev.setUint16(10, zip64 ? 0xffff : members.length, true);
  ev.setUint32(12, zip64 ? 0xffffffff : cdBytes.length, true);
  ev.setUint32(16, zip64 ? 0xffffffff : offset, true);
  if (!zip64) return cat(...locals, cdBytes, eocd);
  const record = new Uint8Array(56);
  const rv = new DataView(record.buffer);
  rv.setUint32(0, 0x06064b50, true);
  rv.setBigUint64(32, BigInt(members.length), true);
  rv.setBigUint64(40, BigInt(cdBytes.length), true);
  rv.setBigUint64(48, BigInt(offset), true);
  const locator = new Uint8Array(20);
  const lv = new DataView(locator.buffer);
  lv.setUint32(0, 0x07064b50, true);
  lv.setBigUint64(8, BigInt(offset + cdBytes.length), true);
  return cat(...locals, cdBytes, record, locator, eocd);
}

const ota = (img: Uint8Array, zip64 = false): Uint8Array =>
  zip([{ name: "META-INF/com/android/metadata", data: new TextEncoder().encode("post-build=x\n".repeat(20)), deflate: true }, { name: "payload.bin", data: payload(img) }], zip64);

async function product(name: string): Promise<Filesystem> {
  const z = await openZip(bytesSource(ota(image(name))));
  return openFilesystem(partitionReader(await openPayload(z, { decompressors: codecs }), "product"));
}

describe("zip", () => {
  for (const zip64 of [false, true]) {
    it(`lists members and reads stored and deflated ones${zip64 ? " (zip64)" : ""}`, async () => {
      const data = new TextEncoder().encode("hello ".repeat(100));
      const z = await openZip(bytesSource(zip([{ name: "a.txt", data, deflate: true }, { name: "b.bin", data: data.subarray(0, 10) }], zip64)));
      expect(z.entries.map((e) => [e.name, e.method, e.size])).toEqual([["a.txt", 8, 600], ["b.bin", 0, 10]]);
      const [a, b] = z.entries;
      if (!a || !b) throw new Error("entries missing");
      expect(await z.read(a)).toEqual(data);
      expect(await z.read(b)).toEqual(data.subarray(0, 10));
      await expect(z.storedSource(a)).rejects.toThrow(ZipFormatError);
    });
  }

  it("checks each member's size and CRC-32", async () => {
    const data = new TextEncoder().encode("hello ".repeat(100));
    const bytes = zip([{ name: "a.txt", data, deflate: true }]);
    const crcAt = bytes.length - 22 - (46 + 5) + 16;
    bytes[crcAt] = (bytes[crcAt] ?? 0) ^ 1;
    const z = await openZip(bytesSource(bytes));
    const [a] = z.entries;
    if (!a) throw new Error("entry missing");
    await expect(z.read(a)).rejects.toThrow(/CRC-32/);
  });

  it("refuses what is not a zip", async () => {
    await expect(openZip(bytesSource(new Uint8Array(100)))).rejects.toThrow(ZipFormatError);
  });

  it("reads over HTTP Range requests and counts what it fetched", async () => {
    const body = ota(image("product.ext4.gz"));
    const fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method === "HEAD") return new Response(null, { headers: { "content-length": String(body.length) } });
      const m = new Headers(init?.headers).get("range")?.match(/^bytes=(\d+)-(\d+)$/);
      if (!m?.[1] || !m[2]) return new Response(body.slice());
      const [start, end] = [Number(m[1]), Number(m[2])];
      return new Response(body.slice(start, end + 1), { status: 206, headers: { "content-range": `bytes ${start}-${end}/${body.length}` } });
    };
    const source = await HttpSource.open("https://example.test/ota.zip", { fetch, backoff: 0 });
    const fs = await openFilesystem(partitionReader(await openPayload(await openZip(source), { decompressors: codecs }), "product"));
    expect(await fs.readFile("etc/CarrierSettings/skylo_zz.pb")).toEqual(treeFile("etc/CarrierSettings/skylo_zz.pb"));
    expect(source.stats.requests).toBeGreaterThan(2);
    expect(source.stats.bytes).toBeLessThan(body.length);
  });
});

describe("payload and partition reader", () => {
  const img = image("product.ext4.gz");

  it("parses the manifest", async () => {
    const p = await openPayloadSource(bytesSource(payload(img)), { decompressors: codecs });
    expect(p.blockSize).toBe(BS);
    expect(p.partitions.map((x) => [x.name, x.size])).toEqual([["product", img.length]]);
    expect(new Set(p.partition("product")?.operations.map((op) => op.type))).toEqual(new Set(["REPLACE", "REPLACE_XZ", "REPLACE_BZ", "ZERO"]));
  });

  it("reads any range back exactly, through every op type and a split op", async () => {
    const r = partitionReader(await openPayloadSource(bytesSource(payload(img)), { decompressors: codecs }), "product", 2);
    for (const [at, len] of [[0, img.length], [1000, 50_000], [img.length - 10, 10], [5 * BS - 3, 6]] as const) {
      // Buffer.equals: toEqual walks megabytes element by element.
      expect(Buffer.from(await r.read(at, len)).equals(img.subarray(at, at + len))).toBe(true);
    }
    await expect(r.read(img.length - 1, 2)).rejects.toThrow(SourceRangeError);
  });

  it("checks blob hashes", async () => {
    const corrupt = payload(img);
    const last = corrupt.length - 1;
    corrupt[last] = (corrupt[last] ?? 0) ^ 1;
    const r = partitionReader(await openPayloadSource(bytesSource(corrupt), { decompressors: codecs }), "product");
    await expect(r.read(0, img.length)).rejects.toThrow(/sha256/);
  });

  it("does not cache a failed operation load", async () => {
    const good = bytesSource(payload(img));
    let fail = false;
    const flaky = { ...good, read: async (offset: number, length: number): Promise<Uint8Array> => {
      if (fail) {
        fail = false;
        throw new Error("connection reset");
      }
      return good.read(offset, length);
    } };
    const r = partitionReader(await openPayloadSource(flaky, { decompressors: codecs }), "product");
    fail = true;
    await expect(r.read(1024, 128)).rejects.toThrow("connection reset");
    expect(Buffer.from(await r.read(1024, 128)).equals(img.subarray(1024, 1152))).toBe(true);
  });

  it("refuses incremental operations", async () => {
    const delta = payload(img, (i) => operations(i).map((op) => ({ ...op, type: op.type === 0 ? 4 : op.type })));
    const r = partitionReader(await openPayloadSource(bytesSource(delta), { decompressors: codecs }), "product");
    await expect(r.read(0, img.length)).rejects.toThrow(/SOURCE_COPY/);
  });
});

describe("filesystems", () => {
  const settings = ["filler.bin", "skylo_zz.pb", "spektrummso_us.pb"];

  for (const name of ["product.ext4.gz", "product.erofs.gz", "product-chunked.erofs.gz"]) {
    it(`reads files and directories of ${name}`, async () => {
      const fs = await product(name);
      expect(fs.kind).toBe(name.includes("ext4") ? "ext4" : "erofs");
      const listed = await fs.readdir("etc/CarrierSettings");
      expect(listed.map((e) => e.name).sort()).toEqual(settings);
      expect(listed.every((e) => e.kind === "file")).toBe(true);
      for (const file of ["skylo_zz.pb", "spektrummso_us.pb"]) {
        expect(await fs.readFile(`/etc/CarrierSettings/${file}`)).toEqual(treeFile(`etc/CarrierSettings/${file}`));
      }
      const filler = await fs.readFile("etc/CarrierSettings/filler.bin");
      expect(filler.length).toBe(10_000);
      expect(filler[9999]).toBe((9999 * 7 + Math.floor(9999 / 251)) % 256);
      expect(new TextDecoder().decode(await fs.readFile("etc/tiny.txt"))).toBe("inline");
      const many = await fs.readdir("many");
      expect(many.length).toBe(300);
      expect(many.map((e) => e.name).sort()[299]).toBe("entry-299");
      await expect(fs.readdir("etc/Missing")).rejects.toThrow(FsNotFoundError);
      await expect(fs.readFile("etc")).rejects.toThrow(FsError);
    });
  }

  it("names compressed EROFS files instead of misreading them", async () => {
    const fs = await product("product-lz4.erofs.gz");
    await expect(fs.readFile("etc/CarrierSettings/filler.bin")).rejects.toThrow(ErofsCompressedError);
  });

  /** A copy of `img` with `patch` written at the first occurrence of `find`, plus `at` bytes. */
  function patched(img: Uint8Array, find: Uint8Array, at: number, patch: readonly number[]): Uint8Array {
    const i = Buffer.from(img).indexOf(find);
    if (i < 0) throw new Error("pattern not in the image");
    const out = img.slice();
    out.set(patch, i + at);
    return out;
  }
  const le16 = (n: number): number[] => [n & 0xff, n >> 8];
  const le32 = (n: number): number[] => [...le16(n & 0xffff), ...le16(n >>> 16)];

  it("throws on a cyclic ext4 extent tree instead of following it", async () => {
    const img = image("product.ext4.gz");
    // filler.bin's extent root (3 blocks at block 7) becomes a depth-2 index into a free block, which points at itself.
    const root = new Uint8Array([0x0a, 0xf3, 1, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 7, 0, 0, 0]);
    const free = img.length / BS - 1;
    const node = [...le16(0xf30a), ...le16(1), ...le16(340), ...le16(1), 0, 0, 0, 0, ...le32(0), ...le32(free), 0, 0, 0, 0];
    const bad = patched(img, root, 6, [...le16(2), ...le32(0), ...le32(0), ...le32(free), 0, 0]);
    bad.set(node, free * BS);
    const fs = await openFilesystem(bytesSource(bad));
    await expect(fs.readFile("etc/CarrierSettings/filler.bin")).rejects.toThrow(/depth 1, expected 0/);
  });

  it("reads an ext4 file larger than its image as sparse: holes are zeros (Pixel 6 modem.bin)", async () => {
    const img = image("product.ext4.gz");
    const root = new Uint8Array([0x0a, 0xf3, 1, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 7, 0, 0, 0]);
    const size = img.length + 2 * BS;
    // filler.bin's i_size sits 36 bytes before its extent root (inode +4 vs +40).
    const sparse = await openFilesystem(bytesSource(patched(img, root, -36, le32(size))));
    const original = await (await openFilesystem(bytesSource(img))).readFile("etc/CarrierSettings/filler.bin");
    const read = await sparse.readFile("etc/CarrierSettings/filler.bin");
    expect(read.length).toBe(size);
    expect(Buffer.from(read.subarray(0, original.length)).equals(original)).toBe(true);
    expect(read.subarray(3 * BS).every((b) => b === 0)).toBe(true);
  });

  it("reads an ext4 fast symlink's target from its inode (a Tensor modem's images/default)", async () => {
    const img = image("product.ext4.gz");
    // etc/tiny.txt keeps "inline" in i_block (inode +40): make it a symlink (mode +0) without inline data (flags +32).
    const link = patched(patched(img, new TextEncoder().encode("inline"), -40, le16(0xa1ff)), new TextEncoder().encode("inline"), -8, le32(0));
    const fs = await openFilesystem(bytesSource(link));
    expect(await fs.readlink("etc/tiny.txt")).toBe("inline");
    await expect(fs.readFile("etc/tiny.txt")).rejects.toThrow(/not a regular file/);
    await expect(fs.readlink("etc/CarrierSettings/skylo_zz.pb")).rejects.toThrow(/not a symbolic link/);
    await expect(fs.readlink("etc/missing")).rejects.toThrow(FsNotFoundError);
  });

  it("throws on an ext4 superblock with an impossible geometry", async () => {
    const img = image("product.ext4.gz");
    const bad = img.slice();
    bad.set(le32(40), 1024 + 24);
    await expect(openFilesystem(bytesSource(bad))).rejects.toThrow(FsError);
  });

  it("throws on an EROFS directory block with bad name offsets", async () => {
    const img = image("product.erofs.gz");
    // etc/CarrierSettings: five dirents, so names start at 60 with ".", ".." and "filler.bin".
    const bad = patched(img, new TextEncoder().encode("...filler.bin"), -60 + 8, le16(61));
    const fs = await openFilesystem(bytesSource(bad));
    await expect(fs.readdir("etc/CarrierSettings")).rejects.toThrow(/starts its names at 61/);
  });

  it("refuses images that are neither ext4, EROFS nor FAT", async () => {
    const zeros = new Uint8Array(16 * BS);
    zeros[0] = 1;
    const z = await openZip(bytesSource(zip([{ name: "payload.bin", data: payload(zeros) }])));
    await expect(openFilesystem(partitionReader(await openPayload(z, { decompressors: codecs }), "product"))).rejects.toThrow(/neither ext4, EROFS nor FAT/);
  });
});

describe("retrofit super (dynamic partitions on block devices)", () => {
  const SECTOR = 512;
  const product = image("product.ext4.gz");
  const half = product.length / 2;
  const tiny = Uint8Array.from({ length: 8 * SECTOR }, (_, i) => (i * 13) % 256);
  const MAX_METADATA = 4096;
  /** Logical partitions: name -> extents [sectors, kind (0 linear, 1 zero), device sector, device index]. */
  const LAYOUT: ReadonlyArray<readonly [string, ReadonlyArray<readonly [number, number, number, number]>]> = [
    ["product", [[half / SECTOR, 0, 2048, 0], [half / SECTOR, 0, 2048, 1], [8, 1, 0, 0]]],
    ["vendor", [[8, 0, 2048 + half / SECTOR, 1]]],
  ];
  const DEVICES = ["system", "vendor"] as const;

  const le = (n: number, width: 4 | 8): number[] => Array.from({ length: width }, (_, i) => Number((BigInt(n) >> BigInt(8 * i)) & 0xffn));
  const name36 = (n: string): number[] => [...new TextEncoder().encode(n.padEnd(36, "\0"))];

  /** Geometry, then slot 0's metadata (liblp metadata_format.h), with their sha256 checksums. */
  function lpMetadata(): Uint8Array {
    const parts = LAYOUT.map(([name], i) => [...name36(name), ...le(1, 4), ...le(LAYOUT.slice(0, i).reduce((n, [, e]) => n + e.length, 0), 4), ...le(LAYOUT[i]?.[1].length ?? 0, 4), ...le(0, 4)]);
    const extents = LAYOUT.flatMap(([, e]) => e.map(([sectors, kind, at, dev]) => [...le(sectors, 8), ...le(kind, 4), ...le(at, 8), ...le(dev, 4)]));
    const group = [...name36("default"), ...le(0, 4), ...le(0, 8)];
    const devices = DEVICES.map((d) => [...le(2048, 8), ...le(0, 4), ...le(0, 4), ...le(4 * 2048, 8), ...name36(d), ...le(0, 4)]);
    const tables = new Uint8Array([...parts.flat(), ...extents.flat(), ...group, ...devices.flat()]);
    const descs = [[0, parts.length, 52], [parts.length * 52, extents.length, 24], [parts.length * 52 + extents.length * 24, 1, 48], [parts.length * 52 + extents.length * 24 + 48, devices.length, 64]];
    const header = new Uint8Array(128);
    header.set([...le(0x414c5030, 4), 10, 0, 0, 0, ...le(128, 4)]);
    header.set(le(tables.length, 4), 44);
    header.set(sha256(tables), 48);
    descs.forEach((d, i) => header.set(d.flatMap((x) => le(x, 4)), 80 + 12 * i));
    header.set(sha256(header), 12);
    const geometry = new Uint8Array(52);
    geometry.set([...le(0x616c4467, 4), ...le(52, 4)]);
    geometry.set([...le(MAX_METADATA, 4), ...le(2, 4), ...le(BS, 4)], 40);
    geometry.set(sha256(geometry), 8);
    const out = new Uint8Array(3 * 4096 + MAX_METADATA);
    out.set(geometry, 4096);
    out.set(header, 3 * 4096);
    out.set(tables, 3 * 4096 + 128);
    return out;
  }

  function devices(): { system: Uint8Array; vendor: Uint8Array } {
    const system = new Uint8Array(2048 * SECTOR + half);
    system.set(lpMetadata());
    system.set(product.subarray(0, half), 2048 * SECTOR);
    const vendor = new Uint8Array(2048 * SECTOR + half + tiny.length);
    vendor.set(product.subarray(half), 2048 * SECTOR);
    vendor.set(tiny, 2048 * SECTOR + half);
    return { system, vendor };
  }

  const modem = Uint8Array.from({ length: 4 * BS }, (_, i) => i % 7);
  const open = async (system: Uint8Array, vendor: Uint8Array, dynamic = false) =>
    openPayloadSource(bytesSource(payloadOf([{ name: "system", img: system }, { name: "vendor", img: vendor }, { name: "modem", img: modem }], operations, dynamic)), { decompressors: codecs });

  it("reads the LP metadata from the first block device", async () => {
    const { system, vendor } = devices();
    const meta = await readSuperMetadata(partitionReader(await open(system, vendor), "system"));
    expect(meta?.devices).toEqual(["system", "vendor"]);
    expect(meta?.partitions.get("vendor")).toEqual([{ kind: "linear", sectors: 8, device: "vendor", sector: 2048 + half / SECTOR }]);
    expect(await readSuperMetadata(bytesSource(product))).toBeUndefined();
  });

  it("maps logical partitions across block devices, and passes the rest through", async () => {
    const { system, vendor } = devices();
    const p = await open(system, vendor);
    expect(p.dynamicPartitions).toBe(false);
    const r = await openPartition(p, "product");
    expect(r.size).toBe(product.length + 8 * SECTOR);
    expect(Buffer.from(await r.read(half - 100, 200)).equals(product.subarray(half - 100, half + 100))).toBe(true);
    expect(await r.read(product.length, 8 * SECTOR)).toEqual(new Uint8Array(8 * SECTOR));
    const fs = await openFilesystem(r);
    expect(await fs.readFile("etc/CarrierSettings/skylo_zz.pb")).toEqual(treeFile("etc/CarrierSettings/skylo_zz.pb"));
    expect(await (await openPartition(p, "vendor")).read(0, tiny.length)).toEqual(tiny);
    expect(await (await openPartition(p, "modem")).read(0, modem.length)).toEqual(modem);
    await expect(openPartition(p, "system")).rejects.toThrow(SuperError);
  });

  it("reads payloads with dynamic partition metadata as logical images", async () => {
    const { system, vendor } = devices();
    expect(await (await openPartition(await open(system, vendor, true), "system")).read(0, BS)).toEqual(system.subarray(0, BS));
  });

  it("checks the metadata checksums", async () => {
    const { system, vendor } = devices();
    system[3 * 4096 + 128 + 40] = 0xff;
    await expect(openPartition(await open(system, vendor), "product")).rejects.toThrow(/tables checksum/);
  });
});
