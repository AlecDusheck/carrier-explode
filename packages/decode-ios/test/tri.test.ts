/**
 * `.der.tri` members. `formats/synthetic.der.tri` is hand-built in the Qualcomm-phone layout with test PLMNs;
 * the Apple-modem form is an altered Intel-dialect `.der.pri` under the `.der.tri` name.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

import { comparable, decodeFile, deviceStem, openIpcc, overrideBoards } from "../src/index.ts";
import { decodeTri } from "../src/tri.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (...p: string[]): Uint8Array => new Uint8Array(readFileSync(join(here, "fixtures", ...p)));
const TRI = fixture("formats", "synthetic.der.tri");

const bundle = (files: Record<string, Uint8Array>) =>
  openIpcc(zipSync(Object.fromEntries(Object.entries(files).map(([p, b]) => [`Payload/Test.bundle/${p}`, b]))));

describe("decodeTri", () => {
  it("reads every record, named where a role is known, in file order", () => {
    const { fields, errors } = decodeTri(TRI);
    expect(errors).toEqual([]);
    expect(fields.map((f) => [f.path, f.kind])).toEqual([
      ["1", "version"], ["2", "unknown"], ["3/1", "plmn"], ["3/2", "unknown"], ["3/3", "plmn-act-list"],
      ["3/4", "plmn-list"], ["3/5", "plmn-list"], ["3/9", "unknown"],
    ]);
    expect(fields[0]).toMatchObject({ kind: "version", version: "1.2.300", hex: "01022c01" });
    expect(fields[1]).toMatchObject({ hex: "10" });
    expect(fields[2]).toMatchObject({ plmn: "001-01" });
    expect(fields[5]).toMatchObject({ name: "Equivalent home PLMNs (EF EHPLMN)", plmns: ["001-01"] });
    expect(fields[6]).toMatchObject({ plmns: ["999-01"] });
    expect(fields[7]).toMatchObject({ hex: "abcd" });
  });

  it("decodes each PLMN's access technologies, keeping bits no source names", () => {
    const list = decodeTri(TRI).fields.find((f) => f.kind === "plmn-act-list");
    expect(list?.kind === "plmn-act-list" && list.entries).toEqual([
      { plmn: "001-01", hex: "c000", access: { names: ["UTRAN", "E-UTRAN"], unknownBits: 0 } },
      { plmn: "999-99", hex: "8080", access: { names: ["UTRAN", "GSM"], unknownBits: 0 } },
      { plmn: "001-011", hex: "c008", access: { names: ["UTRAN", "E-UTRAN", "NG-RAN"], unknownBits: 0 } },
      { plmn: "001-01", hex: "4100", access: { names: ["E-UTRAN"], unknownBits: 0x0100 } },
    ]);
  });

  it("keeps what it cannot read as raw bytes, with why", () => {
    // Record 3's length claims one byte more than its parent holds.
    const cut = TRI.slice();
    cut[19] = (cut[19] ?? 0) + 1;
    const r = decodeTri(cut);
    expect(r.errors).toEqual(["record at @13 runs past its parent; its 60 bytes are kept unread"]);
    expect(r.fields.at(-1)).toMatchObject({ kind: "unknown", path: "@13" });

    const trailing = decodeTri(new Uint8Array([...TRI, 0xee]));
    expect(trailing.errors).toEqual(["1 bytes follow the DER wrapper"]);
    expect(trailing.fields.at(-1)).toEqual({ path: `@${TRI.length}`, hex: "ee", kind: "unknown" });

    const notDer = decodeTri(new Uint8Array([0x30, 0x01, 0x00]));
    expect(notDer.errors).toEqual(["expected a DER [0] wrapper, found tag 0x30"]);
    expect(notDer.fields).toEqual([{ path: "@0", hex: "300100", kind: "unknown" }]);
  });
});

describe(".der.tri members", () => {
  const b = bundle({
    "overrides_V64.der.tri": TRI,
    "overrides_V63_V64s_V68.der.tri": fixture("intel", "kddi.der.pri"),
  });

  it("are override files named for their boards", () => {
    expect(b.info.files.map((f) => [f.path, f.kind, f.boards])).toEqual([
      ["overrides_V63_V64s_V68.der.tri", "tri-der", ["V63", "V64s", "V68"]],
      ["overrides_V64.der.tri", "tri-der", ["V64"]],
    ]);
    expect(deviceStem("overrides_V64.der.tri")).toBe("V64");
    expect(overrideBoards("overrides_V63_V64s_V68.der.tri")).toEqual(["V63", "V64s", "V68"]);
  });

  it("decode as a PRI in the Apple-modem form and as records in the Qualcomm-phone form", () => {
    const apple = decodeFile(b, "overrides_V63_V64s_V68.der.tri");
    expect(apple.kind === "pri-der" && [apple.pri.kind, apple.pri.dialect]).toEqual(["der.tri", "intel"]);
    const qc = decodeFile(b, "overrides_V64.der.tri");
    expect(qc.kind === "tri-der" && qc.tri).toEqual(decodeTri(TRI));
  });

  it("compare by record path, a PLMN list by PLMN", () => {
    expect(comparable(decodeFile(b, "overrides_V64.der.tri"))).toEqual({
      "1": "1.2.300", "2": "10", "3/1": "001-01", "3/2": "01", "3/3": { "001-01": "4100", "999-99": "8080", "001-011": "c008" },
      "3/4": ["001-01"], "3/5": ["999-01"], "3/9": "abcd",
    });
  });
});
