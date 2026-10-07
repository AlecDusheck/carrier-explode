/**
 * Minimal ASN.1 BER/DER reader plus X.509 certificate summaries. Accepts the
 * BER indefinite-length and constructed-string forms that signed profiles use.
 */

import { b64ToBytes, byteAt, colonHex, errorMessage, latin1, u32be } from "@carrier-explode/binary";

export interface Tlv {
	/** Identifier octet (low-tag-number form). */
	tag: number;
	constructed: boolean;
	/** 0 universal, 1 application, 2 context, 3 private. */
	cls: number;
	/** Tag number within its class. */
	num: number;
	start: number;
	/** Offset just past the identifier octets. */
	tagEnd: number;
	/** Content bounds; for indefinite lengths the end excludes the 00 00 terminator. */
	contentStart: number;
	contentEnd: number;
	/** Offset just past the element, terminator included. */
	end: number;
}

const MAX_DEPTH = 64;

/** Reads one element at `off`, not beyond `limit`. */ // ITU-T X.690 §8.1
export function readTlv(b: Uint8Array, off: number, limit = b.length, depth = 0): Tlv {
	if (depth > MAX_DEPTH) throw new Error("ASN.1 nested too deep");
	if (off + 2 > limit) throw new Error(`ASN.1 element truncated at ${off}`);
	const tag = byteAt(b, off);
	let p = off + 1;
	let num = tag & 0x1f;
	if (num === 0x1f) {
		num = 0;
		let c: number;
		do {
			if (p >= limit) throw new Error("ASN.1 tag truncated");
			c = byteAt(b, p++);
			num = num * 128 + (c & 0x7f);
		} while (c & 0x80);
	}
	if (p >= limit) throw new Error("ASN.1 length truncated");
	const tagEnd = p;
	const first = byteAt(b, p++);
	const constructed = (tag & 0x20) !== 0;
	const base = { tag, constructed, cls: tag >> 6, num, start: off, tagEnd };
	if (first === 0x80) {
		// X.690 §8.1.3.6: indefinite form, children until 00 00
		if (!constructed) throw new Error("indefinite length on a primitive element");
		let q = p;
		while (true) {
			if (q + 2 > limit) throw new Error("unterminated indefinite-length element");
			if (b[q] === 0 && b[q + 1] === 0) return { ...base, contentStart: p, contentEnd: q, end: q + 2 };
			q = readTlv(b, q, limit, depth + 1).end;
		}
	}
	let len = first;
	if (first & 0x80) {
		const n = first & 0x7f;
		if (n > 4 || p + n > limit) throw new Error("ASN.1 length too long");
		len = 0;
		for (let i = 0; i < n; i++) len = len * 256 + byteAt(b, p++);
	}
	if (p + len > limit) throw new Error(`ASN.1 element at ${off} overruns its parent`);
	return { ...base, contentStart: p, contentEnd: p + len, end: p + len };
}

/** `t`, or an error naming the element a malformed structure lacks. */
export function requireTlv(t: Tlv | undefined, what: string): Tlv {
	if (t === undefined) throw new Error(`ASN.1 ${what} missing`);
	return t;
}

export function children(b: Uint8Array, t: Tlv): Tlv[] {
	const out: Tlv[] = [];
	for (let p = t.contentStart; p < t.contentEnd;) {
		const c = readTlv(b, p, t.contentEnd);
		out.push(c);
		p = c.end;
	}
	return out;
}

/** Content octets; constructed (BER-chunked) strings are concatenated. */ // X.690 §8.7.3
export function octets(b: Uint8Array, t: Tlv): Uint8Array {
	if (!t.constructed) return b.subarray(t.contentStart, t.contentEnd);
	const parts = children(b, t).map((c) => octets(b, c));
	const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
	let at = 0;
	for (const x of parts) {
		out.set(x, at);
		at += x.length;
	}
	return out;
}

export function oidString(v: Uint8Array): string {
	const arcs: string[] = [];
	let n = 0n;
	for (const x of v) {
		n = (n << 7n) | BigInt(x & 0x7f);
		if (!(x & 0x80)) {
			if (!arcs.length) {
				const first = n < 80n ? n / 40n : 2n;
				arcs.push(String(first), String(n - first * 40n));
			} else arcs.push(String(n));
			n = 0n;
		}
	}
	return arcs.join(".");
}

// RFC 4519, RFC 5280, RFC 8017, RFC 5652, RFC 5758, FIPS 180-4 OIDs
const OIDS: Record<string, string> = {
	"2.5.4.3": "CN",
	"2.5.4.4": "SN",
	"2.5.4.5": "serialNumber",
	"2.5.4.6": "C",
	"2.5.4.7": "L",
	"2.5.4.8": "ST",
	"2.5.4.9": "street",
	"2.5.4.10": "O",
	"2.5.4.11": "OU",
	"2.5.4.12": "title",
	"2.5.4.42": "GN",
	"2.5.4.45": "x500UniqueIdentifier",
	"0.9.2342.19200300.100.1.1": "UID",
	"0.9.2342.19200300.100.1.25": "DC",
	"1.2.840.113549.1.9.1": "emailAddress",
	"1.2.840.113549.1.1.1": "rsaEncryption",
	"1.2.840.113549.1.1.4": "md5WithRSAEncryption",
	"1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
	"1.2.840.113549.1.1.10": "RSASSA-PSS",
	"1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
	"1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
	"1.2.840.113549.1.1.13": "sha512WithRSAEncryption",
	"1.2.840.10045.2.1": "ecPublicKey",
	"1.2.840.10045.4.1": "ecdsa-with-SHA1",
	"1.2.840.10045.4.3.2": "ecdsa-with-SHA256",
	"1.2.840.10045.4.3.3": "ecdsa-with-SHA384",
	"1.2.840.10045.4.3.4": "ecdsa-with-SHA512",
	"1.2.840.10045.3.1.7": "prime256v1",
	"1.3.132.0.34": "secp384r1",
	"1.3.132.0.35": "secp521r1",
	"1.3.14.3.2.26": "sha1",
	"1.2.840.113549.2.5": "md5",
	"2.16.840.1.101.3.4.2.1": "sha256",
	"2.16.840.1.101.3.4.2.2": "sha384",
	"2.16.840.1.101.3.4.2.3": "sha512",
	"1.2.840.113549.1.7.1": "data",
	"1.2.840.113549.1.7.2": "signedData",
	"1.2.840.113549.1.9.3": "contentType",
	"1.2.840.113549.1.9.4": "messageDigest",
	"1.2.840.113549.1.9.5": "signingTime",
};

export function oidName(oid: string): string {
	return OIDS[oid] ?? oid;
}

export function readOid(b: Uint8Array, t: Tlv): string {
	if (t.tag !== 0x06) throw new Error("expected an OBJECT IDENTIFIER");
	return oidString(b.subarray(t.contentStart, t.contentEnd));
}

const utf8 = new TextDecoder();
const utf16 = new TextDecoder("utf-16be");

/** Any ASN.1 character string as text. */ // X.680 §41
function readString(b: Uint8Array, t: Tlv): string {
	const v = octets(b, t);
	switch (t.num) {
		case 0x1e:
			return utf16.decode(v); // BMPString
		case 0x1c: {
			// UniversalString (UTF-32BE)
			let s = "";
			for (let i = 0; i + 3 < v.length; i += 4) s += String.fromCodePoint(u32be(v, i));
			return s;
		}
		case 0x14:
			return latin1(v); // T61String, treated as Latin-1 like most tools
		default:
			return utf8.decode(v);
	}
}

/** UTCTime or GeneralizedTime as an ISO 8601 string. */ // RFC 5280 §4.1.2.5
export function readTime(b: Uint8Array, t: Tlv): string {
	const s = latin1(b.subarray(t.contentStart, t.contentEnd));
	const m = /^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?(Z|[+-]\d{4})?$/.exec(s);
	if (!m) return s;
	const [, y = "", month, day, hour, minute, second, offset] = m;
	const year = y.length === 2 ? (Number(y) >= 50 ? "19" : "20") + y : y; // RFC 5280 §4.1.2.5.1
	const zone = !offset || offset === "Z" ? "Z" : `${offset.slice(0, 3)}:${offset.slice(3)}`;
	return `${year}-${month}-${day}T${hour}:${minute}:${second ?? "00"}${zone}`;
}

/** X.501 Name in RFC 4514 order (most specific first), e.g. "CN=x, O=y, C=US". */
export function readName(b: Uint8Array, t: Tlv): string {
	const rdns = children(b, t).map((set) =>
		children(b, set)
			.map((atv) => {
				const [type, value] = children(b, atv);
				return `${oidName(readOid(b, requireTlv(type, "attribute type")))}=${readString(b, requireTlv(value, "attribute value"))}`;
			})
			.join("+"),
	);
	return rdns.toReversed().join(", ");
}

export interface CertInfo {
	subject: string;
	issuer: string;
	/** Serial number as colon-separated hex. */
	serial: string;
	notBefore: string;
	notAfter: string;
	signatureAlgorithm: string;
	keyAlgorithm: string;
	/** RSA modulus size in bits, or the EC curve name. */
	keySize?: number;
	curve?: string;
	/** Why the key's size or curve could not be read; the rest of the certificate is still summarised. */
	keyError?: string;
	selfIssued: boolean;
	isCA?: boolean;
}

function leadingBits(v: Uint8Array): number {
	let i = 0;
	while (i < v.length && v[i] === 0) i++;
	if (i === v.length) return 0;
	return (v.length - i) * 8 - Math.clz32(byteAt(v, i)) + 24;
}

/** Summary of an X.509 certificate starting at `off`. */ // RFC 5280 §4.1
export function parseCertificate(b: Uint8Array, off = 0): CertInfo {
	const cert = readTlv(b, off);
	const [tbs, sigAlg] = children(b, cert);
	const f = children(b, requireTlv(tbs, "tbsCertificate"));
	const field = (i: number, what: string): Tlv => requireTlv(f[i], what);
	let i = 0;
	if (field(i, "serial").tag === 0xa0) i++; // [0] version
	const serialTlv = field(i, "serial");
	const serial = colonHex(b.subarray(serialTlv.contentStart, serialTlv.contentEnd));
	i += 2; // serial, inner signature algorithm
	const issuer = readName(b, field(i++, "issuer"));
	const [nb, na] = children(b, field(i++, "validity"));
	const subject = readName(b, field(i++, "subject"));
	const [alg, key] = children(b, field(i++, "subjectPublicKeyInfo"));
	const [keyOid, params] = children(b, requireTlv(alg, "key algorithm"));
	const keyAlgorithm = oidName(readOid(b, requireTlv(keyOid, "key algorithm OID")));
	const info: CertInfo = {
		subject,
		issuer,
		serial,
		notBefore: readTime(b, requireTlv(nb, "notBefore")),
		notAfter: readTime(b, requireTlv(na, "notAfter")),
		signatureAlgorithm: oidName(
			readOid(
				b,
				requireTlv(children(b, requireTlv(sigAlg, "signatureAlgorithm"))[0], "signature algorithm OID"),
			),
		),
		keyAlgorithm,
		selfIssued: subject === issuer,
	};
	try {
		if (keyAlgorithm === "rsaEncryption") {
			// RFC 8017 §A.1.1: BIT STRING wraps RSAPublicKey { modulus, publicExponent }
			const bits = requireTlv(key, "subjectPublicKey");
			const [n] = children(b, readTlv(b, bits.contentStart + 1, bits.contentEnd));
			const modulus = requireTlv(n, "RSA modulus");
			info.keySize = leadingBits(b.subarray(modulus.contentStart, modulus.contentEnd));
		} else if (keyAlgorithm === "ecPublicKey" && params?.tag === 0x06) {
			info.curve = oidName(readOid(b, params));
		}
	} catch (e) {
		info.keyError = errorMessage(e);
	}
	// RFC 5280 §4.2.1.9 basicConstraints, found among the [3] extensions
	const ext = f.slice(i).find((x) => x.tag === 0xa3);
	if (ext) {
		for (const e of children(b, requireTlv(children(b, ext)[0], "extensions"))) {
			const parts = children(b, e);
			if (readOid(b, requireTlv(parts[0], "extension OID")) !== "2.5.29.19") continue;
			const val = requireTlv(parts.at(-1), "extension value");
			const [first] = children(b, readTlv(b, val.contentStart, val.contentEnd));
			info.isCA = first?.tag === 0x01 && b[first.contentStart] !== 0;
		}
	}
	return info;
}

/** Every PEM block of the given label in `text`, decoded. */ // RFC 7468
export function pemBlocks(text: string, label = "CERTIFICATE"): Uint8Array[] {
	const re = new RegExp(`-----BEGIN ${label}-----([^-]*)-----END ${label}-----`, "g");
	return [...text.matchAll(re)].map(([, body = ""]) => b64ToBytes(body)).filter((b) => b.length > 0);
}
