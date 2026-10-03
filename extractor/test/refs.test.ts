import { describe, expect, it } from "vitest";

import type { OtaRef } from "../../src/lib/storage/keys.ts";
import { mergeRefs, type Listed } from "../container/src/jobs/ota-archive/refs.ts";

const listed = (os: string, url = `https://cdn.apple.com/${os}.ipcc`): Listed => ({ url, source: "ios:carrier:TMobile_us", os, build: "1" });
const T0 = "2026-10-01T00:00:00.000Z";
const T1 = "2026-10-03T00:00:00.000Z";

describe("mergeRefs", () => {
  it("adds new refs as live and reports a change", () => {
    const { refs, changed } = mergeRefs([], [listed("27.0")], T0);
    expect(changed).toBe(true);
    expect(refs).toEqual([{ ...listed("27.0"), firstSeen: T0, lastSeen: T0, live: true }]);
  });

  it("only touches lastSeen for refs still listed", () => {
    const prev: OtaRef[] = mergeRefs([], [listed("27.0")], T0).refs.map((r) => ({ ...r, sha: "a".repeat(64) }));
    const { refs, changed } = mergeRefs(prev, [listed("27.0")], T1);
    expect(changed).toBe(false);
    expect(refs[0]).toMatchObject({ firstSeen: T0, lastSeen: T1, live: true, sha: "a".repeat(64) });
  });

  it("keeps refs Apple dropped, marked not live", () => {
    const prev = mergeRefs([], [listed("26.0"), listed("27.0")], T0).refs;
    const { refs, changed } = mergeRefs(prev, [listed("27.0")], T1);
    expect(changed).toBe(true);
    expect(refs.find((r) => r.os === "26.0")).toMatchObject({ live: false, lastSeen: T0 });
  });

  it("treats one URL under two OS keys as two refs", () => {
    const url = "https://cdn.apple.com/shared.ipcc";
    expect(mergeRefs([], [listed("26.0", url), listed("27.0", url)], T0).refs).toHaveLength(2);
  });
});
