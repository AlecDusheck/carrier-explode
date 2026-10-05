/** Tests for `src/prl.ts` (CDMA preferred roaming lists, IS-683 / C.S0016). */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { annotateNv, decodeNvPrl } from "../src/nv.ts";
import { decodePrl, describePrl, roamIndName } from "../src/prl.ts";
import { defined } from "./defined.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", "prl", n)));

// Local corpus (CORPUS=<dir>, see test/README.md); skipped when unset.
const CORPUS = process.env.CORPUS ? join(process.env.CORPUS, "prl") : "";

describe("PRL", () => {
  it("decodes a small extended PRL field by field", () => {
    const d = decodePrl(fx("prl-extended.prl"));
    expect(d.format).toBe("extended");
    expect(d.sspPRev).toBe(3);
    expect(d).toMatchObject({ size: 44, id: 401, prefOnly: true, defRoamInd: 0, numAcqRecs: 2, numCommonSubnetRecs: 0, numSysRecs: 2 });
    expect(d.crc.ok).toBe(true);
    expect(d.warnings).toEqual([]);
    expect(d.acquisition[0]).toMatchObject({ type: 6, typeName: "PCS CDMA (Using Channels)", length: 5 });
    expect(d.acquisition[1]).toMatchObject({ type: 11, typeName: "Generic HRPD" });
    expect(d.acquisition[1]?.channels).toEqual([
      { band: 1, bandName: "1.9 GHz PCS", channel: 1100 },
      { band: 1, bandName: "1.9 GHz PCS", channel: 1075 },
    ]);
    expect(d.systems.map((s) => s.typeName)).toEqual(["cdma2000 1x and IS-95", "HRPD"]);
    for (const s of d.systems) expect(s.acqIndex).toBeLessThan(d.numAcqRecs);
  });

  it("decodes MCC-MNC and HRPD system records", () => {
    const d = decodePrl(fx("prl-extended-mccmnc.prl"));
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
    const d = decodePrl(fx("prl-legacy.prl"));
    expect(d.format).toBe("prl");
    expect(d.sspPRev).toBe(1);
    expect(d.id).toBe(31002);
    expect(d.crc.ok).toBe(true);
    expect(d.systems).toHaveLength(d.numSysRecs);
    expect(d.acquisition).toHaveLength(d.numAcqRecs);
    expect(d.padBits).toBeGreaterThanOrEqual(0);
    expect(d.padBits).toBeLessThan(8);
    expect(d.warnings).toEqual([]);
  });

  it("flags a corrupted CRC but still decodes", () => {
    const b = fx("prl-extended.prl").slice();
    b[20] = defined(b[20]) ^ 0x01;
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
      d.systems.forEach((s, i) => expect(s.region, n).toBe(i === 0 ? 0 : defined(d.systems[i - 1]).region + (s.geo ? 0 : 1)));
      if (d.format === "extended") {
        const total = d.systems.reduce((x, s) => x + s.length!, 0) + d.acquisition.reduce((x, a) => x + 2 + a.length!, 0);
        expect(11 + total + (d.padBits > 0 ? 1 : 0) + 2, n).toBe(d.size);
      }
    }
  });
});

describe("NV 257", () => {
  /** The 7-byte header every Pixel config writes ahead of its PRL. */
  const nv257 = (prl: Uint8Array, id: number, bits: number): Uint8Array =>
    Uint8Array.from([id & 0xff, id >> 8, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, bits >>> 24, 1, ...prl]);

  it("reads the PRL behind its header, and labels where the header disagrees with it", () => {
    const prl = fx("prl-extended.prl");
    const { id } = decodePrl(prl);
    const got = decodeNvPrl(nv257(prl, id, prl.length * 8));
    expect([got.id, got.sizeBits, got.prl.id, got.prl.crc.ok]).toEqual([id, prl.length * 8, id, true]);
    expect(annotateNv(257, undefined, nv257(prl, id, prl.length * 8))?.label).toBe(describePrl(got.prl));
    expect(annotateNv(257, undefined, nv257(prl, id + 1, 8))?.label).toBe(`${describePrl(got.prl)}; header ID ${id + 1}; header size 8 bits`);
    expect(annotateNv(257, undefined, Uint8Array.of(1, 2))?.label).toBe("not a PRL: NV 257: 2 bytes, shorter than its header");
  });
});
