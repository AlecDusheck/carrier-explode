import { describe, expect, it } from "vitest";

import { mergeFiles, type Entry, type StoredFile } from "../src/feeds/apple-ota/files.ts";

const entry = (os: string, url = `https://cdn.apple.com/x/20220412/${os}.ipcc`, digests: Entry["digests"] = {}): Entry =>
  ({ url, version: "50.1", digests, listing: { source: "ios:carrier:TMobile_us", os } });
const T0 = "2026-10-01T00:00:00.000Z";
const T1 = "2026-10-03T00:00:00.000Z";
const stored = (...urls: string[]): Map<string, StoredFile> => new Map(urls.map((u) => [u, { sha: `sha:${u}`, cid: `cid:${u}` }]));

describe("mergeFiles", () => {
  it("adds a new URL once stored, live, with its publication date", () => {
    const url = entry("27.0").url;
    expect(mergeFiles([], [entry("27.0")], new Map(), T0)).toEqual({ files: [], changed: false });
    const { files, changed } = mergeFiles([], [entry("27.0")], stored(url), T0);
    expect(changed).toBe(true);
    expect(files).toEqual([{
      url, version: "50.1", published: "2022-04-12", digests: {}, sha: `sha:${url}`, cid: `cid:${url}`,
      listings: [{ source: "ios:carrier:TMobile_us", os: "27.0", firstSeenAt: T0, lastSeenAt: T0, live: true }],
    }]);
  });

  it("only moves lastSeenAt for listings still there", () => {
    const prev = mergeFiles([], [entry("27.0")], stored(entry("27.0").url), T0).files;
    const { files, changed } = mergeFiles(prev, [entry("27.0")], new Map(), T1);
    expect(changed).toBe(false);
    expect(files[0]).toMatchObject({ sha: `sha:${entry("27.0").url}`, listings: [{ firstSeenAt: T0, lastSeenAt: T1, live: true }] });
  });

  it("keeps listings Apple dropped, marked not live", () => {
    const url = "https://cdn.apple.com/shared.ipcc";
    const prev = mergeFiles([], [entry("26.0", url), entry("27.0", url)], stored(url), T0).files;
    const { files, changed } = mergeFiles(prev, [entry("27.0", url)], new Map(), T1);
    expect(changed).toBe(true);
    expect(files).toHaveLength(1);
    expect(files[0]?.listings.find((l) => l.os === "26.0")).toMatchObject({ live: false, lastSeenAt: T0 });
  });

  it("merges the digests of a URL's listings, and refuses contradicting ones", () => {
    const url = "https://cdn.apple.com/shared.ipcc";
    const { files } = mergeFiles([], [entry("3.2.1", url), entry("4.2", url, { sha1: "ab" })], stored(url), T0);
    expect(files[0]?.digests).toEqual({ sha1: "ab" });
    expect(() => mergeFiles([], [entry("1", url, { sha1: "ab" }), entry("2", url, { sha1: "cd" })], stored(url), T0)).toThrow(/two sha1/);
  });
});
