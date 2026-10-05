/** HPKE (RFC 9180) single-shot open, base mode, for the suite Apple wraps AEA keys with: DHKEM(P-256), HKDF-SHA256, AES-256-GCM. */

import { base64ToBytes, base64UrlToBytes, concatBytes, toArrayBuffer } from "@carrier-explode/binary";
import { aesGcmOpen, hmacSha256, type WebKey } from "./webcrypto.ts";

const KEM_ID = 0x0010;
const KDF_ID = 0x0001;
const AEAD_ID = 0x0002;
const NK = 32;
const NN = 12;
const TAG = 16;
const P256 = { name: "ECDH", namedCurve: "P-256" } as const;

const enc = new TextEncoder();
const EMPTY = new Uint8Array(0);
const u16be = (n: number): Uint8Array => new Uint8Array([n >> 8, n & 0xff]);

const KEM_SUITE = concatBytes([enc.encode("KEM"), u16be(KEM_ID)]);
const HPKE_SUITE = concatBytes([enc.encode("HPKE"), u16be(KEM_ID), u16be(KDF_ID), u16be(AEAD_ID)]);

/** RFC 5869's absent salt is HashLen zeros, which WebCrypto needs spelled out. */
const extract = (salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> => hmacSha256(salt.length ? salt : new Uint8Array(32), ikm);

async function expand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const out: Uint8Array[] = [];
  let prev: Uint8Array = EMPTY;
  for (let i = 1, have = 0; have < length; i++) {
    prev = await hmacSha256(prk, prev, info, new Uint8Array([i]));
    out.push(prev);
    have += prev.length;
  }
  return concatBytes(out).subarray(0, length);
}

const labeledExtract = (suite: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array): Promise<Uint8Array> =>
  extract(salt, concatBytes([enc.encode("HPKE-v1"), suite, enc.encode(label), ikm]));

const labeledExpand = (suite: Uint8Array, prk: Uint8Array, label: string, info: Uint8Array, length: number): Promise<Uint8Array> =>
  expand(prk, concatBytes([u16be(length), enc.encode("HPKE-v1"), suite, enc.encode(label), info]), length);

const PEM = /^-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----\s*$/;

/** A PKCS#8 PEM P-256 key, which is what Apple's fcs-key URLs serve. Extractable: opening needs its public half. */
export async function p256PrivateKey(pem: string): Promise<WebKey> {
  const body = PEM.exec(pem.trim())?.[1];
  if (body === undefined) throw new Error("fcs key is not a PKCS#8 PEM");
  try {
    return await crypto.subtle.importKey("pkcs8", toArrayBuffer(base64ToBytes(body.replace(/\s/g, ""))), P256, true, ["deriveBits"]);
  } catch (e) {
    throw new Error("fcs key is not a P-256 private key", { cause: e });
  }
}

/** The uncompressed point (04 ‖ x ‖ y) of a P-256 key's public half. */
async function publicPoint(key: WebKey): Promise<Uint8Array> {
  const { x, y } = await crypto.subtle.exportKey("jwk", key);
  if (x === undefined || y === undefined) throw new Error("P-256 key exported without its public point");
  return concatBytes([new Uint8Array([4]), base64UrlToBytes(x), base64UrlToBytes(y)]);
}

/** Opens `ciphertext` (GCM tag appended) sealed to `key`; `encapsulated` is the sender's uncompressed ephemeral key. */
export async function hpkeOpen(key: WebKey, encapsulated: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  if (ciphertext.length < TAG) throw new Error("HPKE ciphertext shorter than its tag");
  const ephemeral = await crypto.subtle.importKey("raw", toArrayBuffer(encapsulated), P256, false, []);
  const dh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: ephemeral }, key, 256));
  const eaePrk = await labeledExtract(KEM_SUITE, EMPTY, "eae_prk", dh);
  const shared = await labeledExpand(KEM_SUITE, eaePrk, "shared_secret", concatBytes([encapsulated, await publicPoint(key)]), 32);

  const context = concatBytes([
    new Uint8Array([0]),
    await labeledExtract(HPKE_SUITE, EMPTY, "psk_id_hash", EMPTY),
    await labeledExtract(HPKE_SUITE, EMPTY, "info_hash", EMPTY),
  ]);
  const secret = await labeledExtract(HPKE_SUITE, shared, "secret", EMPTY);
  const aeadKey = await labeledExpand(HPKE_SUITE, secret, "key", context, NK);
  const nonce = await labeledExpand(HPKE_SUITE, secret, "base_nonce", context, NN);
  return aesGcmOpen(aeadKey, nonce, ciphertext);
}
