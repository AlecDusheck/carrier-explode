import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { zipSync } from "fflate";

import { crc16Ccitt, BitReader } from "@carrier-explode/binary";
import { describePrl } from "@carrier-explode/decode-qualcomm";
import { readTlv, children, octets, oidString, readTime, parseCertificate, pemBlocks } from "../src/der.ts";
import { isCmsSignedData, parseSignedData } from "../src/cms.ts";
import { decodeDmu } from "../src/dmu.ts";
import { decodeCaf } from "../src/caf.ts";
import { parsePlist } from "../src/plist.ts";
import { openIpcc, decodeFile, contentTypeOf, decodedPlist, MemberError } from "../src/bundle.ts";
import { defined, record } from "./defined.ts";
import { hexOf, textOf } from "./raw.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", "formats", n)));
const prl = (n: string) =>
	new Uint8Array(readFileSync(join(here, "../../decode-qualcomm/test/fixtures/prl", n)));

/** A one-file bundle, so decodeFile's classification and wiring are exercised end to end. */
function bundleWith(files: Record<string, Uint8Array>) {
	const zip: Record<string, Uint8Array> = {};
	for (const [p, b] of Object.entries(files)) zip[`Payload/Test.bundle/${p}`] = b;
	return openIpcc(zipSync(zip));
}

describe("a member that is not its format", () => {
	it("shows a .plist that is not a plist as its text, and says so", () => {
		const b = bundleWith({ "carrier.plist": new TextEncoder().encode("CarrierName = Test;\n") });
		expect(decodeFile(b, "carrier.plist")).toMatchObject({
			kind: "plist",
			raw: { text: "CarrierName = Test;\n" },
			error: { reason: "unrecognised", message: "not a plist" },
		});
	});

	it("never decodes bytes that are not UTF-8 into replacement characters", () => {
		const latin1 = new Uint8Array([
			...new TextEncoder().encode("CarrierName = M"),
			0xe9,
			...new TextEncoder().encode("tro;\n").subarray(0, 5),
		]);
		const d = decodeFile(bundleWith({ "carrier.plist": latin1 }), "carrier.plist");
		expect(d).toMatchObject({ kind: "plist", error: { reason: "unrecognised" } });
		expect(textOf(d)).toBeUndefined();
		expect(hexOf(d)).toBeDefined();
	});

	it("throws a MemberError only for a path the bundle lacks, keeping a member that does not decode", () => {
		const b = bundleWith({ "carrier.plist": new Uint8Array([0xff]) });
		expect(() => decodeFile(b, "absent.plist")).toThrow(MemberError);
		expect(() => decodeFile(b, "dir/")).toThrow(MemberError);
		expect(decodeFile(b, "carrier.plist").error).not.toBeNull();
	});

	it("keeps a legacy plain-text .strings as text", () => {
		const d = decodeFile(
			bundleWith({ "en.lproj/Localizable.strings": new TextEncoder().encode('"A" = "B";\n') }),
			"en.lproj/Localizable.strings",
		);
		expect(d).toMatchObject({ kind: "strings", raw: { text: '"A" = "B";\n' } });
		expect(d.error).toBeNull();
	});
});

describe("bit reader and CRC", () => {
	it("reads MSB-first fields across byte boundaries", () => {
		const r = new BitReader(new Uint8Array([0b10110011, 0b01010101]));
		expect(r.u(3)).toBe(0b101);
		expect(r.u(7)).toBe(0b1001101);
		expect(r.hex(6)).toBe("54");
		expect(() => r.u(1)).toThrow(/past end/);
	});

	it("computes the complement of CRC-16/CCITT-FALSE", () => {
		const b = new TextEncoder().encode("123456789");
		expect(crc16Ccitt(b)).toBe(~0x29b1 & 0xffff); // published check value 0x29b1
	});
});

describe("PRL", () => {
	it("is wired into decodeFile as kind prl", () => {
		const b = bundleWith({ "carrier.prl": prl("prl-extended.prl") });
		const d = decodeFile(b, "carrier.prl");
		if (d.view.type !== "prl") throw new Error(d.kind);
		expect(d.view.prl.id).toBe(401);
		expect(describePrl(d.view.prl)).toMatch(
			/^Extended PRL \(SSPR_P_REV 3\), ID 401: 2 acquisition records, 2 system records/,
		);
		expect(hexOf(d)).toBeTruthy();
		expect(() => JSON.stringify(d)).not.toThrow();
	});
});

function asn1Time(text: string, tag = 0x17): string {
	const body = new TextEncoder().encode(text);
	return readTime(
		new Uint8Array([tag, body.length, ...body]),
		readTlv(new Uint8Array([tag, body.length, ...body]), 0),
	);
}

describe("ASN.1", () => {
	it("decodes OIDs and times", () => {
		expect(oidString(new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]))).toBe(
			"1.2.840.113549.1.7.2",
		);
		expect(oidString(new Uint8Array([0x88, 0x37]))).toBe("2.999");
		expect(asn1Time("140311105849Z")).toBe("2014-03-11T10:58:49Z");
		expect(asn1Time("990101000000Z")).toBe("1999-01-01T00:00:00Z");
		expect(asn1Time("20500101000000Z", 0x18)).toBe("2050-01-01T00:00:00Z");
	});

	it("reads BER indefinite lengths and chunked OCTET STRINGs", () => {
		// SEQUENCE(indef) { OCTET STRING(constructed, indef) { "ab", "c" } }
		const b = new Uint8Array([0x30, 0x80, 0x24, 0x80, 0x04, 0x02, 0x61, 0x62, 0x04, 0x01, 0x63, 0, 0, 0, 0]);
		const seq = readTlv(b, 0);
		expect(seq.end).toBe(b.length);
		const [os] = children(b, seq);
		expect(new TextDecoder().decode(octets(b, defined(os)))).toBe("abc");
	});

	it("rejects elements that overrun their parent", () => {
		expect(() => readTlv(new Uint8Array([0x30, 0x05, 0x02, 0x01]), 0)).toThrow(/overruns/);
		expect(() => readTlv(new Uint8Array([0x30, 0x80, 0x02, 0x01, 0x00]), 0)).toThrow(/unterminated/);
	});
});

describe("certificates", () => {
	it("summarises a PEM certificate", () => {
		const [der] = pemBlocks(new TextDecoder().decode(fx("cert-pem.crt")));
		const c = parseCertificate(defined(der));
		expect(c).toMatchObject({
			subject: "CN=GlobalSign, O=GlobalSign, OU=GlobalSign Root CA - R3",
			serial: "04:00:00:00:00:01:21:58:53:08:A2",
			notBefore: "2009-03-18T10:00:00Z",
			notAfter: "2029-03-18T10:00:00Z",
			signatureAlgorithm: "sha256WithRSAEncryption",
			keyAlgorithm: "rsaEncryption",
			keySize: 2048,
			selfIssued: true,
			isCA: true,
		});
	});

	it("finds every certificate in an OpenSSL text export", () => {
		const b = bundleWith({ "CarrierCA.crt": fx("cert-openssl-text.crt") });
		const d = decodeFile(b, "CarrierCA.crt");
		if (d.kind !== "certificate") throw new Error(d.kind);
		expect(textOf(d)).toContain("subject=CN=Entrust");
		if (d.view.type !== "certificates") throw new Error(d.view.type);
		expect(d.view.certificates).toHaveLength(2);
		expect(d.view.certificates[0]?.subject).toBe(
			"CN=Entrust Certification Authority - L1K, OU=(c) 2012 Entrust, Inc. - for authorized use only, OU=See www.entrust.net/legal-terms, O=Entrust, Inc., C=US",
		);
		expect(d.view.certificates[0]?.notAfter).toBe("2024-08-27T08:34:47Z");
		expect(d.note).toMatch(/OpenSSL subject\/issuer lines/);
	});
});

describe("signed configuration profiles", () => {
	it("unwraps a BER-encoded SignedData profile to its plist", () => {
		const raw = fx("profile-signed-1.mobileconfig");
		expect(isCmsSignedData(raw)).toBe(true);
		const sd = parseSignedData(raw);
		expect(sd.contentType).toBe("data");
		expect(sd.detached).toBe(false);
		expect(sd.digestAlgorithms).toEqual(["sha1"]);
		const inner = record(parsePlist(sd.content));
		expect(inner.PayloadType).toBe("Configuration");
		// RFC 4514 order: last RDN first
		expect(sd.certificates[0]?.subject).toBe(
			"x500UniqueIdentifier=65665a5c-9b4d-482f-a932-16ae36b48dee, CN=iPCU CA 65665a5c-9b4d-482f-a932-16ae36b48dee",
		);
		expect(sd.signers).toHaveLength(1);
		expect(sd.signers[0]?.certificate).toBe(0);
	});

	it("is wired into decodeFile, keeping kind mobileconfig", () => {
		const b = bundleWith({ "profile.mobileconfig": fx("profile-signed-2.mobileconfig") });
		const d = decodeFile(b, "profile.mobileconfig");
		if (d.view.type !== "tree" || d.view.signature === null) throw new Error(d.kind);
		expect(d.kind).toBe("mobileconfig");
		expect(record(decodedPlist(d)).PayloadType).toBe("Configuration");
		expect(d.view.signature.signers[0]).toMatchObject({
			digestAlgorithm: "sha1",
			signatureAlgorithm: "rsaEncryption",
		});
		expect(
			d.view.signature.certificates.some((c) =>
				c.subject.endsWith("CN=Apple Configurator (A8:20:66:16:A6:1E)"),
			),
		).toBe(true);
		expect(d.note).toBeNull();
		expect(() => JSON.stringify(d)).not.toThrow();
	});

	it("does not mistake an unsigned plist for CMS", () => {
		expect(isCmsSignedData(new TextEncoder().encode('<?xml version="1.0"?><plist/>'))).toBe(false);
		expect(
			isCmsSignedData(new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
		).toBe(false);
	});
});

describe("other bundle members", () => {
	it("decodes the DMU key blob", () => {
		const k = decodeDmu(fx("key.dmu"));
		expect(k).toMatchObject({
			pkoid: 0x0a,
			pkoidName: "Verizon Wireless",
			pkoi: 2,
			pkExpansion: 0xff,
			atv: 1,
			algorithm: "RSA-1024",
			dmuVersion: 0,
			exponent: "17",
			modulusBits: 1024,
		});
		const d = decodeFile(bundleWith({ "carrier.dmu": fx("key.dmu") }), "carrier.dmu");
		if (d.view.type !== "dmu") throw new Error(d.kind);
		expect(d.view.dmu).toEqual(k);
	});

	it("parses .loctable as a plist keyed by locale", () => {
		const d = decodeFile(bundleWith({ "carrier.loctable": fx("strings.loctable") }), "carrier.loctable");
		expect(d.kind).toBe("plist");
		const p = record(decodedPlist(d));
		expect(record(p.en)["chatr Page_MYACCOUNTURLTITLE"]).toBe("chatr Page");
		expect(Object.keys(p)).toContain("fr_CA");
		expect(contentTypeOf("carrier.loctable")).toBe("application/x-plist");
	});

	it("parses ERI.plist as a normal plist", () => {
		const d = decodeFile(bundleWith({ "ERI.plist": fx("eri.plist") }), "ERI.plist");
		const p = record(decodedPlist(d));
		expect(p.name).toBe("CHOICE");
		expect(record(record(p.roaming_indicator_table)["0"]).text).toBe("Extended");
	});

	it("describes Core Audio files from their header", () => {
		const a = decodeCaf(fx("alert-head.caf"));
		expect(a).toMatchObject({
			sampleRate: 44100,
			format: "lpcm",
			channels: 2,
			bitsPerChannel: 16,
			encoding: "int, big-endian",
		});
		expect(a.duration).toBeCloseTo(11.078, 2);
		const d = decodeFile(bundleWith({ "cbs_alert_us.caf": fx("alert-head.caf") }), "cbs_alert_us.caf");
		if (d.view.type !== "audio") throw new Error(d.kind);
		expect(d.view.audio).toEqual(a);
	});

	it("shows long plain-text members as text rather than hex", () => {
		const text = '4103|"310120"|"Sprint"\n'.repeat(400);
		const d = decodeFile(bundleWith({ "SIDTable.txt": new TextEncoder().encode(text) }), "SIDTable.txt");
		expect(textOf(d)).toBe(text);
		expect(hexOf(d)).toBeUndefined();
		const bin = new Uint8Array(6000).map((_, i) => (i % 7 === 0 ? 0 : 0x41));
		expect(hexOf(decodeFile(bundleWith({ "x.bin": bin }), "x.bin"))).toBeTruthy();
	});
});
