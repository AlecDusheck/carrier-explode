/** The WebCrypto primitives AEA and its key unwrap need, so they run in Workers as well as Node. */

import { concatBytes, toArrayBuffer } from "@carrier-explode/binary";

const { subtle } = crypto;

/** WebCrypto's CryptoKey, which Node's types do not declare globally. */
export type WebKey = Awaited<ReturnType<typeof subtle.importKey>>;

export async function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", toArrayBuffer(ikm), "HKDF", false, ["deriveBits"]);
  const params = { name: "HKDF", hash: "SHA-256", salt: toArrayBuffer(salt), info: toArrayBuffer(info) };
  return new Uint8Array(await subtle.deriveBits(params, key, length * 8));
}

/** HMAC-SHA256 over the parts, end to end. WebCrypto refuses an empty key. */
export async function hmacSha256(key: Uint8Array, ...parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const k = await subtle.importKey("raw", toArrayBuffer(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, toArrayBuffer(concatBytes(parts))));
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest("SHA-256", toArrayBuffer(data)));
}

/** AES-256-CTR with the whole 16-byte IV as the counter block, as OpenSSL counts. */
export async function aesCtr(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey("raw", toArrayBuffer(key), "AES-CTR", false, ["decrypt"]);
  return new Uint8Array(await subtle.decrypt({ name: "AES-CTR", counter: toArrayBuffer(iv), length: 128 }, k, toArrayBuffer(data)));
}

/** AES-GCM open; `sealed` has the 16-byte tag appended, and a wrong tag rejects. */
export async function aesGcmOpen(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey("raw", toArrayBuffer(key), "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(nonce), tagLength: 128 }, k, toArrayBuffer(sealed)));
}

/** Compares in time independent of where the first difference is. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  a.forEach((x, i) => {
    diff |= x ^ (b[i] ?? 0);
  });
  return diff === 0;
}
