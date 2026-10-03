// Deterministic .ipcc packaging and the content id (../src/jobs/ios/shared/ipcc.ts, src/lib/decode contentId).

import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { contentId, openIpcc } from "../../../src/lib/decode/index.ts";
import { mergeCopies } from "../src/jobs/ios/release/merge.ts";
import { bundleVersion, comparePaths, packIpcc, unpackIpcc, type Bundle } from "../src/jobs/ios/shared/ipcc.ts";

const enc = new TextEncoder();
const file = (path: string, text: string): { path: string; bytes: Uint8Array } => ({ path, bytes: enc.encode(text) });
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

const INFO = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>72.0</string></dict></plist>`;
const BUNDLE: Bundle = {
  name: "Test_us",
  files: [
    file("carrier.plist", "<plist><dict/></plist>"),
    file("Info.plist", INFO),
    file("en.lproj/Localizable.strings", "x"),
    file("overrides_N104_N94.plist", "<plist><dict/></plist>"),
    file("Österreich.png", "\u0000"),
    file(".DS_Store", "junk"),
  ],
};

describe("packIpcc", () => {
  it("gives identical bytes for the same files in any order", () => {
    const a = packIpcc(BUNDLE);
    const b = packIpcc({ ...BUNDLE, files: [...BUNDLE.files].reverse() });
    expect(sha(a)).toBe(sha(b));
  });

  it("lays entries out as Apple's .ipcc, in byte order of path, without .DS_Store", () => {
    const names = Object.keys(unzipSync(packIpcc(BUNDLE)));
    expect(names).toEqual([
      "Payload/Test_us.bundle/Info.plist",
      "Payload/Test_us.bundle/carrier.plist",
      "Payload/Test_us.bundle/en.lproj/Localizable.strings",
      "Payload/Test_us.bundle/overrides_N104_N94.plist",
      "Payload/Test_us.bundle/Österreich.png",
    ]);
  });

  it("stamps every entry 1980-01-01 00:00 and deflates it", () => {
    const z = packIpcc(BUNDLE);
    const view = new DataView(z.buffer, z.byteOffset, z.byteLength);
    // First local header: method at 8, DOS time at 10, DOS date at 12.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(8);
    expect(view.getUint16(10, true)).toBe(0);
    expect(view.getUint16(12, true)).toBe((0 << 9) | (1 << 5) | 1);
  });

  it("refuses a path given twice", () => {
    expect(() => packIpcc({ name: "X", files: [file("a", "1"), file("a", "2")] })).toThrow(/twice/);
  });

  it("round-trips through unpackIpcc to the same bytes", () => {
    const a = packIpcc(BUNDLE);
    const back = unpackIpcc(a);
    expect(back.name).toBe("Test_us");
    expect(sha(packIpcc(back))).toBe(sha(a));
  });
});

describe("content id", () => {
  // scripts/package_system_bundles.py content_id() over the same five files, run once to pin the value.
  const PYTHON_CID = "67fb593324a0e809ce3d8d3535cfa0803e14942a9c881386649d74124679a729";

  it("agrees with the v1 Python content_id, through the decoder's contentId", async () => {
    expect(await contentId(openIpcc(packIpcc(BUNDLE)))).toBe(PYTHON_CID);
  });

  it("ignores the archive: the same files zipped differently have one id", async () => {
    const other = packIpcc({ ...BUNDLE, files: BUNDLE.files.slice(0, 5) });
    expect(await contentId(openIpcc(other))).toBe(PYTHON_CID);
  });
});

describe("bundleVersion", () => {
  it("reads CFBundleVersion", () => {
    expect(bundleVersion(BUNDLE)).toBe("72.0");
  });

  it("is undefined without an Info.plist", () => {
    expect(bundleVersion({ name: "X", files: [file("carrier.plist", "<plist/>")] })).toBeUndefined();
  });
});

describe("comparePaths", () => {
  it("orders by UTF-8 bytes, so upper case sorts before lower and non-ASCII last", () => {
    expect(["b", "Z", "Ö", "a"].sort(comparePaths)).toEqual(["Z", "a", "b", "Ö"]);
  });
});

describe("mergeCopies", () => {
  const base: Bundle = { name: "T", files: [file("carrier.plist", "A"), file("overrides_N1.plist", "1")] };

  it("takes the union of the copies' files", () => {
    const other: Bundle = { name: "T", files: [file("carrier.plist", "A"), file("overrides_N2.plist", "2")] };
    const { bundle, conflicts } = mergeCopies([base, other]);
    expect(bundle.files.map((f) => f.path)).toEqual(["carrier.plist", "overrides_N1.plist", "overrides_N2.plist"]);
    expect(conflicts).toEqual([]);
  });

  it("reports a file that differs and keeps the first image's copy", () => {
    const other: Bundle = { name: "T", files: [file("carrier.plist", "B")] };
    const { bundle, conflicts } = mergeCopies([base, other]);
    expect(new TextDecoder().decode(bundle.files.find((f) => f.path === "carrier.plist")?.bytes)).toBe("A");
    expect(conflicts).toEqual(["T.bundle/carrier.plist"]);
  });

  it("packs to the same bytes as a copy that already had every file", () => {
    const full: Bundle = { name: "T", files: [...base.files, file("overrides_N2.plist", "2")] };
    const { bundle } = mergeCopies([base, full]);
    expect(sha(packIpcc(bundle))).toBe(sha(packIpcc(full)));
  });

  it("refuses copies of different bundles", () => {
    expect(() => mergeCopies([base, { ...base, name: "U" }])).toThrow(/merging U/);
  });
});
