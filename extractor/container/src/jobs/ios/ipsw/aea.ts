/**
 * Apple Encrypted Archive (AEA1, symmetric profile) decrypted as a stream, so a
 * 9 GB .dmg.aea never sits on disk encrypted. Key schedule as blacktop/ipsw pkg/aea:
 *
 *   "AEA1" u32 profile  u32 authLen  authData  salt[32]  rootMAC[32]  rootHeader[48]  clusterMAC[32]
 *   per cluster: segmentHeaders[n*40]  nextClusterMAC[32]  segmentMACs[n*32]  segments...
 *   padding, MACed by the last nextClusterMAC
 */

import { createDecipheriv, createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import * as v from "valibot";

import { base64ToBytes, safeU64le, u32le } from "../../../../../../src/lib/binary/index.ts";
import { lzfseDecode } from "../shared/lzfse.ts";
import { ByteQueue } from "./byte-queue.ts";
import { hpkeOpen, p256Scalar } from "./hpke.ts";

const MAGIC = "AEA1";
const PROFILE_SYMMETRIC = 1;
const HEADER_KEY_SIZE = 80;

/** The archive's key/value auth data: where its key lives (wkms URLs, wrapped key). */
export type AeaMetadata = ReadonlyMap<string, Uint8Array>;

export interface AeaHeader {
  readonly profile: number;
  /** The raw profile word, which the main key's derivation mixes in. */
  readonly profileWord: number;
  /** Authenticated, not interpreted; Apple's is key/value metadata (aeaMetadata). */
  readonly authData: Uint8Array;
  /** Header plus auth data: where the prologue starts. */
  readonly length: number;
}

const latin = new TextDecoder("latin1");
const utf8 = new TextDecoder();
const enc = new TextEncoder();

/** The fixed header and auth data, from the first bytes of the archive (12 + authLen of them). */
export function parseAeaHeader(b: Uint8Array): AeaHeader {
  if (b.length < 12 || latin.decode(b.subarray(0, 4)) !== MAGIC) throw new Error("not an AEA1 archive");
  const profileWord = u32le(b, 4);
  const authLen = u32le(b, 8);
  if (b.length < 12 + authLen) throw new Error(`AEA header wants ${12 + authLen} bytes, got ${b.length}`);
  return { profile: profileWord & 0xffffff, profileWord, authData: b.subarray(12, 12 + authLen), length: 12 + authLen };
}

/** Apple's auth data: u32le length (itself included), then `key NUL value`, repeated. */
export function aeaMetadata(authData: Uint8Array): AeaMetadata {
  const metadata = new Map<string, Uint8Array>();
  for (let at = 0; at < authData.length; ) {
    const len = u32le(authData, at);
    if (len < 4 || at + len > authData.length) throw new Error(`AEA metadata entry at ${at} overruns the auth data`);
    const kv = authData.subarray(at + 4, at + len);
    const nul = kv.indexOf(0);
    if (nul < 0) throw new Error(`AEA metadata entry at ${at} has no key terminator`);
    metadata.set(utf8.decode(kv.subarray(0, nul)), kv.subarray(nul + 1));
    at += len;
  }
  return metadata;
}

const FcsResponse = v.object({ "enc-request": v.string(), "wrapped-key": v.string() });

/** The archive key: HPKE-wrapped in `fcs-response`, unwrapped with the private key Apple serves openly at `fcs-key-url`. */
export async function archiveKey(meta: AeaMetadata, fetchPem: (url: string) => Promise<string>): Promise<Uint8Array> {
  const response = meta.get("com.apple.wkms.fcs-response");
  const url = meta.get("com.apple.wkms.fcs-key-url");
  if (!response || !url) throw new Error("AEA metadata lacks fcs-response or fcs-key-url");
  const fcs = v.parse(FcsResponse, JSON.parse(utf8.decode(response)));
  const scalar = p256Scalar(await fetchPem(utf8.decode(url)));
  return hpkeOpen(scalar, base64ToBytes(fcs["enc-request"]), base64ToBytes(fcs["wrapped-key"]));
}

/** MAC key, AES-256 key and CTR IV, as libAppleArchive derives them in one HKDF output. */
interface HeaderKey { readonly mac: Uint8Array; readonly key: Uint8Array; readonly iv: Uint8Array }

const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array =>
  new Uint8Array(hkdfSync("sha256", ikm, salt, info, length));

const info = (label: string, n?: number): Uint8Array => {
  const l = enc.encode(label);
  if (n === undefined) return l;
  const out = new Uint8Array(l.length + 4);
  out.set(l);
  new DataView(out.buffer).setUint32(l.length, n, true);
  return out;
};

function headerKey(ikm: Uint8Array, label: Uint8Array): HeaderKey {
  const k = hkdf(ikm, new Uint8Array(0), label, HEADER_KEY_SIZE);
  return { mac: k.subarray(0, 32), key: k.subarray(32, 64), iv: k.subarray(64, 80) };
}

/** libAppleArchive's salted HMAC: HMAC(key, salt ‖ data ‖ u64le(len salt)). */
function mac(key: Uint8Array, data: Uint8Array, salt: Uint8Array): Uint8Array {
  const len = new Uint8Array(8);
  new DataView(len.buffer).setBigUint64(0, BigInt(salt.length), true);
  return createHmac("sha256", key).update(salt).update(data).update(len).digest();
}

function verify(expected: Uint8Array, got: Uint8Array, what: string): void {
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new Error(`AEA: ${what} HMAC mismatch`);
}

function ctr(k: HeaderKey, data: Uint8Array): Uint8Array {
  const d = createDecipheriv("aes-256-ctr", k.key, k.iv);
  return Buffer.concat([d.update(data), d.final()]);
}

const concat = (...parts: readonly Uint8Array[]): Uint8Array => Buffer.concat(parts);

/** What IPSW archives use, and all this reads: LZFSE segments with sha256 checksums. */
const COMPRESSION_LZFSE = "e";
const CHECKSUM_SHA256 = 2;
/** A segment header: plain size, stored size, sha256. */
const SEGMENT_HEADER = 8 + 32;

interface RootHeader {
  readonly fileSize: number;
  readonly segmentSize: number;
  readonly segmentsPerCluster: number;
}

function rootHeader(b: Uint8Array): RootHeader {
  const compression = String.fromCharCode(b[24] ?? 0);
  const checksum = b[25];
  if (compression !== COMPRESSION_LZFSE) throw new Error(`AEA: segment compression '${compression}', expected LZFSE`);
  if (checksum !== CHECKSUM_SHA256) throw new Error(`AEA: segment checksum type ${checksum}, expected sha256`);
  return { fileSize: safeU64le(b, 0), segmentSize: u32le(b, 16), segmentsPerCluster: u32le(b, 20) };
}

/** A segment's plain bytes: stored as is when compressing did not shrink it, else LZFSE. */
const inflate = (data: Uint8Array, size: number): Uint8Array => (data.length === size ? data : lzfseDecode(data, size));

export interface DecryptHooks {
  /** The plain bytes, in order. */
  sink(plain: Uint8Array): Promise<void>;
  /** The plain size, once the root header is read and before any segment; throw to refuse (disk budget). */
  onSize?(size: number): void;
}

/** Decrypts `source` (the archive from offset 0) into `hooks.sink`, checking every MAC and checksum. Returns the plain size. */
export async function decryptAea(source: AsyncIterable<Uint8Array>, key: Uint8Array, hooks: DecryptHooks): Promise<number> {
  const q = new ByteQueue(source);
  const prefix = await q.read(12);
  const hdr = parseAeaHeader(concat(prefix, await q.read(u32le(prefix, 8))));
  if (hdr.profile !== PROFILE_SYMMETRIC) throw new Error(`AEA: profile ${hdr.profile} is not symmetric encryption`);

  const salt = await q.read(32);
  const mainKey = hkdf(key, salt, info("AEA_AMK", hdr.profileWord), key.length);
  const rootMac = await q.read(32);
  const encRoot = await q.read(48);
  let clusterMac = await q.read(32);

  const rhk = headerKey(mainKey, info("AEA_RHEK"));
  verify(rootMac, mac(rhk.mac, encRoot, concat(clusterMac, hdr.authData)), "root header");
  const root = rootHeader(ctr(rhk, encRoot));
  hooks.onSize?.(root.fileSize);

  let written = 0;
  for (let cluster = 0; written < root.fileSize; cluster++) {
    const ck = hkdf(mainKey, new Uint8Array(0), info("AEA_CK", cluster), 32);
    const chk = headerKey(ck, info("AEA_CHEK"));
    const encSegHdrs = await q.read(SEGMENT_HEADER * root.segmentsPerCluster);
    const nextMac = await q.read(32);
    const segMacs = await q.read(32 * root.segmentsPerCluster);
    verify(clusterMac, mac(chk.mac, encSegHdrs, concat(nextMac, segMacs)), `cluster ${cluster} header`);
    const segHdrs = ctr(chk, encSegHdrs);

    for (let i = 0; i < root.segmentsPerCluster && written < root.fileSize; i++) {
      const h = segHdrs.subarray(i * SEGMENT_HEADER, (i + 1) * SEGMENT_HEADER);
      const size = u32le(h, 0);
      // Segments have fixed slots; streaming them in order is right only while each one before was full.
      const slot = (cluster * root.segmentsPerCluster + i) * root.segmentSize;
      if (slot !== written) throw new Error(`AEA: segment ${cluster}/${i} belongs at ${slot}, stream is at ${written}`);
      const stored = await q.read(u32le(h, 4));
      const sk = headerKey(ck, info("AEA_SK", i));
      verify(segMacs.subarray(i * 32, (i + 1) * 32), mac(sk.mac, stored, new Uint8Array(0)), `cluster ${cluster} segment ${i}`);
      const plain = inflate(ctr(sk, stored), size);
      // The HMAC authenticated the stored bytes; the sha256 checks what the LZFSE decoder made of them.
      if (!timingSafeEqual(createHash("sha256").update(plain).digest(), h.subarray(8, 40))) {
        throw new Error(`AEA: cluster ${cluster} segment ${i} checksum mismatch`);
      }
      await hooks.sink(plain);
      written += plain.length;
    }
    clusterMac = nextMac;
  }
  if (written !== root.fileSize) throw new Error(`AEA: wrote ${written} bytes, header says ${root.fileSize}`);

  // Writers that add no padding leave its MAC unset, so (as in ipsw) only padding is checked.
  const padding = await q.rest();
  if (padding.length) {
    const pk = headerKey(mainKey, info("AEA_PAK"));
    verify(clusterMac, createHmac("sha256", pk.mac).update(padding).digest(), "padding");
  }
  return written;
}
