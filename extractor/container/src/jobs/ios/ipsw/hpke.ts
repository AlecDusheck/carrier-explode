/** HPKE (RFC 9180) single-shot open, base mode, for the suite Apple wraps AEA keys with: DHKEM(P-256), HKDF-SHA256, AES-256-GCM. */

import { createDecipheriv, createECDH, createHmac, createPrivateKey } from "node:crypto";

const KEM_ID = 0x0010;
const KDF_ID = 0x0001;
const AEAD_ID = 0x0002;
const NK = 32;
const NN = 12;
const TAG = 16;

const enc = new TextEncoder();
const u16be = (n: number): Uint8Array => new Uint8Array([n >> 8, n & 0xff]);
const concat = (...parts: readonly Uint8Array[]): Uint8Array => Buffer.concat(parts);

const KEM_SUITE = concat(enc.encode("KEM"), u16be(KEM_ID));
const HPKE_SUITE = concat(enc.encode("HPKE"), u16be(KEM_ID), u16be(KDF_ID), u16be(AEAD_ID));

const extract = (salt: Uint8Array, ikm: Uint8Array): Uint8Array =>
  createHmac("sha256", salt.length ? salt : new Uint8Array(32)).update(ikm).digest();

function expand(prk: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  const out: Uint8Array[] = [];
  let prev = new Uint8Array(0);
  for (let i = 1, have = 0; have < length; i++) {
    prev = createHmac("sha256", prk).update(prev).update(info).update(new Uint8Array([i])).digest();
    out.push(prev);
    have += prev.length;
  }
  return concat(...out).subarray(0, length);
}

const labeledExtract = (suite: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array): Uint8Array =>
  extract(salt, concat(enc.encode("HPKE-v1"), suite, enc.encode(label), ikm));

const labeledExpand = (suite: Uint8Array, prk: Uint8Array, label: string, info: Uint8Array, length: number): Uint8Array =>
  expand(prk, concat(u16be(length), enc.encode("HPKE-v1"), suite, enc.encode(label), info), length);

/** The raw 32-byte P-256 scalar of a PKCS#8 PEM key, which is what Apple's fcs-key URLs serve. */
export function p256Scalar(pem: string): Uint8Array {
  const jwk = createPrivateKey(pem).export({ format: "jwk" });
  if (jwk.crv !== "P-256" || typeof jwk.d !== "string") throw new Error("fcs key is not a P-256 private key");
  return Buffer.from(jwk.d, "base64url");
}

/**
 * Opens `ciphertext` (with its GCM tag appended) sent to the holder of `scalar`.
 * `encapsulated` is the sender's ephemeral public key, uncompressed (65 bytes).
 */
export function hpkeOpen(scalar: Uint8Array, encapsulated: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  if (ciphertext.length < TAG) throw new Error("HPKE ciphertext shorter than its tag");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  const dh = ecdh.computeSecret(encapsulated);
  const kemContext = concat(encapsulated, ecdh.getPublicKey());
  const eaePrk = labeledExtract(KEM_SUITE, new Uint8Array(0), "eae_prk", dh);
  const shared = labeledExpand(KEM_SUITE, eaePrk, "shared_secret", kemContext, 32);

  const empty = new Uint8Array(0);
  const context = concat(
    new Uint8Array([0]),
    labeledExtract(HPKE_SUITE, empty, "psk_id_hash", empty),
    labeledExtract(HPKE_SUITE, empty, "info_hash", empty),
  );
  const secret = labeledExtract(HPKE_SUITE, shared, "secret", empty);
  const key = labeledExpand(HPKE_SUITE, secret, "key", context, NK);
  const nonce = labeledExpand(HPKE_SUITE, secret, "base_nonce", context, NN);

  const d = createDecipheriv("aes-256-gcm", key, nonce);
  d.setAuthTag(ciphertext.subarray(ciphertext.length - TAG));
  return concat(d.update(ciphertext.subarray(0, ciphertext.length - TAG)), d.final());
}
