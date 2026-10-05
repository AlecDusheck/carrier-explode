import { describe, it, expect } from "vitest";
import { comboPart } from "../src/lib/combos.ts";
import { plainJson } from "../src/lib/format.ts";
import { NAMING } from "../src/lib/naming.ts";

describe("plainJson", () => {
  it("matches JSON.stringify for plain values", () => {
    const v = { a: [1, "x", null, { b: true }], c: {}, d: [], e: undefined, f: "q\"" };
    expect(plainJson(v)).toBe(JSON.stringify(v));
    expect(plainJson([undefined])).toBe("[null]");
  });

  it("writes big integers bare and UIDs as UID(n)", () => {
    expect(plainJson({ n: { __int: "18446744073709551615" }, u: { __uid: 3 } })).toBe('{"n":18446744073709551615,"u":UID(3)}');
  });

  it("falls back to String for values JSON cannot write", () => {
    expect(plainJson(undefined)).toBe("undefined");
  });
});

describe("comboPart", () => {
  it("writes a component with its uplink class", () => {
    expect(comboPart({ rat: "lte", band: 66, dl: "A", ul: "A" })).toBe("B66A↑A");
    expect(comboPart({ rat: "nr", band: 77, dl: "C", ul: "A" }, false)).toBe("n77C");
  });
});

describe("version labels", () => {
  const ios = { ota: [] } as const;
  const entryLabel = ({ platform, ...e }: { platform: keyof typeof NAMING; images: string[]; ota: readonly string[]; version: string }): string => NAMING[platform].label(e);

  it("writes a run of one release's betas once", () => {
    expect(entryLabel({ ...ios, platform: "ios", images: ["27.2 beta", "27.2 beta 2"], version: "72.7.2" })).toBe("iOS 27.2 beta 1–2 image · build 72.7.2");
    expect(entryLabel({ ...ios, platform: "ios", images: ["26.6", "26.6.2"], version: "70.0.1" })).toBe("iOS 26.6 – 26.6.2 image · build 70.0.1");
  });

  it("names the OTA copy and the OS it is published for", () => {
    expect(entryLabel({ platform: "ipados", images: [], ota: ["26.2", "27.0"], version: "62.1" })).toBe("OTA iPadOS 26.2+ · build 62.1");
    expect(entryLabel({ ...ios, platform: "ios", images: ["27.0"], ota: ["27.0"], version: "61.0" })).toBe("iOS 27.0 image + OTA iOS 27.0+ · build 61.0");
  });

  it("names an Android file by its newest release", () => {
    expect(entryLabel({ platform: "android", images: ["15", "16"], ota: [], version: "79000000034" })).toBe("Android 16 · version 79000000034");
  });
});
