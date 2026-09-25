import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { zipSync } from "fflate";

import { decodePrl, isPrl, roamIndName } from "../src/lib/decode/prl.ts";
import { crc16Ccitt, BitReader } from "../src/lib/decode/bytes.ts";
import { readTlv, children, octets, oidString, readTime, parseCertificate, pemBlocks } from "../src/lib/decode/der.ts";
import { isCmsSignedData, parseSignedData } from "../src/lib/decode/cms.ts";
import { decodeDmu } from "../src/lib/decode/dmu.ts";
import { decodeCaf } from "../src/lib/decode/caf.ts";
import { parsePlist } from "../src/lib/decode/plist.ts";
import { openIpcc, decodeFile, contentTypeOf } from "../src/lib/decode/bundle.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", "formats", n)));

/** A one-file bundle, so decodeFile's classification and wiring are exercised end to end. */
function bundleWith(files: Record<string, Uint8Array>) {
  const zip: Record<string, Uint8Array> = {};
  for (const [p, b] of Object.entries(files)) zip[`Payload/Test.bundle/${p}`] = b;
  return openIpcc(zipSync(zip));
}

// Local corpus (CORPUS=<dir>, see test/README.md); skipped when unset.
const CORPUS = process.env.CORPUS ? join(process.env.CORPUS, "prl") : "";

describe("bit reader and CRC", () => {
  it("reads MSB-first fields across byte boundaries", () => {
    const r = new BitReader(new Uint8Array([0b10110011, 0b01010101]));
    expect(r.u(3)).toBe(0b101);
    expect(r.u(7)).toBe(0b1001101);
    expect(r.hex(6)).toBe("54");
    expect(() => r.u(1)).toThrow(/past end/);
  });

  it("computes CRC-16/CCITT-FALSE and its complement", () => {
    const b = new TextEncoder().encode("123456789");
    expect(crc16Ccitt(b)).toBe(0x29b1); // published check value
    expect(crc16Ccitt(b, true)).toBe(0xd64e);
  });
});

describe("PRL", () => {
  it("decodes a small extended PRL field by field", () => {
    const d = decodePrl(fx("extended-sprint-400.prl"));
    expect(d.format).toBe("extended");
    expect(d.sspPRev).toBe(3);
    expect(d).toMatchObject({ size: 44, id: 400, prefOnly: true, defRoamInd: 0, numAcqRecs: 2, numCommonSubnetRecs: 0, numSysRecs: 2 });
    expect(d.crc.ok).toBe(true);
    expect(d.warnings).toEqual([]);
    expect(d.acquisition[0]).toMatchObject({ type: 6, typeName: "PCS CDMA (Using Channels)", length: 5 });
    expect(d.acquisition[1]).toMatchObject({ type: 11, typeName: "Generic HRPD" });
    expect(d.acquisition[1].channels).toEqual([
      { band: 1, bandName: "1.9 GHz PCS", channel: 1100 },
      { band: 1, bandName: "1.9 GHz PCS", channel: 1075 },
    ]);
    expect(d.systems.map((s) => s.typeName)).toEqual(["cdma2000 1x and IS-95", "HRPD"]);
    for (const s of d.systems) expect(s.acqIndex).toBeLessThan(d.numAcqRecs);
  });

  it("decodes MCC-MNC and HRPD system records", () => {
    const d = decodePrl(fx("extended-mccmnc-31100.prl"));
    expect(d.warnings).toEqual([]);
    const mcc = d.systems.find((s) => s.type === 3)!;
    expect(mcc).toMatchObject({ subtype: "MCC, MNC, SIDs and NIDs", mcc: "310", sidNids: [{ sid: 4162, nid: 65535 }] });
    expect(mcc.association).toEqual({ tag: 5, pn: false, data: false });
    const hrpd = d.systems.find((s) => s.type === 1)!;
    expect(hrpd.subnet).toMatch(/^[0-9a-f]+\/\d+$/);
    const one = d.systems.find((s) => s.type === 0)!;
    expect(one).toMatchObject({ sid: 4106, nid: 65535, roamInd: 1, roamIndName: "Roaming indicator off" });
  });

  it("decodes a legacy SSPR_P_REV 1 PRL, which has no revision byte", () => {
    const d = decodePrl(fx("legacy-31001.prl"));
    expect(d.format).toBe("prl");
    expect(d.sspPRev).toBe(1);
    expect(d.id).toBe(31001);
    expect(d.crc.ok).toBe(true);
    expect(d.systems).toHaveLength(d.numSysRecs);
    expect(d.acquisition).toHaveLength(d.numAcqRecs);
    expect(d.padBits).toBeGreaterThanOrEqual(0);
    expect(d.padBits).toBeLessThan(8);
    expect(d.warnings).toEqual([]);
  });

  it("flags a corrupted CRC but still decodes", () => {
    const b = fx("extended-sprint-400.prl").slice();
    b[20] ^= 0x01;
    expect(isPrl(b)).toBe(false);
    const d = decodePrl(b);
    expect(d.crc.ok).toBe(false);
    expect(d.warnings[0]).toBe("CRC mismatch");
  });

  it("names roaming indicators per C.R1001", () => {
    expect(roamIndName(0)).toBe("Roaming indicator on");
    expect(roamIndName(12)).toBe("Roaming banner off");
    expect(roamIndName(64)).toBe("Operator-defined ERI");
    expect(roamIndName(200)).toBe("Reserved");
  });

  it("is wired into decodeFile as kind prl", () => {
    const b = bundleWith({ "carrier.prl": fx("extended-sprint-400.prl") });
    const d = decodeFile(b, "carrier.prl");
    expect(d.kind).toBe("prl");
    expect(d.prl?.id).toBe(400);
    expect(d.note).toMatch(/^Extended PRL \(SSPR_P_REV 3\), ID 400: 2 acquisition records, 2 system records/);
    expect(d.hex).toBeTruthy();
    expect(() => JSON.stringify(d)).not.toThrow();
  });

  it.skipIf(!existsSync(CORPUS))("every corpus PRL checks out and its records end at the CRC", () => {
    const names = readdirSync(CORPUS).filter((n) => n.endsWith(".prl"));
    expect(names.length).toBe(35);
    for (const n of names) {
      const bytes = new Uint8Array(readFileSync(join(CORPUS, n)));
      const d = decodePrl(bytes);
      expect(d.crc.ok, n).toBe(true);
      expect(d.size, n).toBe(bytes.length);
      expect(d.warnings, n).toEqual([]);
      expect(d.padBits, n).toBeGreaterThanOrEqual(0);
      expect(d.padBits, n).toBeLessThan(8);
      expect(d.acquisition.length, n).toBe(d.numAcqRecs);
      expect(d.systems.length, n).toBe(d.numSysRecs);
      expect(d.commonSubnets?.length ?? 0, n).toBe(d.numCommonSubnetRecs ?? 0);
      for (const a of d.acquisition) expect(a.typeName, n).not.toMatch(/^Reserved/);
      for (const s of d.systems) expect(s.acqIndex, n).toBeLessThan(d.numAcqRecs);
      // GEO regions only ever grow by one, starting at 0.
      d.systems.forEach((s, i) => expect(s.region, n).toBe(i === 0 ? 0 : d.systems[i - 1].region + (s.geo ? 0 : 1)));
      if (d.format === "extended") {
        const total = d.systems.reduce((x, s) => x + s.length!, 0) + d.acquisition.reduce((x, a) => x + 2 + a.length!, 0);
        expect(11 + total + (d.padBits > 0 ? 1 : 0) + 2, n).toBe(d.size);
      }
    }
  });
});

describe("ASN.1", () => {
  it("decodes OIDs and times", () => {
    expect(oidString(new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]))).toBe("1.2.840.113549.1.7.2");
    expect(oidString(new Uint8Array([0x88, 0x37]))).toBe("2.999");
    const t = (s: string, tag = 0x17) => {
      const body = new TextEncoder().encode(s);
      return readTime(new Uint8Array([tag, body.length, ...body]), readTlv(new Uint8Array([tag, body.length, ...body]), 0));
    };
    expect(t("140311105849Z")).toBe("2014-03-11T10:58:49Z");
    expect(t("990101000000Z")).toBe("1999-01-01T00:00:00Z");
    expect(t("20500101000000Z", 0x18)).toBe("2050-01-01T00:00:00Z");
  });

  it("reads BER indefinite lengths and chunked OCTET STRINGs", () => {
    // SEQUENCE(indef) { OCTET STRING(constructed, indef) { "ab", "c" } }
    const b = new Uint8Array([0x30, 0x80, 0x24, 0x80, 0x04, 0x02, 0x61, 0x62, 0x04, 0x01, 0x63, 0, 0, 0, 0]);
    const seq = readTlv(b, 0);
    expect(seq.end).toBe(b.length);
    const [os] = children(b, seq);
    expect(new TextDecoder().decode(octets(b, os))).toBe("abc");
  });

  it("rejects elements that overrun their parent", () => {
    expect(() => readTlv(new Uint8Array([0x30, 0x05, 0x02, 0x01]), 0)).toThrow(/overruns/);
    expect(() => readTlv(new Uint8Array([0x30, 0x80, 0x02, 0x01, 0x00]), 0)).toThrow(/unterminated/);
  });
});

describe("certificates", () => {
  it("summarises a PEM certificate", () => {
    const [der] = pemBlocks(new TextDecoder().decode(fx("pem-Maxis_my.crt")));
    const c = parseCertificate(der);
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
    const b = bundleWith({ "CarrierCA.crt": fx("openssl-text-Dish_MVNO_US.crt") });
    const d = decodeFile(b, "CarrierCA.crt");
    expect(d.kind).toBe("certificate");
    expect(d.text).toContain("subject=CN=Entrust");
    expect(d.certificates).toHaveLength(2);
    expect(d.certificates![0].subject).toBe(
      "CN=Entrust Certification Authority - L1K, OU=(c) 2012 Entrust, Inc. - for authorized use only, OU=See www.entrust.net/legal-terms, O=Entrust, Inc., C=US",
    );
    expect(d.certificates![0].notAfter).toBe("2024-08-27T08:34:47Z");
    expect(d.note).toMatch(/OpenSSL subject\/issuer lines, 2 X\.509 certificates/);
  });
});

describe("signed configuration profiles", () => {
  it("unwraps a BER-encoded SignedData profile to its plist", () => {
    const raw = fx("signed-Aircel_in.mobileconfig");
    expect(isCmsSignedData(raw)).toBe(true);
    const sd = parseSignedData(raw);
    expect(sd.contentType).toBe("data");
    expect(sd.detached).toBe(false);
    expect(sd.digestAlgorithms).toEqual(["sha1"]);
    const inner = parsePlist(sd.content) as Record<string, unknown>;
    expect(inner.PayloadType).toBe("Configuration");
    // RFC 4514 order: last RDN first
    expect(sd.certificates[0].subject).toBe(
      "x500UniqueIdentifier=65665a5c-9b4d-482f-a932-16ae36b48dee, CN=iPCU CA 65665a5c-9b4d-482f-a932-16ae36b48dee",
    );
    expect(sd.signers).toHaveLength(1);
    expect(sd.signers[0].certificate).toBe(0);
  });

  it("is wired into decodeFile, keeping kind mobileconfig", () => {
    const b = bundleWith({ "profile.mobileconfig": fx("signed-AWCC_af.mobileconfig") });
    const d = decodeFile(b, "profile.mobileconfig");
    expect(d.kind).toBe("mobileconfig");
    expect((d.plist as Record<string, unknown>).PayloadType).toBe("Configuration");
    expect(d.signature?.signers[0]).toMatchObject({ digestAlgorithm: "sha1", signatureAlgorithm: "rsaEncryption" });
    expect(d.signature!.certificates.some((c) => c.subject.endsWith("CN=Apple Configurator (A8:20:66:16:A6:1E)"))).toBe(true);
    expect(d.note).toMatch(/^signed profile \(CMS SignedData, sha1\); signer C=SG, O=vaishnavis-mbp, CN=Apple Configurator .*signature not verified$/);
    expect(() => JSON.stringify(d)).not.toThrow();
  });

  it("does not mistake an unsigned plist for CMS", () => {
    expect(isCmsSignedData(new TextEncoder().encode("<?xml version=\"1.0\"?><plist/>"))).toBe(false);
    expect(isCmsSignedData(new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });
});

describe("other bundle members", () => {
  it("decodes the DMU key blob", () => {
    const k = decodeDmu(fx("Verizon_LTE_US.dmu"));
    expect(k).toMatchObject({ pkoid: 0x0a, pkoidName: "Verizon Wireless", pkoi: 2, pkExpansion: 0xff, atv: 1, algorithm: "RSA-1024", dmuVersion: 0, exponent: "17", modulusBits: 1024 });
    const d = decodeFile(bundleWith({ "carrier.dmu": fx("Verizon_LTE_US.dmu") }), "carrier.dmu");
    expect(d.kind).toBe("dmu");
    expect(d.note).toBe("DMU public key: RSA-1024, exponent 17, PKOID 0x0a (Verizon Wireless), PKOI 2");
  });

  it("parses .loctable as a plist keyed by locale", () => {
    const d = decodeFile(bundleWith({ "carrier.loctable": fx("Rogers_chatr_ca.loctable") }), "carrier.loctable");
    expect(d.kind).toBe("plist");
    const p = d.plist as Record<string, Record<string, string>>;
    expect(p.en["chatr Page_MYACCOUNTURLTITLE"]).toBe("chatr Page");
    expect(Object.keys(p)).toContain("fr_CA");
    expect(contentTypeOf("carrier.loctable")).toBe("application/x-plist");
  });

  it("parses ERI.plist as a normal plist", () => {
    const d = decodeFile(bundleWith({ "ERI.plist": fx("ATN_vi-ERI.plist") }), "ERI.plist");
    const p = d.plist as Record<string, any>;
    expect(p.name).toBe("CHOICE");
    expect(p.roaming_indicator_table["0"].text).toBe("Extended");
  });

  it("describes Core Audio files from their header", () => {
    const a = decodeCaf(fx("cbs_alert_us-head.caf"));
    expect(a).toMatchObject({ sampleRate: 44100, format: "lpcm", channels: 2, bitsPerChannel: 16, encoding: "int, big-endian" });
    expect(a.duration).toBeCloseTo(11.078, 2);
    const d = decodeFile(bundleWith({ "cbs_alert_us.caf": fx("cbs_alert_us-head.caf") }), "cbs_alert_us.caf");
    expect(d.kind).toBe("audio");
    expect(d.note).toBe("Core Audio file: lpcm (16-bit int, big-endian), 44100 Hz, 2 channels, 11.078 s");
  });

  it("shows long plain-text members as text rather than hex", () => {
    const text = "4103|\"310120\"|\"Sprint\"\n".repeat(400);
    const d = decodeFile(bundleWith({ "SIDTable.txt": new TextEncoder().encode(text) }), "SIDTable.txt");
    expect(d.text).toBe(text);
    expect(d.hex).toBeUndefined();
    const bin = new Uint8Array(6000).map((_, i) => (i % 7 === 0 ? 0 : 0x41));
    expect(decodeFile(bundleWith({ "x.bin": bin }), "x.bin").hex).toBeTruthy();
  });
});
