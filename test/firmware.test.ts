/**
 * src/lib/firmware on small images (test/fixtures/android/make-images.sh), wrapped
 * here into a payload.bin and an OTA zip. Fake codecs stand in for XZ and BZ2.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { deflateSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  bytesSource, ErofsCompressedError, FsError, FsNotFoundError, HttpSource, openFilesystem, openPayload,
  openPayloadSource, openZip, PartitionError, partitionReader, ZipFormatError, type Decompressors, type Filesystem,
} from "../src/lib/firmware/index.ts";

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

function payload(img: Uint8Array, opsOf: (img: Uint8Array) => Op[] = operations): Uint8Array {
  let offset = 0;
  const ops = opsOf(img).map((op) => {
    const encoded = msg(8,
      int(1, op.type),
      ...(op.blob.length ? [int(2, offset), int(3, op.blob.length)] : []),
      ...op.extents.map(([start, count]) => msg(6, int(1, start), int(2, count))),
      ...(op.blob.length ? [bytes(8, sha256(op.blob))] : []));
    offset += op.blob.length;
    return encoded;
  });
  const manifest = cat(int(3, BS), msg(13, bytes(1, new TextEncoder().encode("product")), msg(7, int(1, img.length)), ...ops));
  const head = new Uint8Array(24);
  head.set(new TextEncoder().encode("CrAU"));
  const dv = new DataView(head.buffer);
  dv.setBigUint64(4, 2n);
  dv.setBigUint64(12, BigInt(manifest.length));
  return cat(head, manifest, ...opsOf(img).map((op) => op.blob));
}

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
    const r = partitionReader(await openPayloadSource(bytesSource(payload(img)), { decompressors: codecs }), "product", { cacheOps: 2 });
    for (const [at, len] of [[0, img.length], [1000, 50_000], [img.length - 10, 10], [5 * BS - 3, 6]] as const) {
      // Buffer.equals: toEqual walks megabytes element by element.
      expect(Buffer.from(await r.read(at, len)).equals(img.subarray(at, at + len))).toBe(true);
    }
    await expect(r.read(img.length - 1, 2)).rejects.toThrow(PartitionError);
  });

  it("checks blob hashes", async () => {
    const corrupt = payload(img);
    const last = corrupt.length - 1;
    corrupt[last] = (corrupt[last] ?? 0) ^ 1;
    const r = partitionReader(await openPayloadSource(bytesSource(corrupt), { decompressors: codecs }), "product");
    await expect(r.read(0, img.length)).rejects.toThrow(/sha256/);
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

  it("refuses images that are neither ext4 nor EROFS", async () => {
    const zeros = new Uint8Array(16 * BS);
    zeros[0] = 1;
    const z = await openZip(bytesSource(zip([{ name: "payload.bin", data: payload(zeros) }])));
    await expect(openFilesystem(partitionReader(await openPayload(z, { decompressors: codecs }), "product"))).rejects.toThrow(/neither ext4 nor EROFS/);
  });
});
