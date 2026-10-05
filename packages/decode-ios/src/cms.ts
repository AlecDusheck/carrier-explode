/**
 * CMS / PKCS #7 SignedData unwrapper for signed configuration profiles.
 * Structure per RFC 5652 §5; the signature itself is not verified.
 */

import { readTlv, children, octets, readOid, oidName, readName, readTime, parseCertificate, requireTlv, type CertInfo, type Tlv } from "./der.ts";
import { colonHex, errorMessage } from "@carrier-explode/binary";

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
  /** Embedded certificates that did not parse, by position among the certificates; they are left out of `certificates`. */
  certificateErrors: string[];
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
  return oidName(readOid(b, requireTlv(children(b, t)[0], "algorithm OID")));
}

/** Parses a DER or BER ContentInfo wrapping SignedData. */ // RFC 5652 §3, §5.1
export function parseSignedData(b: Uint8Array): CmsSignedData {
  const ci = readTlv(b, 0);
  const [type, wrapped] = children(b, ci);
  if (readOid(b, requireTlv(type, "content type")) !== SIGNED_DATA) throw new Error("not CMS SignedData");
  const sd = requireTlv(children(b, requireTlv(wrapped, "content"))[0], "SignedData");
  const f = children(b, sd);
  // version, digestAlgorithms, encapContentInfo, [0] certificates?, [1] crls?, signerInfos
  const digestAlgorithms = children(b, requireTlv(f[1], "digestAlgorithms")).map((a) => algName(b, a));
  const [eType, eContent] = children(b, requireTlv(f[2], "encapContentInfo"));
  const content = eContent ? octets(b, requireTlv(children(b, eContent)[0], "eContent")) : new Uint8Array();

  const certificates: CertInfo[] = [];
  const certificateErrors: string[] = [];
  const certSerials: Array<{ issuer: string; serial: string }> = [];
  let k = 3;
  const certs = f[k];
  if (certs?.tag === 0xa0) {
    for (const [i, c] of children(b, certs).entries()) {
      if (c.tag !== 0x30) continue; // skip attribute certificates and other choices
      try {
        const info = parseCertificate(b, c.start);
        certificates.push(info);
        certSerials.push({ issuer: info.issuer, serial: info.serial });
      } catch (e) {
        certificateErrors.push(`certificate ${i + 1}: ${errorMessage(e)}`);
      }
    }
    k++;
  }
  if (f[k]?.tag === 0xa1) k++;

  const signers: CmsSigner[] = [];
  const signerInfos = f[k];
  for (const si of signerInfos ? children(b, signerInfos) : []) {
    // RFC 5652 §5.3: version, sid, digestAlgorithm, [0] signedAttrs?, signatureAlgorithm, signature, [1]?
    const p = children(b, si);
    const s: CmsSigner = { digestAlgorithm: algName(b, requireTlv(p[2], "digestAlgorithm")), signatureAlgorithm: "" };
    const sid = requireTlv(p[1], "signer identifier");
    if (sid.tag === 0x30) {
      const [iss, ser] = children(b, sid);
      const serial = requireTlv(ser, "signer serial");
      s.issuer = readName(b, requireTlv(iss, "signer issuer"));
      s.serial = colonHex(b.subarray(serial.contentStart, serial.contentEnd));
      const at = certSerials.findIndex((c) => c.issuer === s.issuer && c.serial === s.serial);
      if (at >= 0) s.certificate = at;
    } else {
      s.subjectKeyId = colonHex(octets(b, sid));
    }
    let j = 3;
    const signedAttrs = p[j];
    if (signedAttrs?.tag === 0xa0) {
      for (const attr of children(b, signedAttrs)) {
        const [oid, vals] = children(b, attr);
        if (readOid(b, requireTlv(oid, "attribute type")) === "1.2.840.113549.1.9.5") {
          s.signingTime = readTime(b, requireTlv(children(b, requireTlv(vals, "attribute values"))[0], "signingTime"));
        }
      }
      j++;
    }
    s.signatureAlgorithm = algName(b, requireTlv(p[j], "signatureAlgorithm"));
    signers.push(s);
  }
  return {
    contentType: oidName(readOid(b, requireTlv(eType, "eContentType"))),
    content,
    detached: !eContent,
    digestAlgorithms,
    certificates,
    certificateErrors,
    signers,
  };
}
