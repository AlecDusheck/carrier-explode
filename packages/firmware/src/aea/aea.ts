/**
 * Apple Encrypted Archive (AEA1, symmetric profile, LZFSE segments with sha256), decrypted as a stream.
 * Layout and key schedule as blacktop/ipsw pkg/aea. Every segment is authenticated before it is yielded.
 */

import { byteAt, concatBytes, latin1, safeU64le, u32le } from "@carrier-explode/binary";
import { lzfseDecode } from "../lzfse.ts";
import { ByteQueue } from "./byte-queue.ts";
import { aesCtr, equalBytes, hkdfSha256, hmacSha256, sha256 } from "./webcrypto.ts";

const MAGIC = "AEA1";
const PROFILE_SYMMETRIC = 1;
/** Magic, profile word, auth data length. */
const PREFIX = 12;
const SALT = 32;
const MAC = 32;
const ROOT_HEADER = 48;
/** Plain size, stored size, sha256. */
const SEGMENT_HEADER = 8 + 32;
const COMPRESSION_LZFSE = "e";
const CHECKSUM_SHA256 = 2;

export interface AeaHeader {
  /** The low 24 bits are the profile; the main key's derivation mixes in all 32. */
  readonly profileWord: number;
  /** Authenticated, not interpreted here: Apple's says where the key is (./fcs-key.ts). */
  readonly authData: Uint8Array;
}

export interface PlainStream {
  readonly size: number;
  readonly chunks: AsyncIterable<Uint8Array>;
}

/** From the archive's first 12 + authLen bytes. */
export function parseAeaHeader(b: Uint8Array): AeaHeader {
  if (b.length < PREFIX || latin1(b.subarray(0, 4)) !== MAGIC) throw new Error("not an AEA1 archive");
  const end = PREFIX + u32le(b, 8);
  if (b.length < end) throw new Error(`AEA header wants ${end} bytes, got ${b.length}`);
  return { profileWord: u32le(b, 4), authData: b.subarray(PREFIX, end) };
}

const enc = new TextEncoder();
const EMPTY = new Uint8Array(0);

function info(label: string, n?: number): Uint8Array {
  if (n === undefined) return enc.encode(label);
  const suffix = new Uint8Array(4);
  new DataView(suffix.buffer).setUint32(0, n, true);
  return concatBytes([enc.encode(label), suffix]);
}

interface HeaderKey {
  readonly mac: Uint8Array;
  readonly key: Uint8Array;
  readonly iv: Uint8Array;
}

/** MAC key, AES-256 key and CTR IV, in one HKDF output as libAppleArchive derives them. */
async function headerKey(ikm: Uint8Array, label: Uint8Array): Promise<HeaderKey> {
  const k = await hkdfSha256(ikm, EMPTY, label, 80);
  return { mac: k.subarray(0, 32), key: k.subarray(32, 64), iv: k.subarray(64, 80) };
}

/** libAppleArchive's salted HMAC: HMAC(key, salt ‖ data ‖ u64le(len salt)). */
function mac(key: Uint8Array, data: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const len = new Uint8Array(8);
  new DataView(len.buffer).setBigUint64(0, BigInt(salt.length), true);
  return hmacSha256(key, salt, data, len);
}

async function verify(expected: Uint8Array, got: Promise<Uint8Array>, what: string): Promise<void> {
  if (!equalBytes(expected, await got)) throw new Error(`AEA: ${what} HMAC mismatch`);
}

const ctr = (k: HeaderKey, data: Uint8Array): Promise<Uint8Array> => aesCtr(k.key, k.iv, data);

interface RootHeader {
  readonly fileSize: number;
  readonly segmentSize: number;
  readonly segmentsPerCluster: number;
}

function rootHeader(b: Uint8Array): RootHeader {
  const compression = String.fromCharCode(byteAt(b, 24));
  const checksum = byteAt(b, 25);
  if (compression !== COMPRESSION_LZFSE) throw new Error(`AEA: segment compression '${compression}', expected LZFSE`);
  if (checksum !== CHECKSUM_SHA256) throw new Error(`AEA: segment checksum type ${checksum}, expected sha256`);
  const h = { fileSize: safeU64le(b, 0), segmentSize: u32le(b, 16), segmentsPerCluster: u32le(b, 20) };
  if (h.segmentSize === 0 || h.segmentsPerCluster === 0) throw new Error("AEA: empty segments or clusters");
  return h;
}

/** Reads up to the root header, taking the key from `keyFor`, and authenticates it; the size is known before any segment is read. */
export async function openAea(source: AsyncIterable<Uint8Array>, keyFor: (authData: Uint8Array) => Promise<Uint8Array>): Promise<PlainStream> {
  const q = new ByteQueue(source);
  const prefix = await q.read(PREFIX);
  const header = parseAeaHeader(concatBytes([prefix, await q.read(u32le(prefix, 8))]));
  const profile = header.profileWord & 0xffffff;
  if (profile !== PROFILE_SYMMETRIC) throw new Error(`AEA: profile ${profile} is not symmetric encryption`);
  const key = await keyFor(header.authData);
  const mainKey = await hkdfSha256(key, await q.read(SALT), info("AEA_AMK", header.profileWord), key.length);
  const rootMac = await q.read(MAC);
  const encRoot = await q.read(ROOT_HEADER);
  const clusterMac = await q.read(MAC);
  const rhk = await headerKey(mainKey, info("AEA_RHEK"));
  await verify(rootMac, mac(rhk.mac, encRoot, concatBytes([clusterMac, header.authData])), "root header");
  const root = rootHeader(await ctr(rhk, encRoot));
  return { size: root.fileSize, chunks: segments(q, mainKey, root, clusterMac) };
}

async function* segments(q: ByteQueue, mainKey: Uint8Array, root: RootHeader, firstClusterMac: Uint8Array): AsyncGenerator<Uint8Array> {
  const n = root.segmentsPerCluster;
  let clusterMac = firstClusterMac;
  let written = 0;
  for (let cluster = 0; written < root.fileSize; cluster++) {
    const ck = await hkdfSha256(mainKey, EMPTY, info("AEA_CK", cluster), 32);
    const chk = await headerKey(ck, info("AEA_CHEK"));
    const encHeaders = await q.read(SEGMENT_HEADER * n);
    const nextMac = await q.read(MAC);
    const segmentMacs = await q.read(MAC * n);
    await verify(clusterMac, mac(chk.mac, encHeaders, concatBytes([nextMac, segmentMacs])), `cluster ${cluster} header`);
    const headers = await ctr(chk, encHeaders);

    for (let i = 0; i < n && written < root.fileSize; i++) {
      const h = headers.subarray(i * SEGMENT_HEADER, (i + 1) * SEGMENT_HEADER);
      const size = u32le(h, 0);
      // Segments have fixed slots: streaming them in order is right only while every one before was full.
      const slot = (cluster * n + i) * root.segmentSize;
      if (slot !== written) throw new Error(`AEA: segment ${cluster}/${i} belongs at ${slot}, stream is at ${written}`);
      const stored = await q.read(u32le(h, 4));
      const sk = await headerKey(ck, info("AEA_SK", i));
      await verify(segmentMacs.subarray(i * MAC, (i + 1) * MAC), mac(sk.mac, stored, EMPTY), `cluster ${cluster} segment ${i}`);
      const packed = await ctr(sk, stored);
      // Stored as is when compressing did not shrink it.
      const plain = packed.length === size ? packed : lzfseDecode(packed, size);
      // The HMAC covers the stored bytes; the sha256 checks what the decoder made of them.
      if (!equalBytes(await sha256(plain), h.subarray(8, 40))) {
        throw new Error(`AEA: cluster ${cluster} segment ${i} checksum mismatch`);
      }
      written += plain.length;
      yield plain;
    }
    clusterMac = nextMac;
  }
  if (written !== root.fileSize) throw new Error(`AEA: segments hold ${written} bytes, header says ${root.fileSize}`);
  // As in blacktop/ipsw: writers that add no padding leave its MAC unset, so only padding is checked.
  const padding = await q.rest();
  if (padding.length) await verify(clusterMac, hmacSha256((await headerKey(mainKey, info("AEA_PAK"))).mac, padding), "padding");
}
