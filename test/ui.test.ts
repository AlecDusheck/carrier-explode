import { describe, it, expect } from "vitest";
import { cbsEntryLabel, comboPart, entryLabel, plainJson } from "../src/lib/format.ts";
import { Folding, toggleIn } from "../src/lib/ui-state.svelte.ts";

describe("plainJson", () => {
  it("matches JSON.stringify for plain values, compact and indented", () => {
    const v = { a: [1, "x", null, { b: true }], c: {}, d: [], e: undefined, f: "q\"" };
    expect(plainJson(v)).toBe(JSON.stringify(v));
    expect(plainJson(v, 2)).toBe(JSON.stringify(v, null, 2));
    expect(plainJson([undefined])).toBe("[null]");
  });

  it("writes big integers bare and UIDs as UID(n)", () => {
    expect(plainJson({ n: { __int: "18446744073709551615" }, u: { __uid: 3 } })).toBe('{"n":18446744073709551615,"u":UID(3)}');
    expect(plainJson([{ __int: "1" }], 1)).toBe("[\n 1\n]");
  });

  it("falls back to String for values JSON cannot write", () => {
    expect(plainJson(undefined)).toBe("undefined");
  });
});

describe("cbsEntryLabel", () => {
  it("names the image copy or the OTA one", () => {
    expect(cbsEntryLabel({ source: "image", version: "61.0" }, { version: "27.0" })).toBe("iOS 27.0 image · build 61.0");
    expect(cbsEntryLabel({ source: "cdn", version: "62.1", minOS: "26.2" }, { version: "27.0" })).toBe("OTA · iOS 26.2+ · build 62.1");
    expect(cbsEntryLabel({ source: "image", version: "61.0" }, null)).toBe("OTA · legacy · build 61.0");
  });
});

describe("comboPart", () => {
  it("writes a component with its uplink class", () => {
    expect(comboPart({ rat: "lte", band: 66, dl: "A", ul: "A" })).toBe("B66A↑A");
    expect(comboPart({ rat: "nr", band: 77, dl: "C", ul: "A" }, false)).toBe("n77C");
  });
});

describe("Folding", () => {
  it("lets a node's own toggle win until the next expand or collapse all", () => {
    const f = new Folding();
    expect(f.openFor(true, null)).toBe(true);
    f.collapseAll();
    expect(f.openFor(true, null)).toBe(false);
    const t = f.toggle(true);
    expect(f.openFor(false, t)).toBe(true);
    f.expandAll();
    expect(f.openFor(false, t)).toBe(true);
    f.collapseAll();
    expect(f.openFor(true, t)).toBe(false);
  });
});

describe("toggleIn", () => {
  it("adds and removes", () => {
    const s = new Set<string>();
    toggleIn(s, "a");
    expect(s.has("a")).toBe(true);
    toggleIn(s, "a");
    expect(s.has("a")).toBe(false);
  });
});

describe("entryLabel", () => {
  it("writes a run of one release's betas once", () => {
    expect(entryLabel({ source: "image", ios: ["27.2 beta", "27.2 beta 2"], build: "72.7.2" })).toBe("iOS 27.2 beta 1–2 image · build 72.7.2");
    expect(entryLabel({ source: "image", ios: ["26.6", "26.6.2"], build: "70.0.1" })).toBe("iOS 26.6 – 26.6.2 image · build 70.0.1");
  });
});
