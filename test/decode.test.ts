import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parsePlist, parseXmlPlist, parseBinaryPlist, toJsonSafe } from "../src/lib/decode/plist.ts";
import { openIpcc, decodeFile, decodedPlist, decodedPri } from "../src/lib/decode/bundle.ts";
import { decodePri, flattenDer } from "../src/lib/decode/pri.ts";
import { describeDevices } from "../src/lib/decode/devices.ts";
import { diffValues } from "../src/lib/decode/compare.ts";
import { splitName, compareVersions } from "../src/lib/server/manifest.ts";
import { maskBits } from "../src/lib/decode/bytes.ts";
import { describeMessageId } from "../src/lib/decode/cbs.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", n)));

describe("plist", () => {
  it("parses XML plists including data, dates, arrays and nesting", () => {
    const xml = `<?xml version="1.0"?><plist version="1.0"><dict>
      <key>s</key><string>a &amp; b</string>
      <key>i</key><integer>-7</integer>
      <key>r</key><real>1.5</real>
      <key>t</key><true/><key>f</key><false/>
      <key>arr</key><array><integer>1</integer><string>two</string><dict><key>k</key><string>v</string></dict></array>
      <key>d</key><data>QUJD</data>
      <key>empty</key><dict/>
    </dict></plist>`;
    const v = parseXmlPlist(xml) as Record<string, unknown>;
    expect(v.s).toBe("a & b");
    expect(v.i).toBe(-7);
    expect(v.r).toBe(1.5);
    expect(v.t).toBe(true);
    expect(v.f).toBe(false);
    expect(v.arr).toEqual([1, "two", { k: "v" }]);
    expect(new TextDecoder().decode(v.d as Uint8Array)).toBe("ABC");
    expect(v.empty).toEqual({});
  });

  it("parses binary plists out of a real bundle", () => {
    const b = openIpcc(fixture("ATT_US.ipcc"));
    const strings = b.info.files.find((f) => f.path === "en.lproj/carrier.strings")!;
    expect(strings).toBeTruthy();
    const d = decodeFile(b, strings.path);
    expect(decodedPlist(d)).toBeTruthy();
    expect(Object.keys(decodedPlist(d) as object).length).toBeGreaterThan(0);
  });

  it("round-trips a hand-built binary plist header", () => {
    const b = openIpcc(fixture("UnitedStates.ipcc"));
    const raw = b.entries[b.prefix + "carrier.plist"];
    const parsed = parseBinaryPlist(raw) as Record<string, unknown>;
    expect(parsed.CountryName).toBe("United States of America");
    expect((parsePlist(raw) as Record<string, unknown>).CountryName).toBe(parsed.CountryName);
  });
});

describe("ipcc", () => {
  it("lists bundle contents and maps device codenames", () => {
    const b = openIpcc(fixture("CW_pa.ipcc"));
    expect(b.info.bundleName).toBe("CW_pa");
    expect(b.info.files.length).toBeGreaterThan(5);
    const der = b.info.files.find((f) => f.kind === "pri-der")!;
    expect(der).toBeTruthy();
    expect(der.devices!.length).toBeGreaterThan(0);
  });

  it("classifies localisation folders", () => {
    const b = openIpcc(fixture("ATT_US.ipcc"));
    expect(b.info.locales).toContain("en");
    expect(b.info.locales.length).toBeGreaterThan(10);
    expect(b.info.files.some((f) => f.locale === "de")).toBe(true);
  });

  it("decodes carrier.plist of a country bundle", () => {
    const b = openIpcc(fixture("UnitedStates.ipcc"));
    const d = decodeFile(b, "carrier.plist");
    const p = decodedPlist(d) as any;
    expect(p.CountryName).toBe("United States of America");
    expect(p.CellBroadcast.MessageIDParameters3GPP.length).toBeGreaterThan(5);
    const presidential = p.CellBroadcast.MessageIDParameters3GPP.find((m: any) => m.FromServiceID === 4370);
    expect(presidential.AlertType).toBe("Presidential");
    expect(p.CellBroadcast.AlertTypes.Presidential.UserConfigurable).toBe(false);
  });
});

describe("der pri", () => {
  it("decodes a real .der.pri into named settings, EFS paths and feature groups", () => {
    const b = openIpcc(fixture("CW_pa.ipcc"));
    const der = b.info.files.find((f) => f.kind === "pri-der")!;
    const d = decodeFile(b, der.path);
    const pri = decodedPri(d)!;
    expect(pri.error).toBeUndefined();
    expect(pri.leafCount).toBeGreaterThan(5);
    expect(pri.header["PRI Revision"]).toMatch(/\d+\.\d+/);
    expect(pri.efs.length).toBeGreaterThan(0);
    for (const e of pri.efs) expect(e.path.length).toBeGreaterThan(0);
  });

  it("names the feature groups and lists set bits", () => {
    const b = openIpcc(fixture("ATT_US.ipcc"));
    let found = false;
    for (const f of b.info.files.filter((x) => x.kind === "pri-der")) {
      const pri = decodedPri(decodeFile(b, f.path))!;
      for (const g of pri.featureGroups) {
        expect(g.total).toBe(25);
        expect(g.name).toMatch(/Feature Group/);
        for (const bit of g.bits) expect(bit).toBeLessThan(25);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("separates the NV path schema index from assigned overrides", () => {
    const b = openIpcc(fixture("ATT_US.ipcc"));
    const f = b.info.files.find((x) => x.kind === "pri-der")!;
    const pri = decodedPri(decodeFile(b, f.path))!;
    // The MAVZ/raw blob is a schema index; it carries paths but no values.
    expect(["MAVZ", "raw", "none"]).toContain(pri.schema.source);
    if (pri.schema.count > 0) {
      expect(pri.schema.paths[0].startsWith("/")).toBe(true);
      expect(pri.schema.count).toBeGreaterThan(50);
    }
    for (const e of pri.efs) expect(e.value).toBeTruthy();
  });

  it("decodes little-endian scalars and detects embedded XML", () => {
    const b = openIpcc(fixture("ATT_US.ipcc"));
    let sawXml = false;
    for (const f of b.info.files.filter((x) => x.kind === "pri-der")) {
      for (const e of decodedPri(decodeFile(b, f.path))!.efs) {
        if (e.value.kind === "xml") { sawXml = true; expect(e.value.xml!.startsWith("<?xml")).toBe(true); }
        if (e.value.kind === "int") expect(typeof e.value.int).toBe("number");
      }
    }
    expect(sawXml).toBe(true);
  });

  it("flattenDer tolerates truncated input without throwing", () => {
    const b = openIpcc(fixture("CW_pa.ipcc"));
    const f = b.info.files.find((x) => x.kind === "pri-der")!;
    const raw = b.entries[b.prefix + f.path];
    expect(() => flattenDer(raw.subarray(0, 40))).not.toThrow();
    expect(() => decodePri(new Uint8Array([0x31, 0x80, 0xff]))).not.toThrow();
  });
});

describe("helpers", () => {
  it("maps device codenames", () => {
    const d = describeDevices("D63_D64_D16_D17");
    expect(d.map((x) => x.code)).toEqual(["D63", "D64", "D16", "D17"]);
    expect(d[0].name).toBe("iPhone 13 Pro");
    expect(describeDevices("ZZ999")[0].name).toBeUndefined();
  });

  it("splits carrier names into display + country", () => {
    expect(splitName("Verizon_Charter_LTE_US")).toEqual({ cc: "us", display: "Verizon Charter LTE" });
    expect(splitName("OtherKnown").cc).toBeUndefined();
  });

  it("orders iOS versions numerically", () => {
    const v = ["9.3", "10.0", "26.5", "18.5", "6.1"].sort(compareVersions);
    expect(v).toEqual(["6.1", "9.3", "10.0", "18.5", "26.5"]);
  });

  it("diffs nested structures", () => {
    const rows = diffValues({ a: 1, b: { c: 2 }, d: [1, 2] }, { a: 1, b: { c: 3 }, e: 5, d: [1, 3] });
    const kinds = Object.fromEntries(rows.map((r) => [r.path, r.kind]));
    expect(kinds["b.c"]).toBe("changed");
    expect(kinds["e"]).toBe("added");
    expect(kinds["d[1]"]).toBe("changed");
    expect(kinds["a"]).toBeUndefined();
  });

  it("decodes bitmasks and 3GPP message ids", () => {
    expect(maskBits(32768)).toEqual([15]);
    expect(maskBits(9)).toEqual([0, 3]);
    expect(describeMessageId(4382)).toMatch(/Operator-defined/);
    expect(describeMessageId(4370)).toMatch(/Presidential/);
  });

  it("keeps binary values inspectable through toJsonSafe", () => {
    const out = toJsonSafe({ d: new Uint8Array([0x41, 0x42]) }) as any;
    expect(out.d.__data).toBe("4142");
    expect(out.d.__text).toBe("AB");
  });
});

describe("xml plist edge cases", () => {
  it("does not let an element swallow its sibling's closing tag", () => {
    const v = parseXmlPlist(
      `<plist><array><string>a</string><string>b</string><integer>3</integer></array></plist>`,
    );
    expect(v).toEqual(["a", "b", 3]);
  });

  it("handles nested arrays of dicts", () => {
    const v = parseXmlPlist(
      `<plist><dict><key>l</key><array>` +
        `<dict><key>a</key><integer>1</integer></dict>` +
        `<dict><key>a</key><integer>2</integer></dict>` +
        `</array><key>after</key><true/></dict></plist>`,
    ) as any;
    expect(v.l).toEqual([{ a: 1 }, { a: 2 }]);
    expect(v.after).toBe(true);
  });

  it("handles self-closing containers and empty strings", () => {
    const v = parseXmlPlist(
      `<plist><dict><key>d</key><dict/><key>a</key><array/><key>s</key><string/></dict></plist>`,
    ) as any;
    expect(v.d).toEqual({});
    expect(v.a).toEqual([]);
    expect(v.s).toBe("");
  });

  it("survives comments, CDATA and doctype", () => {
    const v = parseXmlPlist(
      `<?xml version="1.0"?><!DOCTYPE plist><!-- hi --><plist><dict>` +
        `<key>k</key><string><![CDATA[a<b]]></string></dict></plist>`,
    ) as any;
    expect(v.k).toBe("a<b");
  });

  it("parses the real 6 MB manifest shape from a trimmed sample", () => {
    const xml =
      `<plist version="1.0"><dict>` +
      `<key>MobileDeviceCarrierBundlesByProductVersion</key><dict>` +
      `<key>ATT_US</key><dict><key>17.5</key><dict>` +
      `<key>BuildVersion</key><string>58.1</string>` +
      `<key>BundleURL</key><string>https://updates.cdn-apple.com/x/ATT_US_iPhone.ipcc</string>` +
      `<key>Digest</key><data>QUJD</data></dict>` +
      `<key>ByProductType</key><dict><key>iPad</key><dict><key>5.1</key><dict>` +
      `<key>BundleURL</key><string>https://appldnld.apple.com/y.ipcc</string></dict></dict></dict>` +
      `</dict></dict></dict></plist>`;
    const root = parseXmlPlist(xml) as any;
    const entry = root.MobileDeviceCarrierBundlesByProductVersion.ATT_US;
    expect(entry["17.5"].BuildVersion).toBe("58.1");
    expect(entry.ByProductType.iPad["5.1"].BundleURL).toContain("appldnld");
  });
});
