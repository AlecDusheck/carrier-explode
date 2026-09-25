/**
 * carrier.dmu: the RSA public key used for Dynamic Mobile IP Key Update. The
 * Public Key Identifier is per RFC 4784; the key layout after it is inferred.
 */

import { beBigInt, bytesToHex } from "./bytes";

export interface DmuKey {
  /** Public Key Organization Identifier. */
  pkoid: number;
  pkoidName?: string;
  /** Public Key Organization Index. */
  pkoi: number;
  pkExpansion: number;
  /** Algorithm Type and Version. */
  atv: number;
  algorithm: string;
  dmuVersion: number;
  /** Public exponent, decimal. */
  exponent: string;
  modulusBits: number;
  modulus: string;
}

// RFC 4784 PKOID table (excerpt)
const PKOIDS: Record<number, string> = { 0x0a: "Verizon Wireless", 0x39: "Motorola", 0x57: "QUALCOMM" };
// RFC 4784 ATV values
const ATV: Record<number, { name: string; bits: number }> = {
  1: { name: "RSA-1024", bits: 1024 },
  2: { name: "RSA-768", bits: 768 },
  3: { name: "RSA-2048", bits: 2048 },
};

// RFC 4784 identifier (PKOID 8, PKOI 8, PK_Expansion 8, ATV 4, DMUV 4); then exponent, modulus as equal-width big-endian fields (corpus: 1 distinct 260-byte blob)
export function decodeDmu(b: Uint8Array): DmuKey {
  if (b.length < 8 || (b.length - 4) % 2) throw new Error("unexpected DMU key length");
  const atv = b[3] >> 4;
  const alg = ATV[atv];
  const half = (b.length - 4) / 2;
  if (alg && alg.bits !== half * 8) throw new Error(`${alg.name} key expected, found ${half * 8}-bit fields`);
  const e = beBigInt(b.subarray(4, 4 + half));
  const n = b.subarray(4 + half);
  let first = 0;
  while (first < n.length && n[first] === 0) first++;
  const modulusBits = first === n.length ? 0 : (n.length - first) * 8 - (Math.clz32(n[first]) - 24);
  return {
    pkoid: b[0],
    pkoidName: PKOIDS[b[0]],
    pkoi: b[1],
    pkExpansion: b[2],
    atv,
    algorithm: alg?.name ?? `reserved (${atv})`,
    dmuVersion: b[3] & 15,
    exponent: e.toString(),
    modulusBits,
    modulus: bytesToHex(n),
  };
}
