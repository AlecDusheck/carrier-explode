/**
 * CMS / PKCS #7 SignedData unwrapper for signed configuration profiles.
 * Structure per RFC 5652 §5; the signature itself is not verified.
 */

import { readTlv, children, octets, readOid, oidName, readName, readTime, parseCertificate, type CertInfo, type Tlv } from "./der";
import { colonHex } from "./bytes";

export interface CmsSigner {
  /** IssuerAndSerialNumber form of the signer identifier. */
  issuer?: string;
  serial?: string;
  /** SubjectKeyIdentifier form of the signer identifier. */
  subjectKeyId?: string;
  digestAlgorithm: string;
  signatureAlgorithm: string;
  /** signingTime signed attribute, ISO 8601. */
  signingTime?: string;
  /** Index into `certificates` of the signer's certificate, when it is embedded. */
  certificate?: number;
}

export interface CmsSignedData {
  /** eContentType, e.g. "data". */
  contentType: string;
  /** Encapsulated content; empty for a detached signature. */
  content: Uint8Array;
  detached: boolean;
  digestAlgorithms: string[];
  certificates: CertInfo[];
  signers: CmsSigner[];
}

const SIGNED_DATA = "1.2.840.113549.1.7.2";

/** True when the bytes open with a ContentInfo whose type is signedData. */
export function isCmsSignedData(b: Uint8Array): boolean {
  if (b.length < 16 || b[0] !== 0x30) return false;
  try {
    const ci = readTlv(b, 0);
    const oid = readTlv(b, ci.contentStart, ci.contentEnd);
    return oid.tag === 0x06 && readOid(b, oid) === SIGNED_DATA;
  } catch {
    return false;
  }
}

function algName(b: Uint8Array, t: Tlv): string {
  return oidName(readOid(b, children(b, t)[0]));
}

/** Parses a DER or BER ContentInfo wrapping SignedData. */ // RFC 5652 §3, §5.1
export function parseSignedData(b: Uint8Array): CmsSignedData {
  const ci = readTlv(b, 0);
  const [type, wrapped] = children(b, ci);
  if (readOid(b, type) !== SIGNED_DATA) throw new Error("not CMS SignedData");
  const sd = children(b, wrapped)[0];
  const f = children(b, sd);
  // version, digestAlgorithms, encapContentInfo, [0] certificates?, [1] crls?, signerInfos
  const digestAlgorithms = children(b, f[1]).map((a) => algName(b, a));
  const [eType, eContent] = children(b, f[2]);
  const content = eContent ? octets(b, children(b, eContent)[0]) : new Uint8Array();

  const certificates: CertInfo[] = [];
  const certSerials: Array<{ issuer: string; serial: string }> = [];
  let k = 3;
  if (f[k]?.tag === 0xa0) {
    for (const c of children(b, f[k])) {
      if (c.tag !== 0x30) continue; // skip attribute certificates and other choices
      try {
        const info = parseCertificate(b, c.start);
        certificates.push(info);
        certSerials.push({ issuer: info.issuer, serial: info.serial });
      } catch { /* an unparseable certificate is left out */ }
    }
    k++;
  }
  if (f[k]?.tag === 0xa1) k++;

  const signers: CmsSigner[] = [];
  for (const si of f[k] ? children(b, f[k]) : []) {
    // RFC 5652 §5.3: version, sid, digestAlgorithm, [0] signedAttrs?, signatureAlgorithm, signature, [1]?
    const p = children(b, si);
    const s: CmsSigner = { digestAlgorithm: algName(b, p[2]), signatureAlgorithm: "" };
    if (p[1].tag === 0x30) {
      const [iss, ser] = children(b, p[1]);
      s.issuer = readName(b, iss);
      s.serial = colonHex(b.subarray(ser.contentStart, ser.contentEnd));
      const at = certSerials.findIndex((c) => c.issuer === s.issuer && c.serial === s.serial);
      if (at >= 0) s.certificate = at;
    } else {
      s.subjectKeyId = colonHex(octets(b, p[1]));
    }
    let j = 3;
    if (p[j]?.tag === 0xa0) {
      for (const attr of children(b, p[j])) {
        const [oid, vals] = children(b, attr);
        if (readOid(b, oid) === "1.2.840.113549.1.9.5") s.signingTime = readTime(b, children(b, vals)[0]);
      }
      j++;
    }
    s.signatureAlgorithm = algName(b, p[j]);
    signers.push(s);
  }
  return {
    contentType: oidName(readOid(b, eType)),
    content,
    detached: !eContent,
    digestAlgorithms,
    certificates,
    signers,
  };
}
