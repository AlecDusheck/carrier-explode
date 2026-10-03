/**
 * Apple Encrypted Archive (AEA1), symmetric profile, decrypted as a stream.
 * Since iOS 18 an IPSW's filesystem images are `.dmg.aea`; the OS image alone
 * is ~9 GB, so decrypting from a downloaded copy would hold it twice on a 20 GB
 * disk. Here the member's bytes go straight from HTTP through this into the
 * plain .dmg, which is all that lands on disk.
 *
 * Layout and key schedule follow blacktop/ipsw pkg/aea (pure Go), which
 * follows Apple's libAppleArchive:
 *
 *   header      "AEA1" u32 profile|scrypt<<24  u32 authLen  auth data (key/value metadata)
 *   prologue    salt[32]  rootHMAC[32]  encRootHeader[48]  firstClusterHMAC[32]
 *   cluster*    encSegmentHeaders[n*(8+cs)]  nextClusterHMAC[32]  segmentHMACs[n*32]  segments...
 *   padding     rest, authenticated by the last cluster's next-HMAC
 *
 * Every HMAC is checked, so a truncated or corrupt download fails here rather
 * than as a confusing APFS error later.
 */

import { createDecipheriv, createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { inflateSync } from "node:zlib";
import * as v from "valibot";

import { base64ToBytes, hexToBytes, safeU64le, u32le } from "../../../../../../src/lib/binary/index.ts";
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
  readonly authData: Uint8Array;
  readonly metadata: AeaMetadata;
  /** Header plus auth data: where the prologue starts. */
  readonly length: number;
}

const latin = new TextDecoder("latin1");
const utf8 = new TextDecoder();
const enc = new TextEncoder();

/** Header and metadata, from the first bytes of the archive (12 + authLen of them). */
export function parseAeaHeader(b: Uint8Array): AeaHeader {
  if (b.length < 12 || latin.decode(b.subarray(0, 4)) !== MAGIC) throw new Error("not an AEA1 archive");
  const profileWord = u32le(b, 4);
  const authLen = u32le(b, 8);
  if (b.length < 12 + authLen) throw new Error(`AEA header wants ${12 + authLen} bytes, got ${b.length}`);
  const authData = b.subarray(12, 12 + authLen);
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
  return { profile: profileWord & 0xffffff, profileWord, authData, metadata, length: 12 + authLen };
}

const FcsResponse = v.object({ "enc-request": v.string(), "wrapped-key": v.string() });

/**
 * The 32-byte archive key. Apple embeds it HPKE-wrapped (`fcs-response`) and
 * serves the unwrapping private key, unauthenticated, at `fcs-key-url`; so this
 * needs nothing but HTTPS. `fetchPem` gets that URL's body (it redirects to
 * fcs-keys-pub-prod.cdn-apple.com). Some archives carry the key in the clear.
 */
export async function archiveKey(meta: AeaMetadata, fetchPem: (url: string) => Promise<string>): Promise<Uint8Array> {
  const clear = meta.get("encryption_key");
  if (clear) return hexToBytes(utf8.decode(clear));
  const response = meta.get("com.apple.wkms.fcs-response");
  const url = meta.get("com.apple.wkms.fcs-key-url");
  if (!response || !url) throw new Error("AEA metadata has neither encryption_key nor fcs-response + fcs-key-url");
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

interface RootHeader {
  readonly fileSize: number;
  readonly segmentSize: number;
  readonly segmentsPerCluster: number;
  readonly compression: string;
  /** 0 none, 1 murmur64, 2 sha256: bytes per segment header after its two sizes. */
  readonly checksum: keyof typeof CHECKSUM_SIZE;
}

const CHECKSUM_SIZE = { 0: 0, 1: 8, 2: 32 } as const satisfies Record<number, number>;
const isChecksum = (n: number): n is keyof typeof CHECKSUM_SIZE => n in CHECKSUM_SIZE;

function rootHeader(b: Uint8Array): RootHeader {
  const checksum = b[25] ?? -1;
  if (!isChecksum(checksum)) throw new Error(`AEA: unknown checksum type ${checksum}`);
  return {
    fileSize: safeU64le(b, 0),
    segmentSize: u32le(b, 16),
    segmentsPerCluster: u32le(b, 20),
    compression: String.fromCharCode(b[24] ?? 0),
    checksum,
  };
}

/**
 * A segment's plain bytes. A segment that did not shrink is stored as is.
 * Filesystem images use LZFSE ('e'); zlib ('z') is cheap to support too. LZ4,
 * LZBITMAP and LZMA are not seen in IPSWs and fail loudly.
 */
function inflate(compression: string, data: Uint8Array, size: number): Uint8Array {
  if (data.length === size) return data;
  if (compression === "e") return lzfseDecode(data, size);
  if (compression === "z") return inflateSync(data);
  throw new Error(`AEA: segment compression '${compression}' is not supported`);
}

export interface DecryptHooks {
  /** The plain bytes, in order. */
  sink(plain: Uint8Array): Promise<void>;
  /** The plain size, once the root header is read and before any segment; throw to refuse (disk budget). */
  onSize?(size: number): void;
  onProgress?(written: number, total: number): void;
}

/**
 * Decrypts the archive in `source` (its bytes from offset 0). Resolves with
 * the plain size once the padding's HMAC proves the archive ended where its
 * writer ended it.
 */
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
  const segHdrSize = 8 + CHECKSUM_SIZE[root.checksum];
  hooks.onSize?.(root.fileSize);

  let written = 0;
  for (let cluster = 0; written < root.fileSize; cluster++) {
    const ck = hkdf(mainKey, new Uint8Array(0), info("AEA_CK", cluster), 32);
    const chk = headerKey(ck, info("AEA_CHEK"));
    const encSegHdrs = await q.read(segHdrSize * root.segmentsPerCluster);
    const nextMac = await q.read(32);
    const segMacs = await q.read(32 * root.segmentsPerCluster);
    verify(clusterMac, mac(chk.mac, encSegHdrs, concat(nextMac, segMacs)), `cluster ${cluster} header`);
    const segHdrs = ctr(chk, encSegHdrs);

    for (let i = 0; i < root.segmentsPerCluster && written < root.fileSize; i++) {
      const h = segHdrs.subarray(i * segHdrSize, (i + 1) * segHdrSize);
      const size = u32le(h, 0);
      if (size === 0) continue;
      // Segments sit at fixed slots in the plain file; writing in order is only right while every one before is full.
      const slot = (cluster * root.segmentsPerCluster + i) * root.segmentSize;
      if (slot !== written) throw new Error(`AEA: segment ${cluster}/${i} belongs at ${slot}, stream is at ${written}`);
      const stored = await q.read(u32le(h, 4));
      const sk = headerKey(ck, info("AEA_SK", i));
      verify(segMacs.subarray(i * 32, (i + 1) * 32), mac(sk.mac, stored, new Uint8Array(0)), `cluster ${cluster} segment ${i}`);
      const plain = inflate(root.compression, ctr(sk, stored), size);
      // The HMAC above already authenticates the bytes; sha256 is cheap enough to check too. A murmur
      // checksum is not re-checked: it is weaker than the HMAC, and Node has no murmur3.
      if (root.checksum === 2 && !timingSafeEqual(createHash("sha256").update(plain).digest(), h.subarray(8, 40))) {
        throw new Error(`AEA: cluster ${cluster} segment ${i} checksum mismatch`);
      }
      await hooks.sink(plain);
      written += plain.length;
      hooks.onProgress?.(written, root.fileSize);
    }
    clusterMac = nextMac;
  }
  if (written !== root.fileSize) throw new Error(`AEA: wrote ${written} bytes, header says ${root.fileSize}`);

  const padding = await q.rest();
  const pk = headerKey(mainKey, info("AEA_PAK"));
  verify(clusterMac, createHmac("sha256", pk.mac).update(padding).digest(), "padding");
  return written;
}
